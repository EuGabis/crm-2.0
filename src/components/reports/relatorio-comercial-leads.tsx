"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatBRL } from "@/lib/data/repos/opportunities";

interface Lead {
  ref: string;
  conversationId: string | null;
  contactId: string | null;
  contato: string;
  telefone: string | null;
  email: string | null;
  quando: string | null;
  detalhe: string;
  chave: string | null;
  valor: number | null;
}

export interface AlvoLeads {
  usuario: string;
  nome: string;
  metrica: string;
  rotulo: string;
}

function dataHora(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

/**
 * Lista dos leads por trás de um número do Relatório comercial. Só LÊ: os
 * links abrem o contato e a conversa (em nova guia com Ctrl+clique), sem marcar
 * nada como lido.
 */
export function RelatorioComercialLeads({
  alvo,
  periodo,
  onClose,
}: {
  alvo: AlvoLeads | null;
  periodo: { de: string; ate: string };
  onClose: () => void;
}) {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [truncado, setTruncado] = useState(false);
  const [busca, setBusca] = useState("");

  useEffect(() => {
    if (!alvo) return;
    let ativo = true;
    void (async () => {
      setLeads(null);
      setErro(null);
      setBusca("");
      try {
        const q = new URLSearchParams({
          de: periodo.de,
          ate: periodo.ate,
          usuario: alvo.usuario,
          metrica: alvo.metrica,
        });
        const res = await fetch(`/api/relatorios/comercial/leads?${q}`);
        const json = await res.json().catch(() => ({}));
        if (!ativo) return;
        if (!res.ok) return setErro(json?.error ?? "Não foi possível carregar");
        setLeads(json.leads ?? []);
        setTruncado(!!json.truncado);
      } catch {
        if (ativo) setErro("Falha de conexão");
      }
    })();
    return () => {
      ativo = false;
    };
  }, [alvo, periodo]);

  const visiveis = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (!leads || !t) return leads ?? [];
    return leads.filter((l) =>
      [l.contato, l.telefone, l.email, l.detalhe].some((x) => x?.toLowerCase().includes(t))
    );
  }, [leads, busca]);

  const ehVenda = alvo?.metrica === "vendas_guru";

  return (
    <Dialog open={!!alvo} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="text-sm">
            {alvo?.rotulo} · {alvo?.nome}
            {leads && <span className="ml-2 font-normal text-slate-500">({leads.length})</span>}
          </DialogTitle>
        </DialogHeader>
        {erro && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">{erro}</div>
        )}
        {!leads && !erro && (
          <div className="flex items-center gap-2 p-4 text-xs text-slate-500">
            <Loader2 className="size-4 animate-spin" /> Carregando...
          </div>
        )}
        {leads && (
          <>
            {truncado && (
              <p className="text-[11px] text-amber-700">
                A lista foi cortada no limite de segurança — mostrando os mais recentes.
              </p>
            )}
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome, telefone, e-mail ou informação"
              className="h-8 w-full rounded-md border px-2 text-xs"
            />
            <div className="max-h-[60vh] overflow-auto">
              {visiveis.length === 0 ? (
                <p className="p-4 text-center text-xs text-slate-400">Nenhum lead.</p>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-white">
                    <tr className="border-b text-[11px] text-slate-400">
                      <th className="px-2 py-2 font-medium">Contato</th>
                      <th className="px-2 py-2 font-medium">Quando</th>
                      <th className="px-2 py-2 font-medium">Informação</th>
                      {ehVenda && <th className="px-2 py-2 font-medium">Cruzado por</th>}
                      {ehVenda && <th className="px-2 py-2 font-medium">Valor</th>}
                      <th className="px-2 py-2 font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    {visiveis.map((l) => (
                      <tr key={l.ref} className="border-b align-top last:border-0">
                        <td className="px-2 py-2">
                          <p className="font-medium text-slate-800">{l.contato}</p>
                          <p className="text-[10px] text-slate-500">
                            {[l.telefone, l.email].filter(Boolean).join(" · ") || "—"}
                          </p>
                        </td>
                        <td className="whitespace-nowrap px-2 py-2 text-slate-600">{dataHora(l.quando)}</td>
                        <td className="px-2 py-2 text-slate-700">{l.detalhe}</td>
                        {ehVenda && (
                          <td className="whitespace-nowrap px-2 py-2">
                            <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">
                              {l.chave ?? "—"}
                            </span>
                          </td>
                        )}
                        {ehVenda && (
                          <td className="whitespace-nowrap px-2 py-2">{l.valor == null ? "—" : formatBRL(l.valor)}</td>
                        )}
                        <td className="whitespace-nowrap px-2 py-2 text-right">
                          {l.contactId && (
                            <Link href={`/contatos/${l.contactId}`} className="mr-2 text-indigo-600 hover:underline">
                              Contato
                            </Link>
                          )}
                          {l.conversationId && (
                            <Link href={`/conversas?c=${l.conversationId}`} className="text-indigo-600 hover:underline">
                              Conversa
                            </Link>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
