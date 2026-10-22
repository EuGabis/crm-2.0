"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { PeriodoPicker } from "@/components/shared/period-picker";
import { createClient } from "@/lib/supabase/client";
import { useContactsByIds } from "@/lib/data/repos/db/contacts-search";
import { contactName } from "@/lib/data/repos/contacts";
import { formatBRL } from "@/lib/data/repos/opportunities";
import { temperaturaDe } from "@/lib/leads/temperatura";
import { resolvePreset, type Periodo } from "@/lib/periodo";
import { cn } from "@/lib/utils";

/**
 * Leads por ANÚNCIO (tabela lead_origens, 202610221000) — Meta com botão de
 * WhatsApp e botão do site (Google/UTM).
 *
 * Agrupa por plataforma + campanha + anúncio. Enquanto os nomes oficiais não
 * vêm da API do anunciante, o "anúncio" é o título do anúncio da Meta (ou a
 * utm_content) e a campanha é a utm_campaign — por isso o id do anúncio fica
 * visível: dois anúncios com o mesmo título ("Converse conosco") são anúncios
 * diferentes.
 *
 * Quente/frio = mesma regra do selo da caixa (`temperaturaDe`). Vendas = cards
 * GANHOS do contato (acumulado do contato, não só do período: a venda costuma
 * vir dias depois do clique).
 */
type Linha = {
  id: string;
  plataforma: string;
  contact_id: string | null;
  conversation_id: string | null;
  meta_source_id: string | null;
  meta_headline: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  campanha: string | null;
  anuncio: string | null;
  created_at: string;
};

type Grupo = {
  chave: string;
  plataforma: string;
  campanha: string;
  anuncio: string;
  idAnuncio: string | null;
  leads: Linha[];
  quentes: number;
  frios: number;
  vendas: number;
  receita: number;
};

const PLAT: Record<string, string> = { meta: "Meta", google: "Google", site: "Site" };
const PAGINA = 1000;

/** Dia "AAAA-MM-DD" em São Paulo → limites do dia (o Brasil não tem horário de verão). */
const inicioSP = (d: string) => `${d}T00:00:00-03:00`;
const fimSP = (d: string) => `${d}T23:59:59.999-03:00`;

export function OrigemAnunciosReport() {
  const [periodo, setPeriodo] = useState<Periodo>(() => resolvePreset("30d"));
  const [dados, setDados] = useState<{
    linhas: Linha[];
    temp: Map<string, "quente" | "frio" | null>;
    vendas: Map<string, number>;
  } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const sb = createClient();
      const linhas: Linha[] = [];
      // Paginado: o PostgREST corta em 1000 linhas sem aviso (armadilha nº 7).
      for (let de = 0; ; de += PAGINA) {
        const { data, error } = await sb
          .from("lead_origens")
          .select(
            "id, plataforma, contact_id, conversation_id, meta_source_id, meta_headline, utm_campaign, utm_content, campanha, anuncio, created_at"
          )
          .gte("created_at", inicioSP(periodo.de))
          .lte("created_at", fimSP(periodo.ate))
          .order("created_at", { ascending: false })
          .order("id")
          .range(de, de + PAGINA - 1);
        if (error) {
          if (vivo) setErro(`${error.code ?? ""} ${error.message}`.trim());
          return;
        }
        linhas.push(...((data as Linha[]) ?? []));
        if ((data?.length ?? 0) < PAGINA) break;
      }
      const convs = [...new Set(linhas.map((l) => l.conversation_id).filter((x): x is string => !!x))];
      const contatos = [...new Set(linhas.map((l) => l.contact_id).filter((x): x is string => !!x))];
      const temp = new Map<string, "quente" | "frio" | null>();
      const vendas = new Map<string, number>();
      for (let i = 0; i < convs.length; i += 200) {
        const { data } = await sb
          .from("bot_desfechos")
          .select("conversation_id, pontos, limiar, created_at")
          .in("conversation_id", convs.slice(i, i + 200))
          .order("created_at", { ascending: false });
        for (const d of data ?? []) {
          // Mais novo primeiro: o primeiro de cada conversa é o desfecho vigente.
          const id = d.conversation_id as string;
          if (!temp.has(id))
            temp.set(id, temperaturaDe({ pontos: d.pontos as number | null, limiar: d.limiar as number | null }));
        }
      }
      for (let i = 0; i < contatos.length; i += 200) {
        const { data } = await sb
          .from("opportunities")
          .select("contact_id, value")
          .eq("status", "won")
          .in("contact_id", contatos.slice(i, i + 200));
        for (const o of data ?? []) {
          const c = o.contact_id as string;
          vendas.set(c, (vendas.get(c) ?? 0) + Number(o.value ?? 0));
        }
      }
      if (vivo) {
        setErro(null);
        setDados({ linhas, temp, vendas });
      }
    })();
    return () => {
      vivo = false;
    };
  }, [periodo.de, periodo.ate]);

  const grupos = useMemo(() => {
    if (!dados) return [] as Grupo[];
    const m = new Map<string, Grupo>();
    for (const l of dados.linhas) {
      const campanha = l.campanha ?? l.utm_campaign ?? "—";
      const anuncio = l.anuncio ?? l.meta_headline ?? l.utm_content ?? "(sem título)";
      const chave = `${l.plataforma}|${campanha}|${l.meta_source_id ?? anuncio}`;
      const g: Grupo = m.get(chave) ?? {
        chave,
        plataforma: l.plataforma,
        campanha,
        anuncio,
        idAnuncio: l.meta_source_id,
        leads: [],
        quentes: 0,
        frios: 0,
        vendas: 0,
        receita: 0,
      };
      g.leads.push(l);
      const t = l.conversation_id ? dados.temp.get(l.conversation_id) : null;
      if (t === "quente") g.quentes++;
      if (t === "frio") g.frios++;
      const r = l.contact_id ? dados.vendas.get(l.contact_id) : undefined;
      if (r !== undefined) {
        g.vendas++;
        g.receita += r;
      }
      m.set(chave, g);
    }
    return [...m.values()].sort((a, b) => b.leads.length - a.leads.length);
  }, [dados]);

  const abertoGrupo = grupos.find((g) => g.chave === aberto) ?? null;
  const nomes = useContactsByIds(abertoGrupo ? abertoGrupo.leads.map((l) => l.contact_id) : []);
  const total = dados?.linhas.length ?? 0;

  return (
    <div className="mt-8">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold text-slate-900">Leads por anúncio</h2>
        <PeriodoPicker periodo={periodo} onChange={setPeriodo} />
      </div>
      <p className="mb-3 text-xs text-slate-500">
        Leads que chegaram pelo WhatsApp a partir de anúncio da Meta ou do botão do site
        (Google/UTM). Vendas = cards ganhos do contato. Clique numa linha para ver os leads.
      </p>
      {erro ? (
        <p className="rounded-xl border bg-white p-4 text-xs text-red-600">
          Não foi possível carregar: {erro}
        </p>
      ) : !dados ? (
        <p className="rounded-xl border bg-white p-4 text-xs text-slate-400">Carregando...</p>
      ) : total === 0 ? (
        <p className="rounded-xl border bg-white p-4 text-xs text-slate-500">
          Nenhum lead com origem de anúncio no período. A origem é registrada desde 22/10/2026.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-white">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b text-[11px] text-slate-400">
                {["Plataforma", "Campanha", "Anúncio", "Leads", "Quentes", "Frios", "Vendas", "Receita"].map(
                  (h) => (
                    <th key={h} className="whitespace-nowrap px-4 py-2.5 font-medium">
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {grupos.map((g) => (
                <tr
                  key={g.chave}
                  onClick={() => setAberto(aberto === g.chave ? null : g.chave)}
                  className={cn(
                    "cursor-pointer border-b last:border-0 hover:bg-slate-50",
                    aberto === g.chave && "bg-indigo-50/50"
                  )}
                >
                  <td className="px-4 py-2.5 font-medium text-slate-800">
                    {PLAT[g.plataforma] ?? g.plataforma}
                  </td>
                  <td className="max-w-[220px] truncate px-4 py-2.5 text-slate-600" title={g.campanha}>
                    {g.campanha}
                  </td>
                  <td className="max-w-[260px] px-4 py-2.5 text-slate-700">
                    <p className="truncate" title={g.anuncio}>
                      {g.anuncio}
                    </p>
                    {g.idAnuncio && <p className="text-[10px] text-slate-400">id {g.idAnuncio}</p>}
                  </td>
                  <td className="px-4 py-2.5 font-semibold text-slate-900">{g.leads.length}</td>
                  <td className="px-4 py-2.5 text-emerald-700">{g.quentes}</td>
                  <td className="px-4 py-2.5 text-sky-700">{g.frios}</td>
                  <td className="px-4 py-2.5 text-emerald-700">{g.vendas}</td>
                  <td className="px-4 py-2.5">{formatBRL(g.receita)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {abertoGrupo && (
        <div className="mt-3 rounded-xl border bg-white p-4">
          <p className="mb-2 text-xs font-semibold text-slate-800">
            {abertoGrupo.leads.length} lead(s) · {abertoGrupo.anuncio}
          </p>
          <ul className="divide-y text-xs">
            {abertoGrupo.leads.map((l) => {
              const c = l.contact_id ? nomes.get(l.contact_id) : null;
              const t = l.conversation_id ? dados?.temp.get(l.conversation_id) : null;
              return (
                <li key={l.id} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="min-w-0 truncate text-slate-700">
                    {c ? contactName(c) : l.contact_id ? "Carregando..." : "—"}
                    <span className="text-slate-400">
                      {" · "}
                      {format(new Date(l.created_at), "dd/MM HH:mm", { locale: ptBR })}
                    </span>
                    {t && (
                      <span
                        className={cn(
                          "ml-2 rounded border px-1 text-[9px] font-semibold uppercase",
                          t === "frio"
                            ? "border-sky-200 bg-sky-50 text-sky-700"
                            : "border-emerald-200 bg-emerald-50 text-emerald-700"
                        )}
                      >
                        {t}
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 gap-3">
                    {l.contact_id && (
                      <Link href={`/contatos/${l.contact_id}`} className="text-indigo-600 hover:underline">
                        Contato
                      </Link>
                    )}
                    {l.conversation_id && (
                      <Link href={`/conversas?c=${l.conversation_id}`} className="text-indigo-600 hover:underline">
                        Conversa
                      </Link>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
