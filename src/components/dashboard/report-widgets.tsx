"use client";

import Link from "next/link";
import { ArrowRight, Inbox } from "lucide-react";
import { WidgetCard } from "./widget-card";
import { formatBRL } from "@/lib/data/repos/opportunities";
import { useDashboardOps } from "./date-range";
import { DrilldownDialog, useDrilldown } from "./drilldown";

export function LeadSourceTable() {
  const ops = useDashboardOps();
  const { drilldown, open, close } = useDrilldown();
  const bySource = new Map<string, typeof ops>();
  for (const o of ops) {
    const list = bySource.get(o.source) ?? [];
    list.push(o);
    bySource.set(o.source, list);
  }
  const rows = [...bySource.entries()].map(([source, list]) => ({
    source,
    ops: list,
    total: list.length,
    value: list.reduce((s, o) => s + o.value, 0),
    open: list.filter((o) => o.status === "open").length,
    won: list.filter((o) => o.status === "won").length,
    lost: list.filter((o) => o.status === "lost").length,
  }));

  const totalLeads = rows.reduce((sum, r) => sum + r.total, 0);

  return (
    <WidgetCard
      title="Relatório de fonte de leads"
      subtitle={`De onde vieram as ${totalLeads} oportunidade${totalLeads === 1 ? "" : "s"} do período`}
    >
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b text-[11px] text-slate-400">
              <th className="py-2 pr-2 font-medium">Fonte</th>
              <th className="px-2 py-2 font-medium">Total de leads</th>
              <th className="px-2 py-2 font-medium">Valores totais</th>
              <th className="px-2 py-2 font-medium">Aberto</th>
              <th className="px-2 py-2 font-medium">Ganho(a)</th>
              <th className="px-2 py-2 font-medium">Perdido(a)</th>
              <th className="px-2 py-2 font-medium">% de ganhos</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.source}
                onClick={() =>
                  open({ title: `Fonte de leads · ${r.source}`, ops: r.ops })
                }
                title={`Ver as ${r.total} oportunidade${r.total === 1 ? "" : "s"} desta fonte`}
                className="cursor-pointer border-b last:border-0 hover:bg-slate-50"
              >
                <td className="py-2 pr-2 font-medium text-slate-700">{r.source}</td>
                <td className="px-2 py-2">{r.total}</td>
                <td className="px-2 py-2">{formatBRL(r.value)}</td>
                <td className="px-2 py-2">{r.open}</td>
                <td className="px-2 py-2 text-emerald-600">{r.won}</td>
                <td className="px-2 py-2 text-red-500">{r.lost}</td>
                <td className="px-2 py-2 font-semibold">
                  {r.total ? ((r.won / r.total) * 100).toFixed(1) : "0.0"}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <p className="py-6 text-center text-xs text-slate-400">
            Nenhuma oportunidade no período selecionado.
          </p>
        )}
      </div>
      <DrilldownDialog state={drilldown} onClose={close} />
    </WidgetCard>
  );
}

export function ManualActionsCard() {
  return (
    <WidgetCard title="Ações manuais">
      <div className="grid grid-cols-3 gap-3 py-2 text-center">
        {[
          { label: "Telefone", value: 0 },
          { label: "SMS", value: 0 },
          { label: "Total pendente", value: 0 },
        ].map((m) => (
          <div key={m.label} className="rounded-lg bg-slate-50 py-3">
            <p className="text-lg font-bold text-slate-900">{m.value}</p>
            <p className="text-[11px] text-slate-500">{m.label}</p>
          </div>
        ))}
      </div>
      <Link
        href="/conversas"
        className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:underline"
      >
        Ir para ações manuais <ArrowRight className="size-3" />
      </Link>
    </WidgetCard>
  );
}

export function GaCards() {
  const metrics = [
    "Total de visitantes",
    "Visualizações de página",
    "Visualizações diretas",
    "Visualizações pagas",
    "Visualizações sociais",
    "Visualizações orgânicas",
  ];
  return (
    <WidgetCard title="Relatório do Google Analytics (Últimos 12 meses)">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
        {metrics.map((m) => (
          <div key={m} className="rounded-lg bg-slate-50 p-3 text-center">
            <p className="text-lg font-bold text-slate-900">0</p>
            <p className="text-[10px] leading-tight text-slate-500">{m}</p>
          </div>
        ))}
      </div>
      <div className="mt-3 flex h-24 flex-col items-center justify-center rounded-lg border border-dashed text-slate-400">
        <Inbox className="size-5" />
        <p className="mt-1 text-xs">Nenhum dado encontrado — conecte o Google Analytics</p>
      </div>
    </WidgetCard>
  );
}
