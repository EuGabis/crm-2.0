"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { contactName } from "@/lib/data/repos/contacts";
import { useContactsByIds } from "@/lib/data/repos/db/contacts-search";
import { useDbPipelines } from "@/lib/data/repos/db/pipeline";
import { formatBRL } from "@/lib/data/repos/opportunities";
import type { Opportunity } from "@/lib/data/types";

/**
 * Detalhe de um pedaço do gráfico: clicar numa fatia, barra ou fase abre a
 * lista das oportunidades que formam aquele número. Antes os widgets do painel
 * eram só desenho — o número aparecia e não havia como chegar nos registros.
 */

const STATUS_LABEL: Record<Opportunity["status"], string> = {
  open: "Aberta",
  won: "Ganha",
  lost: "Perdida",
};
const STATUS_CLASS: Record<Opportunity["status"], string> = {
  open: "bg-indigo-100 text-indigo-700",
  won: "bg-emerald-100 text-emerald-700",
  lost: "bg-rose-100 text-rose-700",
};

export interface DrilldownState {
  title: string;
  ops: Opportunity[];
  /** Pipeline para abrir no funil, quando o recorte é de um só. */
  pipelineId?: string;
}

/** Estado + abre/fecha, para o widget só chamar `open({...})`. */
export function useDrilldown() {
  const [state, setState] = useState<DrilldownState | null>(null);
  return {
    drilldown: state,
    open: (next: DrilldownState) => setState(next),
    close: () => setState(null),
  };
}

export function DrilldownDialog({
  state,
  onClose,
}: {
  state: DrilldownState | null;
  onClose: () => void;
}) {
  // ⚠️ Era `useDbContacts()`, que baixa a lista INTEIRA — e como este diálogo
  // fica montado no painel mesmo fechado, abrir o Dashboard puxava os 41 mil
  // contatos só para escrever o nome de dez linhas quando alguém clicasse num
  // gráfico. Aqui só os contatos das oportunidades em tela são buscados.
  const ops = state?.ops ?? [];
  const contactsById = useContactsByIds(ops.map((o) => o.contactId));
  const pipelines = useDbPipelines();

  const stageName = useMemo(() => {
    const map = new Map<string, string>();
    pipelines.forEach((p) => p.stages.forEach((s) => map.set(s.id, s.name)));
    return map;
  }, [pipelines]);

  const total = ops.reduce((s, o) => s + o.value, 0);

  return (
    <Dialog open={!!state} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-sm">{state?.title}</DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-4 border-b pb-2 text-xs text-slate-500">
          <span>
            <strong className="text-slate-800">{ops.length}</strong> oportunidade
            {ops.length === 1 ? "" : "s"}
          </span>
          <span>
            Valor total <strong className="text-slate-800">{formatBRL(total)}</strong>
          </span>
          <Link
            href={state?.pipelineId ? `/leads?pipeline=${state.pipelineId}` : "/leads"}
            onClick={onClose}
            className="ml-auto inline-flex items-center gap-1 font-semibold text-indigo-600 hover:underline"
          >
            Abrir no funil <ArrowRight className="size-3" />
          </Link>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]">
          {ops.length === 0 ? (
            <p className="py-8 text-center text-xs text-slate-400">
              Nenhuma oportunidade neste recorte.
            </p>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b text-[11px] text-slate-400">
                  <th className="py-2 pr-2 font-medium">Oportunidade</th>
                  <th className="px-2 py-2 font-medium">Contato</th>
                  <th className="px-2 py-2 font-medium">Fase</th>
                  <th className="px-2 py-2 font-medium">Fonte</th>
                  <th className="px-2 py-2 text-right font-medium">Valor</th>
                  <th className="px-2 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {ops.map((o) => {
                  const contact = o.contactId ? contactsById.get(o.contactId) : null;
                  return (
                    <tr key={o.id} className="border-b last:border-0">
                      <td className="py-2 pr-2 font-medium text-slate-800">{o.name}</td>
                      <td className="px-2 py-2 text-slate-600">
                        {contact ? (
                          <Link
                            href={`/contatos/${contact.id}`}
                            onClick={onClose}
                            className="hover:text-indigo-600 hover:underline"
                          >
                            {contactName(contact)}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-2 py-2 text-slate-600">
                        {stageName.get(o.stageId) ?? "—"}
                      </td>
                      <td className="px-2 py-2 text-slate-500">{o.source}</td>
                      <td className="px-2 py-2 text-right text-slate-700">
                        {formatBRL(o.value)}
                      </td>
                      <td className="px-2 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_CLASS[o.status]}`}
                        >
                          {STATUS_LABEL[o.status]}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
