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

/* ------------------------------------------------------------------ *
 * Marcas compartilhadas dos widgets
 *
 * As roscas do painel foram trocadas por barras rotuladas, e estas são as
 * peças. Ficam aqui, e não copiadas em cada widget, porque quatro cards
 * desenham a mesma marca — em cópias separadas a espessura da barra e o
 * arredondamento divergiriam na primeira mudança.
 *
 * ⚠️ Toda fatia com valor > 0 tem largura MÍNIMA (`MIN_PX`). Era o defeito
 * central das roscas: com 307 de 313 numa fatia, as duas de 1% viravam um fio
 * invisível e o card dizia "só existe uma coisa aqui". Uma barra de 3 px é
 * pequena e legível; zero é a única coisa que pode desaparecer.
 * ------------------------------------------------------------------ */

const MIN_PX = 3;

/** Largura da marca: porcentagem real, com piso em pixel para o não-zero. */
function larguraDaMarca(valor: number, total: number): string {
  if (valor <= 0) return "0px";
  const pct = total > 0 ? (valor / total) * 100 : 0;
  return `max(${MIN_PX}px, ${pct.toFixed(2)}%)`;
}

/**
 * Linha "nome + valor em cima, barra embaixo".
 *
 * Duas linhas, e não nome/barra/valor lado a lado, porque o mesmo componente
 * serve o card de 1/3 (≈300 px) e o de 1/2: em linha única o nome da fase ou
 * um valor em reais truncava no card estreito, que é justamente o rótulo que
 * substitui a legenda da rosca.
 */
export function MarkedBarRow({
  label,
  labelHint,
  value,
  color,
  share,
  total,
  hint,
  onClick,
}: {
  label: string;
  /** Texto discreto logo depois do nome (ex.: o valor em reais da fase). */
  labelHint?: string;
  /** Texto já formatado à direita (contagem, dinheiro...). */
  value: string;
  color: string;
  /** Grandeza desta linha, na mesma unidade de `total`. */
  share: number;
  total: number;
  /** Segundo texto, menor, depois do valor (ex.: a porcentagem). */
  hint?: string;
  onClick?: () => void;
}) {
  const vazia = share <= 0;
  const Tag = onClick && !vazia ? "button" : "div";
  return (
    <Tag
      {...(onClick && !vazia
        ? { onClick, type: "button" as const, title: `Ver ${label}` }
        : {})}
      className={`block w-full rounded-md px-1 py-1 text-left transition-colors ${
        onClick && !vazia ? "cursor-pointer hover:bg-slate-50" : ""
      }`}
    >
      <div className="flex items-baseline gap-1.5">
        <span
          className="size-2 shrink-0 translate-y-[-1px] rounded-sm"
          style={{ background: vazia ? "#e2e8f0" : color }}
          aria-hidden
        />
        <span
          className={`min-w-0 flex-1 truncate text-[11px] ${vazia ? "text-slate-400" : "text-slate-600"}`}
          title={labelHint ? `${label} · ${labelHint}` : label}
        >
          {label}
          {labelHint && <span className="ml-1.5 text-[10px] text-slate-400">{labelHint}</span>}
        </span>
        {/* O valor é rótulo DIRETO, não conteúdo de tooltip: a separação
            vermelho/verde fica no piso da checagem de daltonismo, e é o texto
            ao lado da marca que garante a leitura sem depender da cor. */}
        <span
          className={`shrink-0 text-[11px] font-semibold tabular-nums ${vazia ? "text-slate-300" : "text-slate-800"}`}
        >
          {value}
        </span>
        {hint && <span className="shrink-0 text-[10px] tabular-nums text-slate-400">{hint}</span>}
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full"
          style={{ width: larguraDaMarca(share, total), background: color }}
        />
      </div>
    </Tag>
  );
}

/**
 * Barra única de composição (parte-do-todo em 100%).
 *
 * É o que substituiu a rosca de status. Uma rosca em que uma fatia tem 98% não
 * mostra composição nenhuma — mostra um anel de uma cor; a barra dá a mesma
 * informação em 6 px de altura e sobra espaço para os números aparecerem como
 * texto, que é como o 1% fica legível.
 */
export function ShareBar({
  parts,
}: {
  parts: { key: string; label: string; value: number; color: string }[];
}) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (total <= 0) return null;
  return (
    // `gap-[2px]`: separação entre fatias é VÃO da superfície, não contorno
    // desenhado em volta de cada uma.
    <div className="flex h-1.5 w-full gap-[2px] overflow-hidden rounded-full bg-slate-100">
      {parts
        .filter((p) => p.value > 0)
        .map((p) => (
          <div
            key={p.key}
            className="h-full rounded-full first:rounded-l-full last:rounded-r-full"
            style={{ width: larguraDaMarca(p.value, total), background: p.color }}
            title={`${p.label}: ${p.value}`}
          />
        ))}
    </div>
  );
}

/**
 * Medidor de uma razão contra um limite (0–100%).
 *
 * Substituiu o anel radial da taxa de conversão: em 1% o arco era um risco de
 * dois pixels no alto do anel — o número dizia uma coisa e o desenho, nada.
 * Numa régua reta, 1% é 1% do comprimento e continua sendo um traço visível
 * (mesmo piso de `MIN_PX`).
 */
export function Meter({ pct, color }: { pct: number; color: string }) {
  const limitado = Math.max(0, Math.min(100, pct));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
      <div
        className="h-full rounded-full transition-[width]"
        style={{ width: larguraDaMarca(limitado, 100), background: color }}
      />
    </div>
  );
}
