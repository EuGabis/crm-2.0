"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ExternalLink, MessageSquare, User } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { noRecorte, type Recorte } from "@/lib/reports/quadro-leads";
import { cn } from "@/lib/utils";

export type { Recorte };

/** Uma linha de lead, como a rota devolve para o drilldown. */
export interface LeadDoQuadro {
  conversa: string | null;
  contatoId: string | null;
  contato: string | null;
  telefone: string | null;
  dia: string;
  resultado: string | null;
  pontos: number | null;
  atendente: string | null;
  finalizada: boolean;
  ganha: boolean;
  curso: string | null;
}

const TITULO: Record<Recorte, string> = {
  recebeu: "Leads recebidos",
  qualificados: "Leads qualificados",
  frios: "Leads frios",
  finalizadas: "Conversas finalizadas",
  ganhas: "Leads ganhos",
};

/**
 * ⚠️ **Frio e quente são o DESFECHO do bot, e "sem nota" é um terceiro estado.**
 * Quem abandonou a triagem não recebeu pontuação — chamá-lo de frio inventaria
 * uma reprovação que o bot nunca deu, e é justamente esse lead que precisa ser
 * retomado. As três condutas são diferentes, então os três selos também.
 */
function Temperatura({ lead }: { lead: LeadDoQuadro }) {
  if (lead.resultado === "quente") {
    return (
      <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
        QUENTE{lead.pontos != null && ` · ${lead.pontos}`}
      </span>
    );
  }
  if (lead.resultado === "frio") {
    return (
      <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">
        FRIO{lead.pontos != null && ` · ${lead.pontos}`}
      </span>
    );
  }
  return (
    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
      {lead.resultado ?? "sem nota"}
    </span>
  );
}

/**
 * Os leads por trás de um número do quadro "Por atendente".
 *
 * Pedido do Gabriel (2026-09-16): *"ver os leads que foram para esse atendente
 * ao clicar nos números... coloque também quantos foram frios e quantos foram
 * quentes... e a opção de ver as informações do contato e o botão de ver a
 * conversa já por ali."*
 *
 * ⚠️ **As duas ações são LINKS de verdade** (`<Link href>`), não botões que
 * navegam: é o que devolve Ctrl+clique, botão do meio e "abrir em nova guia" —
 * e conferir lead a lead sem perder o relatório de vista é exatamente o uso
 * desta lista. Mesmo padrão do "Abrir conversa" da aba Relatório de conversas.
 *
 * ⚠️ **Sem `conversa` não há link de conversa**, e a linha diz isso em vez de
 * oferecer um botão que não leva a lugar nenhum.
 */
export function LeadsDoAtendenteDialog({
  open,
  onOpenChange,
  titulo,
  recorte,
  leads,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Nome do atendente (ou "Sem responsável"), já resolvido pelo quadro. */
  titulo: string;
  recorte: Recorte;
  leads: LeadDoQuadro[];
}) {
  const lista = useMemo(() => leads.filter((l) => noRecorte(l, recorte)), [leads, recorte]);
  const quentes = lista.filter((l) => l.resultado === "quente").length;
  const frios = lista.filter((l) => l.resultado === "frio").length;
  const semNota = lista.length - quentes - frios;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-3xl">
        <DialogHeader className="shrink-0">
          <DialogTitle className="text-base">
            {TITULO[recorte]} · {titulo}
          </DialogTitle>
        </DialogHeader>

        {/* A composição fica no topo e vale para QUALQUER recorte: mesmo na
            lista de "ganhos" saber quantos eram quentes muda a leitura. */}
        <div className="flex shrink-0 flex-wrap items-center gap-3 border-b pb-2 text-[11px]">
          <span className="font-semibold text-slate-700">
            {lista.length} lead{lista.length === 1 ? "" : "s"}
          </span>
          <span className="text-emerald-700">{quentes} quente{quentes === 1 ? "" : "s"}</span>
          <span className="text-blue-700">{frios} frio{frios === 1 ? "" : "s"}</span>
          {semNota > 0 && (
            <span className="text-slate-400" title="O bot não chegou a pontuar estes leads">
              {semNota} sem nota
            </span>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {lista.length === 0 ? (
            <p className="py-8 text-center text-xs text-slate-400">
              Nenhum lead neste recorte.
            </p>
          ) : (
            <ul className="divide-y">
              {lista.map((l) => (
                <li
                  key={l.conversa ?? `${l.contatoId}-${l.dia}`}
                  className="flex items-center gap-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-slate-800">
                      {l.contato ?? "Contato sem nome"}
                    </p>
                    <p className="truncate text-[11px] text-slate-500">
                      {l.telefone ?? "sem telefone"} · {l.dia.split("-").reverse().join("/")}
                      {l.curso && ` · ${l.curso}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {l.ganha && (
                      <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                        GANHO
                      </span>
                    )}
                    {l.finalizada && (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                        finalizada
                      </span>
                    )}
                    <Temperatura lead={l} />
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {l.contatoId && (
                      <Link
                        href={`/contatos/${l.contatoId}`}
                        title="Ver as informações do contato"
                        className={cn(
                          "flex items-center gap-1 rounded border px-1.5 py-1 text-[10px]",
                          "text-slate-600 hover:bg-slate-50"
                        )}
                      >
                        <User className="size-3" /> Contato
                      </Link>
                    )}
                    {l.conversa ? (
                      <Link
                        href={`/conversas?c=${l.conversa}`}
                        title="Abrir a conversa na caixa de entrada"
                        className="flex items-center gap-1 rounded border border-indigo-200 bg-indigo-50 px-1.5 py-1 text-[10px] font-semibold text-indigo-700 hover:bg-indigo-100"
                      >
                        <MessageSquare className="size-3" /> Conversa
                        <ExternalLink className="size-2.5" />
                      </Link>
                    ) : (
                      <span className="px-1.5 text-[10px] text-slate-300">sem conversa</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
