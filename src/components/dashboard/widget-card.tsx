"use client";

import { useState, type ReactNode } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDbPipelines } from "@/lib/data/repos/db/pipeline";

/**
 * Pipeline do widget: controlado pela visualização salva quando ela existe,
 * local quando o widget é usado solto. Sem isso, escolher o pipeline do funil
 * seria esquecido a cada recarregamento — que é justamente o que se quer
 * guardar num painel personalizado.
 */
export interface WidgetPipelineProps {
  pipelineId?: string;
  onPipelineChange?: (id: string) => void;
}

export function usePipelineSelection(
  { pipelineId, onPipelineChange }: WidgetPipelineProps,
  fallback: string
): [string, (id: string) => void] {
  const [local, setLocal] = useState(pipelineId ?? fallback);
  // Controlado SÓ quando há para onde gravar. Sem o handler (painel de fábrica,
  // ou painel do departamento aberto por quem não edita) o seletor volta a ser
  // local — senão ficaria travado no valor salvo, sem reagir ao clique.
  const value = onPipelineChange ? (pipelineId ?? fallback) : local;
  return [
    value,
    (id: string) => {
      if (onPipelineChange) onPipelineChange(id);
      else setLocal(id);
    },
  ];
}

export function WidgetCard({
  title,
  subtitle,
  children,
  pipelineId,
  onPipelineChange,
  footer,
  /**
   * `false` nos widgets que só sabem desenhar UM funil (Funil e Distribuição de
   * fases): fases são de um pipeline, somar as de vários não significa nada. O
   * seletor mostrava "Todos os pipelines" e o widget desenhava o primeiro — daí
   * a impressão de painel com números que não batem ("41" num card, "4" no
   * outro).
   */
  allowAll = true,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  pipelineId?: string;
  onPipelineChange?: (id: string) => void;
  footer?: ReactNode;
  allowAll?: boolean;
}) {
  const pipelines = useDbPipelines();
  const selected = pipelines.find((p) => p.id === pipelineId);
  const label = allowAll
    ? (pipelineId === "all" || !pipelineId ? "Todos os pipelines" : (selected?.name ?? "Todos os pipelines"))
    : // Sem opção "todos": mostra o pipeline REALMENTE desenhado, que é o
      // escolhido ou, na falta dele, o primeiro (mesma regra de useDbPipeline).
      (selected?.name ?? pipelines[0]?.name ?? "Pipeline");

  return (
    // rounded-2xl + borda mais clara + leve elevação no hover: o cartão deixa de
    // ser uma caixa de contorno duro e ganha o ar de painel moderno.
    <div className="flex h-full flex-col rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold tracking-tight text-slate-900">{title}</h3>
          {subtitle && <p className="mt-0.5 text-[10px] leading-tight text-slate-400">{subtitle}</p>}
        </div>
        {onPipelineChange && (
          <Select value={pipelineId} onValueChange={(v) => v && onPipelineChange(v)}>
            <SelectTrigger className="h-7 w-[150px] shrink-0 text-[11px]" size="sm">
              <SelectValue>{label}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {allowAll && (
                <SelectItem value="all" className="text-xs">
                  Todos os pipelines
                </SelectItem>
              )}
              {pipelines.map((p) => (
                <SelectItem key={p.id} value={p.id} className="text-xs">
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
      {footer}
    </div>
  );
}

/** Vazio de widget: dizer que não há dado NO PERÍODO evita ler gráfico vazio como bug. */
export function WidgetEmpty({ text }: { text: string }) {
  return (
    <div className="flex h-[150px] flex-col items-center justify-center gap-1 rounded-xl bg-slate-50/70 text-center">
      <p className="text-xs font-medium text-slate-500">Nada no período</p>
      <p className="max-w-[220px] text-[11px] text-slate-400">{text}</p>
    </div>
  );
}

/**
 * Valor em reais curto para eixo de gráfico. O formatador anterior era
 * `R$${(v/1000).toFixed(0)}K` — com valores abaixo de mil, TODOS os traços do
 * eixo viravam "R$0K" e o gráfico ficava sem escala nenhuma.
 */
export function shortBRL(v: number): string {
  const n = Math.abs(v);
  if (n >= 1_000_000) return `R$ ${(v / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (n >= 1_000) return `R$ ${(v / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return `R$ ${v.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
}
