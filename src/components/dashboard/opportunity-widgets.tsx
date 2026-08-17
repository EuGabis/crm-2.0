"use client";

import {
  Bar,
  BarChart,
  Cell,
  PolarAngleAxis,
  Pie,
  PieChart,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  shortBRL,
  usePipelineSelection,
  WidgetCard,
  WidgetEmpty,
  type WidgetPipelineProps,
} from "./widget-card";
import { formatBRL } from "@/lib/data/repos/opportunities";
import { useDashboardOps } from "./date-range";
import { DrilldownDialog, useDrilldown } from "./drilldown";

/** Estilo único dos tooltips do painel (mesmo dos gráficos de Pagamentos). */
export const TOOLTIP_STYLE = {
  fontSize: 12,
  borderRadius: 8,
  border: "1px solid #e2e8f0",
} as const;

const STATUS_LABEL: Record<string, string> = {
  open: "Aberto(a)",
  won: "Ganho(a)",
  lost: "Perdido(a)",
};
const STATUS_COLOR: Record<string, string> = {
  open: "#6366f1",
  won: "#22c55e",
  lost: "#ef4444",
};

export function StatusDonut(props: WidgetPipelineProps = {}) {
  const [pipe, setPipe] = usePipelineSelection(props, "all");
  const ops = useDashboardOps(pipe);
  const { drilldown, open, close } = useDrilldown();
  const data = (["open", "won", "lost"] as const)
    .map((s) => ({
      status: s,
      name: STATUS_LABEL[s],
      value: ops.filter((o) => o.status === s).length,
      color: STATUS_COLOR[s],
    }))
    .filter((d) => d.value > 0);
  const total = ops.length;

  const openStatus = (i: number) => {
    const d = data[i];
    if (!d) return;
    open({
      title: `Oportunidades · ${d.name}`,
      ops: ops.filter((o) => o.status === d.status),
      pipelineId: pipe !== "all" ? pipe : undefined,
    });
  };

  if (total === 0) {
    return (
      <WidgetCard
        title="Status da Oportunidade"
        subtitle="Oportunidades criadas no período"
        pipelineId={pipe}
        onPipelineChange={setPipe}
      >
        <WidgetEmpty text="Nenhuma oportunidade criada no período escolhido." />
      </WidgetCard>
    );
  }

  return (
    <WidgetCard
      title="Status da Oportunidade"
      subtitle="Oportunidades criadas no período"
      pipelineId={pipe}
      onPipelineChange={setPipe}
    >
      <div className="flex items-center gap-4">
        <div className="relative h-[150px] w-[150px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              {/* rootTabIndex -1: o <Pie> nasce focável e o anel de foco do SVG vira um quadrado. */}
              <Pie
                data={data}
                dataKey="value"
                innerRadius={48}
                outerRadius={68}
                strokeWidth={0}
                rootTabIndex={-1}
                className="cursor-pointer"
                onClick={(_, i) => openStatus(i)}
              >
                {data.map((d) => (
                  <Cell key={d.name} fill={d.color} />
                ))}
              </Pie>
              {/* Sem o nome, o tooltip saía como ": 1". */}
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(v, name) => [
                  `${v} oportunidade${Number(v) === 1 ? "" : "s"}`,
                  name,
                ]}
              />
            </PieChart>
          </ResponsiveContainer>
          {/* Número sem rótulo não diz o que conta — "41" do quê? */}
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-xl font-bold leading-none text-slate-900">
              {total >= 1000 ? `${(total / 1000).toFixed(1)}K` : total}
            </span>
            <span className="text-[9px] uppercase tracking-wide text-slate-400">
              oportunidades
            </span>
          </div>
        </div>
        <ul className="space-y-1.5 text-xs">
          {data.map((d, i) => (
            <li key={d.name}>
              <button
                onClick={() => openStatus(i)}
                className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-slate-50"
              >
                <span className="size-2.5 rounded-sm" style={{ background: d.color }} />
                <span className="text-slate-600">
                  {d.name} · <span className="font-semibold text-slate-800">{d.value}</span>{" "}
                  <span className="text-slate-400">
                    ({total ? Math.round((d.value / total) * 100) : 0}%)
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <DrilldownDialog state={drilldown} onClose={close} />
    </WidgetCard>
  );
}

export function ValueBars(props: WidgetPipelineProps = {}) {
  const [pipe, setPipe] = usePipelineSelection(props, "all");
  const ops = useDashboardOps(pipe);
  const { drilldown, open, close } = useDrilldown();
  const data = (["open", "won", "lost"] as const).map((s) => ({
    status: s,
    name: STATUS_LABEL[s],
    valor: ops.filter((o) => o.status === s).reduce((sum, o) => sum + o.value, 0),
    fill: STATUS_COLOR[s],
  }));
  const total = data.reduce((s, d) => s + d.valor, 0);
  return (
    <WidgetCard
      title="Valor de Oportunidade"
      subtitle="Soma dos valores por status, no período"
      pipelineId={pipe}
      onPipelineChange={setPipe}
      footer={
        <p className="mt-2 border-t pt-2 text-center text-xs text-slate-500">
          Somando tudo <span className="font-bold text-slate-800">{formatBRL(total)}</span>
        </p>
      }
    >
      {total === 0 ? (
        <WidgetEmpty text="Nenhuma oportunidade com valor no período. Preencha o valor ao criar o lead." />
      ) : (
      <ResponsiveContainer width="100%" height={150}>
        <BarChart data={data} layout="vertical" margin={{ left: 10, right: 24 }}>
          {/* O formatador antigo dividia por mil e arredondava: com valores
              abaixo de R$ 1.000 todo o eixo virava "R$0K". */}
          <XAxis type="number" tickFormatter={shortBRL} fontSize={10} allowDecimals={false} />
          <YAxis type="category" dataKey="name" width={70} fontSize={10} />
          <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [formatBRL(Number(v)), "Valor"]} />
          <Bar
            dataKey="valor"
            radius={[0, 4, 4, 0]}
            className="cursor-pointer"
            onClick={(_, i) => {
              const d = data[i];
              if (!d) return;
              open({
                title: `Valor de oportunidade · ${d.name}`,
                ops: ops.filter((o) => o.status === d.status),
                pipelineId: pipe !== "all" ? pipe : undefined,
              });
            }}
          >
            {data.map((d) => (
              <Cell key={d.name} fill={d.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      )}
      <DrilldownDialog state={drilldown} onClose={close} />
    </WidgetCard>
  );
}

export function ConversionGauge(props: WidgetPipelineProps = {}) {
  const [pipe, setPipe] = usePipelineSelection(props, "all");
  const ops = useDashboardOps(pipe);
  const { drilldown, open, close } = useDrilldown();
  const won = ops.filter((o) => o.status === "won");
  const rate = ops.length ? Math.round((won.length / ops.length) * 100) : 0;
  const revenue = won.reduce((s, o) => s + o.value, 0);
  const data = [{ name: "conv", value: rate, fill: "#6366f1" }];
  return (
    <WidgetCard
      title="Taxa de conversão"
      subtitle="Ganhas ÷ total de oportunidades do período"
      pipelineId={pipe}
      onPipelineChange={setPipe}
      footer={
        <p className="mt-2 border-t pt-2 text-center text-xs text-slate-500">
          Receita ganha <span className="font-bold text-slate-800">{formatBRL(revenue)}</span>
        </p>
      }
    >
      {/* O anel inteiro é o alvo: clicar abre as oportunidades ganhas que
          formam a taxa (mais previsível do que acertar o arco fino). */}
      <button
        onClick={() =>
          open({
            title: `Taxa de conversão · ${rate}% (${won.length} de ${ops.length})`,
            ops: won,
            pipelineId: pipe !== "all" ? pipe : undefined,
          })
        }
        title="Ver as oportunidades ganhas"
        className="relative block h-[150px] w-full cursor-pointer"
      >
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart
            innerRadius="70%"
            outerRadius="95%"
            data={data}
            startAngle={90}
            endAngle={-270}
          >
            {/* SEM este eixo com domínio fixo, o Recharts escala o arco pelo
                MAIOR valor da série — que aqui é o próprio número. Resultado:
                2% desenhava um anel praticamente cheio, dizendo o oposto do
                número no meio. */}
            <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
            <RadialBar
              dataKey="value"
              angleAxisId={0}
              cornerRadius={8}
              background={{ fill: "#eef2ff" }}
            />
          </RadialBarChart>
        </ResponsiveContainer>
        <span className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold leading-none text-slate-900">{rate}%</span>
          <span className="mt-0.5 text-[10px] text-slate-400">
            {won.length} de {ops.length}
          </span>
        </span>
      </button>
      <DrilldownDialog state={drilldown} onClose={close} />
    </WidgetCard>
  );
}
