"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import {
  usePipelineSelection,
  WidgetCard,
  WidgetEmpty,
  type WidgetPipelineProps,
} from "./widget-card";
import { formatBRL } from "@/lib/data/repos/opportunities";
import { useDbPipeline } from "@/lib/data/repos/db/pipeline";
import { useDashboardOps } from "./date-range";
import { DrilldownDialog, useDrilldown } from "./drilldown";
import { TOOLTIP_STYLE } from "./opportunity-widgets";

export function FunnelWidget(props: WidgetPipelineProps = {}) {
  const [pipeId, setPipeId] = usePipelineSelection(props, "");
  const pipeline = useDbPipeline(pipeId);
  const ops = useDashboardOps();
  const { drilldown, open, close } = useDrilldown();
  if (!pipeline) return null;

  const rows = pipeline.stages.map((st) => {
    const stageOps = ops.filter((o) => o.pipelineId === pipeline.id && o.stageId === st.id);
    return {
      stage: st,
      ops: stageOps,
      count: stageOps.length,
      value: stageOps.reduce((s, o) => s + o.value, 0),
    };
  });
  const max = Math.max(1, ...rows.map((r) => r.count));
  const first = rows[0]?.count || 1;

  const totalOps = rows.reduce((sum, r) => sum + r.count, 0);

  return (
    <WidgetCard
      title="Funil"
      subtitle={`${totalOps} oportunidade${totalOps === 1 ? "" : "s"} do período neste pipeline`}
      pipelineId={pipeId}
      onPipelineChange={setPipeId}
      // Fase pertence a um pipeline: somar as de vários não significa nada.
      allowAll={false}
    >
      <div className="space-y-1">
        <div className="flex justify-end gap-6 pr-1 text-[10px] font-semibold text-slate-400">
          {/* Os dois títulos eram siglas sem explicação; o title diz a conta. */}
          <span className="w-16 text-right" title="Quantos, dos que entraram na primeira fase, chegaram até aqui">
            % da 1ª fase
          </span>
          <span className="w-20 text-right" title="Quantos passaram da fase imediatamente anterior para esta">
            % da fase anterior
          </span>
        </div>
        {rows.map((r, i) => {
          const cumulative = first ? (r.count / first) * 100 : 0;
          const prev = i === 0 ? r.count : rows[i - 1].count;
          const nextConv = prev ? (r.count / prev) * 100 : 0;
          return (
            <div key={r.stage.id} className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <button
                  onClick={() =>
                    open({
                      title: `${pipeline.name} · ${r.stage.name}`,
                      ops: r.ops,
                      pipelineId: pipeline.id,
                    })
                  }
                  title={`Ver as ${r.count} oportunidade${r.count === 1 ? "" : "s"} desta fase`}
                  className="flex h-9 min-w-[120px] cursor-pointer flex-col justify-center rounded px-2 text-left transition-opacity hover:opacity-85"
                  style={{ width: `${Math.max(18, (r.count / max) * 100)}%`, background: r.stage.color }}
                >
                  <span className="truncate text-[10px] font-bold leading-tight text-white">
                    {r.stage.name}
                  </span>
                  <span className="text-[9px] leading-tight text-white/90">
                    {r.count} · {formatBRL(r.value)}
                  </span>
                </button>
              </div>
              <span className="w-16 text-right text-[11px] font-medium text-slate-600">
                {cumulative.toFixed(1)}%
              </span>
              <span className="w-20 text-right text-[11px] font-medium text-slate-600">
                {(i === 0 ? 100 : nextConv).toFixed(1)}%
              </span>
            </div>
          );
        })}
      </div>
      <DrilldownDialog state={drilldown} onClose={close} />
    </WidgetCard>
  );
}

export function StageDistribution(props: WidgetPipelineProps = {}) {
  const [pipeId, setPipeId] = usePipelineSelection(props, "");
  const pipeline = useDbPipeline(pipeId);
  const ops = useDashboardOps();
  const { drilldown, open, close } = useDrilldown();
  if (!pipeline) return null;

  // TODAS as fases entram na lista (a legenda mostra as vazias em cinza): antes
  // as zeradas sumiam, e a legenda do donut não batia com o funil ao lado.
  const all = pipeline.stages.map((st) => {
    const stageOps = ops.filter((o) => o.pipelineId === pipeline.id && o.stageId === st.id);
    return {
      name: st.name,
      ops: stageOps,
      value: stageOps.length,
      money: stageOps.reduce((s, o) => s + o.value, 0),
      color: st.color,
    };
  });
  const data = all.filter((d) => d.value > 0); // só o que tem fatia desenhável
  const total = data.reduce((s, d) => s + d.value, 0);

  const openStage = (i: number) => {
    const d = data[i];
    if (!d) return;
    open({ title: `${pipeline.name} · ${d.name}`, ops: d.ops, pipelineId: pipeline.id });
  };

  if (total === 0) {
    return (
      <WidgetCard
        title="Distribuição de fases"
        subtitle="Como as oportunidades do período se espalham pelas fases"
        pipelineId={pipeId}
        onPipelineChange={setPipeId}
        allowAll={false}
      >
        <WidgetEmpty text="Nenhuma oportunidade neste pipeline no período escolhido." />
      </WidgetCard>
    );
  }

  return (
    <WidgetCard
      title="Distribuição de fases"
      subtitle="Como as oportunidades do período se espalham pelas fases"
      pipelineId={pipeId}
      onPipelineChange={setPipeId}
      allowAll={false}
    >
      <div className="flex items-center gap-4">
        <div className="relative h-[190px] w-[190px] shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              {/* rootTabIndex -1: o <Pie> nasce focável e o anel de foco do SVG vira um quadrado. */}
              <Pie
                data={data}
                dataKey="value"
                innerRadius={58}
                outerRadius={85}
                strokeWidth={0}
                rootTabIndex={-1}
                className="cursor-pointer"
                onClick={(_, i) => openStage(i)}
              >
                {data.map((d) => (
                  <Cell key={d.name} fill={d.color} />
                ))}
              </Pie>
              <Tooltip contentStyle={TOOLTIP_STYLE} />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-xl font-bold leading-none text-slate-900">
              {total.toLocaleString("pt-BR")}
            </span>
            <span className="text-[9px] uppercase tracking-wide text-slate-400">no pipeline</span>
          </div>
        </div>
        <ul className="min-w-0 flex-1 space-y-1 text-[11px]">
          {all.map((d) => {
            const i = data.findIndex((x) => x.name === d.name);
            const empty = d.value === 0;
            return (
              <li key={d.name}>
                <button
                  onClick={() => !empty && openStage(i)}
                  disabled={empty}
                  className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-slate-50 disabled:cursor-default disabled:hover:bg-transparent"
                >
                  <span
                    className="size-2 shrink-0 rounded-sm"
                    style={{ background: empty ? "#e2e8f0" : d.color }}
                  />
                  <span className={`truncate ${empty ? "text-slate-400" : "text-slate-600"}`}>
                    <span className="font-medium">{d.name}</span> ·{" "}
                    {d.value === 0 ? (
                      "vazia"
                    ) : (
                      <>
                        {d.value} ({Math.round((d.value / total) * 100)}%) · {formatBRL(d.money)}
                      </>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <DrilldownDialog state={drilldown} onClose={close} />
    </WidgetCard>
  );
}
