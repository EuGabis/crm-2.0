"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import {
  endOfDay,
  endOfQuarter,
  startOfDay,
  startOfMonth,
  startOfQuarter,
  startOfYear,
  subDays,
  subQuarters,
} from "date-fns";
import { useDbOpportunities } from "@/lib/data/repos/db/pipeline";
import type { Opportunity } from "@/lib/data/types";

/**
 * Intervalo de datas do painel. Antes o seletor era decorativo: guardava o
 * rótulo em estado local e nenhum widget lia esse estado, então trocar o
 * período não mudava número nenhum na tela. Agora o intervalo vive aqui e
 * todo widget lê pelo `useDashboardOps`.
 */

export type PresetKey =
  | "hoje"
  | "7d"
  | "30d"
  | "mes"
  | "trimestre-passado"
  | "ano"
  | "personalizado";

export const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "hoje", label: "Hoje" },
  { key: "7d", label: "Últimos 7 dias" },
  { key: "30d", label: "Últimos 30 dias" },
  { key: "mes", label: "Este mês" },
  { key: "trimestre-passado", label: "Trimestre passado" },
  { key: "ano", label: "Este ano" },
  { key: "personalizado", label: "Personalizado" },
];

export interface DateRange {
  from: Date;
  to: Date;
}

/** Converte um preset no intervalo concreto, sempre em dias inteiros. */
export function resolvePreset(key: PresetKey, now = new Date()): DateRange {
  switch (key) {
    case "hoje":
      return { from: startOfDay(now), to: endOfDay(now) };
    case "7d":
      return { from: startOfDay(subDays(now, 6)), to: endOfDay(now) };
    case "30d":
      return { from: startOfDay(subDays(now, 29)), to: endOfDay(now) };
    case "mes":
      return { from: startOfMonth(now), to: endOfDay(now) };
    case "trimestre-passado": {
      const prev = subQuarters(now, 1);
      return { from: startOfQuarter(prev), to: endOfQuarter(prev) };
    }
    case "ano":
      return { from: startOfYear(now), to: endOfDay(now) };
    case "personalizado":
      // Sem escolha do usuário ainda — cai no mês corrente.
      return { from: startOfMonth(now), to: endOfDay(now) };
  }
}

export function presetLabel(key: PresetKey): string {
  return PRESETS.find((p) => p.key === key)?.label ?? "Período";
}

interface DashboardRangeValue {
  preset: PresetKey;
  range: DateRange;
  apply: (preset: PresetKey, range?: DateRange) => void;
}

const DashboardRangeContext = createContext<DashboardRangeValue | null>(null);

const DEFAULT_PRESET: PresetKey = "30d";

export function DashboardRangeProvider({ children }: { children: ReactNode }) {
  const [preset, setPreset] = useState<PresetKey>(DEFAULT_PRESET);
  const [custom, setCustom] = useState<DateRange | null>(null);

  const value = useMemo<DashboardRangeValue>(
    () => ({
      preset,
      range: preset === "personalizado" && custom ? custom : resolvePreset(preset),
      apply: (nextPreset, nextRange) => {
        setPreset(nextPreset);
        setCustom(nextPreset === "personalizado" ? nextRange ?? null : null);
      },
    }),
    [preset, custom]
  );

  return (
    <DashboardRangeContext.Provider value={value}>{children}</DashboardRangeContext.Provider>
  );
}

export function useDashboardRange(): DashboardRangeValue {
  const ctx = useContext(DashboardRangeContext);
  if (!ctx) {
    throw new Error("useDashboardRange precisa estar dentro de <DashboardRangeProvider>");
  }
  return ctx;
}

/**
 * Oportunidades já filtradas por período e (opcionalmente) por pipeline.
 * Deriva com useMemo sobre o array cru — filtrar dentro do selector do Zustand
 * causa loop de render (ver AGENTS.md).
 */
export function useDashboardOps(pipelineId?: string): Opportunity[] {
  const ops = useDbOpportunities();
  const { range } = useDashboardRange();

  return useMemo(() => {
    const from = range.from.getTime();
    const to = range.to.getTime();
    return ops.filter((o) => {
      if (pipelineId && pipelineId !== "all" && o.pipelineId !== pipelineId) return false;
      if (!o.createdAt) return false;
      const t = new Date(o.createdAt).getTime();
      return t >= from && t <= to;
    });
  }, [ops, pipelineId, range.from, range.to]);
}

/**
 * Linha que diz, em datas, o período que os cards estão mostrando.
 *
 * O botão do filtro já diz "Últimos 30 dias", mas ninguém liga esse rótulo aos
 * números: a dúvida "esse 41 é de sempre ou do mês?" era justamente o que
 * fazia o painel parecer confuso. Aqui o intervalo aparece por extenso.
 */
export function DashboardRangeHint() {
  const { range } = useDashboardRange();
  const fmt = (d: Date) =>
    d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");
  return (
    <p className="mb-3 text-[11px] text-slate-400">
      Todos os cards abaixo contam apenas o que foi criado entre{" "}
      <span className="font-medium text-slate-500">{fmt(range.from)}</span> e{" "}
      <span className="font-medium text-slate-500">{fmt(range.to)}</span>.
    </p>
  );
}
