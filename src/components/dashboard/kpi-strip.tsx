"use client";

import { useMemo, useState } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip } from "recharts";
import { CircleDollarSign, Target, TrendingUp, Wallet } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { Opportunity } from "@/lib/data/types";
import { formatBRL } from "@/lib/data/repos/opportunities";
import { DrilldownDialog, useDrilldown } from "./drilldown";
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
 * O fiapo de gráfico é a série do próprio indicador dentro do período — não é
 * enfeite: mostra se o número veio de um pico isolado ou de um fluxo constante,
 * que é a pergunta seguinte de quem lê o total.
 */

interface Fatia {
  /** Acumulado até o fim da fatia — é o que a linha desenha. */
  v: number;
  /** O que entrou NESTA fatia. */
  inc: number;
  de: Date;
  ate: Date;
  ops: Opportunity[];
}

interface Kpi {
  key: string;
  label: string;
  value: string;
  hint: string;
  color: string;
  icon: typeof Target;
  serie: Fatia[];
  /** Como escrever o incremento de uma fatia (unidade x dinheiro). */
  fmtInc: (n: number) => string;
  /** As oportunidades que formam o número — para o drilldown. */
  opsDoTotal: Opportunity[];
  tituloDrill: string;
}

/**
 * Divide o período em fatias e soma o indicador em cada uma.
 *
 * ⚠️ As fatias eram 12 fixas, o que num mês dá 2,5 dias cada — impossível de
 * rotular ("de 27/07 a 29/07 e meio"?). Agora a fatia é o DIA quando o período
 * cabe em ~31 leituras, e só além disso agrupa. É o que permite o tooltip dizer
 * a que período o ponto se refere, que era a informação que faltava.
 */
function fatiar(
  ops: Opportunity[],
  from: Date,
  to: Date,
  pick: (list: Opportunity[]) => number,
  filtro: (o: Opportunity) => boolean
): Fatia[] {
  const DIA = 86400000;
  const inicio = from.getTime();
  const span = Math.max(DIA, to.getTime() - inicio);
  const dias = Math.ceil(span / DIA);
  const fatias = Math.min(dias, 31);
  const passo = span / fatias;

  const baldes: Opportunity[][] = Array.from({ length: fatias }, () => []);
  for (const o of ops) {
    const t = new Date(o.createdAt).getTime();
    const i = Math.min(fatias - 1, Math.max(0, Math.floor((t - inicio) / passo)));
    baldes[i].push(o);
  }

  // Acumulado: a linha sobe ao longo do período em vez de serrilhar por dia,
  // que numa faixa de 40 px vira ruído. O valor da fatia continua disponível
  // em `inc` — é o que o tooltip mostra junto, senão o número do ponto
  // (acumulado) contradiz a intuição de "quantas nesse dia".
  let acc = 0;
  return baldes.map((b, i) => {
    acc += pick(b);
    return {
      v: acc,
      inc: pick(b),
      de: new Date(inicio + i * passo),
      ate: new Date(inicio + (i + 1) * passo - 1),
      ops: b.filter(filtro),
    };
  });
}

/** Rótulo do período de uma fatia: um dia, ou o intervalo quando agrupa. */
function rotuloFatia(f: Fatia): string {
  const mesmoDia = f.de.toDateString() === f.ate.toDateString();
  if (mesmoDia) return format(f.de, "d 'de' MMM", { locale: ptBR });
  return `${format(f.de, "d MMM", { locale: ptBR })} a ${format(f.ate, "d MMM", { locale: ptBR })}`;
}

export function KpiStrip() {
  const ops = useDashboardOps();
  const { range } = useDashboardRange();
  const { drilldown, open, close } = useDrilldown();
  // Índice da fatia sob o mouse, por KPI. O texto aparece NO LUGAR do hint, e
  // não num tooltip flutuante: o card tem `overflow-hidden` (a faixa de cor
  // depende disso para arredondar nas pontas) e um balão do Recharts sairia
  // cortado pela borda.
  const [ativo, setAtivo] = useState<{ kpi: string; i: number } | null>(null);

  const kpis = useMemo<Kpi[]>(() => {
    const ganhas = ops.filter((o) => o.status === "won");
    const receita = ganhas.reduce((s, o) => s + o.value, 0);
    const taxa = ops.length ? Math.round((ganhas.length / ops.length) * 100) : 0;
    const ticket = ganhas.length ? receita / ganhas.length : 0;
    const abertas = ops.filter((o) => o.status === "open").length;
    const ehGanha = (o: Opportunity) => o.status === "won";
    const qualquer = () => true;

    return [
      {
        key: "oportunidades",
        label: "Oportunidades",
        value: ops.length.toLocaleString("pt-BR"),
        hint: `${abertas} ainda em aberto`,
        color: "#6366f1",
        icon: Target,
        serie: fatiar(ops, range.from, range.to, (l) => l.length, qualquer),
        fmtInc: (n) => `${n} nova${n === 1 ? "" : "s"}`,
        opsDoTotal: ops,
        tituloDrill: "Oportunidades do período",
      },
      {
        key: "receita",
        label: "Receita ganha",
        value: shortBRL(receita),
        hint: `${ganhas.length} oportunidade${ganhas.length === 1 ? "" : "s"} ganha${ganhas.length === 1 ? "" : "s"}`,
        color: "#22c55e",
        icon: CircleDollarSign,
        serie: fatiar(
          ops,
          range.from,
          range.to,
          (l) => l.filter(ehGanha).reduce((s, o) => s + o.value, 0),
          ehGanha
        ),
        fmtInc: (n) => formatBRL(n),
        opsDoTotal: ganhas,
        tituloDrill: "Oportunidades ganhas no período",
      },
      {
        key: "conversao",
        label: "Conversão",
        value: `${taxa}%`,
        hint: `${ganhas.length} de ${ops.length}`,
        color: "#0ea5e9",
        icon: TrendingUp,
        serie: fatiar(ops, range.from, range.to, (l) => l.filter(ehGanha).length, ehGanha),
        fmtInc: (n) => `${n} ganha${n === 1 ? "" : "s"}`,
        opsDoTotal: ganhas,
        tituloDrill: "Oportunidades ganhas no período",
      },
      {
        key: "ticket",
        label: "Ticket médio",
        value: ganhas.length ? formatBRL(ticket) : "—",
        hint: ganhas.length ? "por oportunidade ganha" : "sem ganhos no período",
        color: "#a855f7",
        icon: Wallet,
        serie: fatiar(
          ops,
          range.from,
          range.to,
          (l) => l.filter(ehGanha).reduce((s, o) => s + o.value, 0),
          ehGanha
        ),
        fmtInc: (n) => formatBRL(n),
        opsDoTotal: ganhas,
        tituloDrill: "Oportunidades ganhas no período",
      },
    ];
  }, [ops, range.from, range.to]);

  return (
    <>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((k) => {
          const Icon = k.icon;
          const fatia = ativo?.kpi === k.key ? k.serie[ativo.i] : undefined;
          // Clicar no ponto abre só aquele intervalo; clicar no resto do card
          // abre o período inteiro. É o mesmo drilldown dos outros widgets.
          const abrir = () =>
            fatia
              ? open({
                  title: `${k.label} · ${rotuloFatia(fatia)}`,
                  ops: fatia.ops,
                })
              : open({ title: k.tituloDrill, ops: k.opsDoTotal });

          return (
            <button
              key={k.key}
              type="button"
              onClick={abrir}
              className="relative overflow-hidden rounded-2xl border bg-white p-4 text-left shadow-sm transition hover:border-slate-300 hover:shadow-md"
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
              {/* Sob o mouse, esta linha deixa de ser o resumo e passa a ser a
                  leitura do ponto: o período, o que entrou nele e o acumulado. */}
              {fatia ? (
                <p className="mt-1 truncate text-[11px] font-medium" style={{ color: k.color }}>
                  {rotuloFatia(fatia)} · {k.fmtInc(fatia.inc)}
                  <span className="text-slate-400">
                    {" "}
                    · {k.fmtInc(fatia.v)} até aqui
                  </span>
                </p>
              ) : (
                <p className="mt-1 truncate text-[11px] text-slate-400">{k.hint}</p>
              )}
              {/*
                O índice sob o cursor vem da POSIÇÃO DO MOUSE neste container, e
                não do `onMouseMove` do Recharts.
                ⚠️ A primeira tentativa lia `activeTooltipIndex` do estado do
                gráfico e não funcionava: no Recharts 3 esse campo é
                `string | null` (`TooltipIndex`), não `number`, então a checagem
                de tipo descartava todo hover EM SILÊNCIO — o ponto e a linha do
                cursor apareciam (isso é interno do Recharts) e o texto nunca
                trocava. Medir aqui não depende de detalhe interno de versão.
                `Math.round` e não `Math.floor`: é o ponto MAIS PRÓXIMO do
                cursor, o mesmo critério que o Recharts usa para escolher qual
                `activeDot` desenhar — com `floor` os dois discordariam nas
                bordas e o texto falaria de um ponto diferente do marcado.
              */}
              <div
                className="-mx-4 -mb-4 mt-2 h-10"
                onMouseMove={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  if (r.width === 0 || k.serie.length === 0) return;
                  const p = (e.clientX - r.left) / r.width;
                  const i = Math.round(p * (k.serie.length - 1));
                  setAtivo({
                    kpi: k.key,
                    i: Math.min(k.serie.length - 1, Math.max(0, i)),
                  });
                }}
                onMouseLeave={() => setAtivo(null)}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={k.serie}
                    margin={{ top: 4, bottom: 0, left: 0, right: 0 }}
                  >
                    <defs>
                      <linearGradient id={`kpi-${k.key}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={k.color} stopOpacity={0.28} />
                        <stop offset="100%" stopColor={k.color} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    {/* Tooltip sem conteúdo: é ele que faz o Recharts calcular
                        o `activeTooltipIndex` e desenhar o `activeDot`. O texto
                        aparece na linha do hint, acima. */}
                    <Tooltip content={() => null} />
                    <Area
                      type="monotone"
                      dataKey="v"
                      stroke={k.color}
                      strokeWidth={2}
                      fill={`url(#kpi-${k.key})`}
                      isAnimationActive={false}
                      dot={false}
                      activeDot={{ r: 3, fill: k.color, stroke: "#fff", strokeWidth: 2 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </button>
          );
        })}
      </div>
      <DrilldownDialog state={drilldown} onClose={close} />
    </>
  );
}
