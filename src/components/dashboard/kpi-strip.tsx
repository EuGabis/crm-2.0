"use client";

import { useMemo } from "react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { CircleDollarSign, Target, TrendingUp, Wallet } from "lucide-react";
import { formatBRL } from "@/lib/data/repos/opportunities";
import { useDashboardOps, useDashboardRange } from "./date-range";
import { shortBRL } from "./widget-card";

/**
 * Faixa de KPIs do topo do painel.
 *
 * O painel abria direto em gráfico, e gráfico responde "como está distribuído",
 * nunca "como estamos". Os quatro números que respondem isso — quantas
 * oportunidades, quanto entrou, quanto converteu, quanto vale cada uma —
 * estavam espalhados em rodapés de card ou não existiam.
 *
 * Fica FORA do sistema de widgets de propósito: é resumo do mesmo recorte
 * (período do filtro, todos os pipelines) e vale para qualquer painel, inclusive
 * os de departamento montados por outra pessoa. Entrar no catálogo obrigaria
 * cada painel já salvo a ser reconfigurado à mão para ganhar isso.
 *
 * O fiapo de gráfico é a série DIÁRIA do próprio indicador dentro do período —
 * não é enfeite: mostra se o número veio de um pico isolado ou de um fluxo
 * constante, que é a pergunta seguinte de quem lê o total.
 */

interface Kpi {
  key: string;
  label: string;
  value: string;
  hint: string;
  color: string;
  icon: typeof Target;
  series: { v: number }[];
}

/** Divide o período em N fatias e soma o indicador em cada uma. */
function bucketize(
  ops: { createdAt: string; value: number; status: string }[],
  from: Date,
  to: Date,
  pick: (list: { value: number; status: string }[]) => number,
  slices = 12,
): { v: number }[] {
  const start = from.getTime();
  const span = Math.max(1, to.getTime() - start);
  const buckets: { value: number; status: string }[][] = Array.from({ length: slices }, () => []);
  for (const o of ops) {
    const t = new Date(o.createdAt).getTime();
    const i = Math.min(slices - 1, Math.max(0, Math.floor(((t - start) / span) * slices)));
    buckets[i].push(o);
  }
  // Acumulado: a linha sobe ao longo do período em vez de serrilhar por dia,
  // que numa faixa de 60 px vira ruído.
  let acc = 0;
  return buckets.map((b) => {
    acc += pick(b);
    return { v: acc };
  });
}

export function KpiStrip() {
  const ops = useDashboardOps();
  const { range } = useDashboardRange();

  const kpis = useMemo<Kpi[]>(() => {
    const won = ops.filter((o) => o.status === "won");
    const revenue = won.reduce((s, o) => s + o.value, 0);
    const rate = ops.length ? Math.round((won.length / ops.length) * 100) : 0;
    const ticket = won.length ? revenue / won.length : 0;
    const openCount = ops.filter((o) => o.status === "open").length;

    return [
      {
        key: "oportunidades",
        label: "Oportunidades",
        value: ops.length.toLocaleString("pt-BR"),
        hint: `${openCount} ainda em aberto`,
        color: "#6366f1",
        icon: Target,
        series: bucketize(ops, range.from, range.to, (l) => l.length),
      },
      {
        key: "receita",
        label: "Receita ganha",
        value: shortBRL(revenue),
        hint: `${won.length} oportunidade${won.length === 1 ? "" : "s"} ganha${won.length === 1 ? "" : "s"}`,
        color: "#22c55e",
        icon: CircleDollarSign,
        series: bucketize(ops, range.from, range.to, (l) =>
          l.filter((o) => o.status === "won").reduce((s, o) => s + o.value, 0),
        ),
      },
      {
        key: "conversao",
        label: "Conversão",
        value: `${rate}%`,
        hint: `${won.length} de ${ops.length}`,
        color: "#0ea5e9",
        icon: TrendingUp,
        series: bucketize(ops, range.from, range.to, (l) =>
          l.filter((o) => o.status === "won").length,
        ),
      },
      {
        key: "ticket",
        label: "Ticket médio",
        value: won.length ? formatBRL(ticket) : "—",
        hint: won.length ? "por oportunidade ganha" : "sem ganhos no período",
        color: "#a855f7",
        icon: Wallet,
        series: bucketize(ops, range.from, range.to, (l) =>
          l.filter((o) => o.status === "won").reduce((s, o) => s + o.value, 0),
        ),
      },
    ];
  }, [ops, range.from, range.to]);

  return (
    <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {kpis.map((k) => {
        const Icon = k.icon;
        return (
          <div
            key={k.key}
            className="relative overflow-hidden rounded-2xl border bg-white p-4 shadow-sm"
          >
            {/* Faixa de cor: identifica o indicador antes da leitura do texto. */}
            <span
              className="absolute inset-x-0 top-0 h-1"
              style={{ background: k.color }}
              aria-hidden
            />
            <div className="flex items-start justify-between gap-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                {k.label}
              </p>
              <span
                className="flex size-7 shrink-0 items-center justify-center rounded-lg"
                style={{ background: `${k.color}15`, color: k.color }}
              >
                <Icon className="size-3.5" />
              </span>
            </div>
            <p className="mt-1 text-2xl font-bold leading-none tracking-tight text-slate-900">
              {k.value}
            </p>
            <p className="mt-1 text-[11px] text-slate-400">{k.hint}</p>
            <div className="-mx-4 -mb-4 mt-2 h-10">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={k.series} margin={{ top: 4, bottom: 0, left: 0, right: 0 }}>
                  <defs>
                    <linearGradient id={`kpi-${k.key}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={k.color} stopOpacity={0.28} />
                      <stop offset="100%" stopColor={k.color} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area
                    type="monotone"
                    dataKey="v"
                    stroke={k.color}
                    strokeWidth={2}
                    fill={`url(#kpi-${k.key})`}
                    isAnimationActive={false}
                    dot={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        );
      })}
    </div>
  );
}
