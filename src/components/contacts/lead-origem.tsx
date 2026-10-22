"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { createClient } from "@/lib/supabase/client";

/**
 * "De onde veio" no cadastro do contato (tabela lead_origens, 202610221000).
 * Uma linha por conversa que chegou com origem: anúncio da Meta com botão de
 * WhatsApp, ou o botão do site (Google Ads / UTMs).
 * Sem nenhuma linha, DIZ que a origem não foi registrada — e não esconde o
 * bloco: "não sabemos" e "não veio de anúncio" são coisas diferentes.
 */
type Origem = {
  id: string;
  plataforma: string;
  via: string;
  meta_headline: string | null;
  meta_source_id: string | null;
  meta_source_url: string | null;
  gclid: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  pagina: string | null;
  campanha: string | null;
  anuncio: string | null;
  created_at: string;
};

const NOME: Record<string, string> = { meta: "Meta (Instagram/Facebook)", google: "Google Ads", site: "Site" };

export function LeadOrigem({ contactId }: { contactId: string }) {
  const [linhas, setLinhas] = useState<Origem[] | null>(null);

  useEffect(() => {
    let vivo = true;
    void createClient()
      .from("lead_origens")
      .select("*")
      .eq("contact_id", contactId)
      .order("created_at", { ascending: false })
      .limit(20)
      .then(({ data }) => {
        if (vivo) setLinhas((data as Origem[] | null) ?? []);
      });
    return () => {
      vivo = false;
    };
  }, [contactId]);

  return (
    <div className="rounded-xl border bg-white p-4">
      <h2 className="mb-2 text-sm font-semibold text-slate-900">Origem do lead</h2>
      {linhas === null ? (
        <p className="text-xs text-slate-400">Carregando...</p>
      ) : linhas.length === 0 ? (
        <p className="text-xs text-slate-500">
          Origem não registrada (contato anterior ao rastreamento, ou não veio por anúncio/botão do site).
        </p>
      ) : (
        <ul className="space-y-2">
          {linhas.map((o) => {
            const itens: [string, string | null][] = [
              ["Campanha", o.campanha ?? o.utm_campaign],
              ["Anúncio", o.anuncio ?? o.meta_headline ?? o.utm_content],
              ["Termo", o.utm_term],
              ["Fonte / mídia", [o.utm_source, o.utm_medium].filter(Boolean).join(" / ") || null],
              ["Id do anúncio (Meta)", o.meta_source_id],
              ["Página", o.pagina ?? o.meta_source_url],
              ["Clique do Google (gclid)", o.gclid ? "registrado" : null],
            ];
            return (
              <li key={o.id} className="rounded-lg border border-slate-100 p-2 text-xs">
                <p className="font-semibold text-slate-800">
                  {NOME[o.plataforma] ?? o.plataforma}
                  <span className="font-normal text-slate-500">
                    {" · "}
                    {o.via === "anuncio_whatsapp" ? "anúncio com botão de WhatsApp" : "botão do site"}
                    {" · "}
                    {format(new Date(o.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                  </span>
                </p>
                {itens
                  .filter(([, v]) => v)
                  .map(([k, v]) => (
                    <p key={k} className="mt-0.5 truncate text-slate-600" title={v ?? ""}>
                      <span className="text-slate-400">{k}:</span> {v}
                    </p>
                  ))}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
