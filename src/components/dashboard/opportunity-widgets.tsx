"use client";

import type { ReactNode } from "react";
import {
  Meter,
  MarkedBarRow,
  ShareBar,
  usePipelineSelection,
  WidgetCard,
  WidgetEmpty,
  type WidgetPipelineProps,
} from "./widget-card";
import { formatBRL } from "@/lib/data/repos/opportunities";
import { useDashboardOps } from "./date-range";
import { DrilldownDialog, useDrilldown } from "./drilldown";

/**
 * Estilo único dos tooltips do painel.
 *
 * Continua exportado daqui porque é a casa dele desde o começo e os gráficos de
 * Pagamentos e o de fases importam deste módulo — mesmo agora que os três
 * widgets de oportunidade deixaram de usar Recharts.
 */
export const TOOLTIP_STYLE = {
  fontSize: 12,
  borderRadius: 8,
  border: "1px solid #e2e8f0",
} as const;

const STATUS = [
  { key: "open", label: "Em aberto", color: "#6366f1" },
  { key: "won", label: "Ganhas", color: "#22c55e" },
  { key: "lost", label: "Perdidas", color: "#ef4444" },
] as const;

/**
 * Porcentagem para a lista, onde a contagem crua aparece ao lado.
 *
 * ⚠️ Abaixo de 1% escreve "<1%", e não o valor arredondado. Com 3 de 313 o
 * arredondamento dava "1%" — igual ao que 3,1 de 313 daria, e do lado de um
 * "98%" a leitura fica de que 1% e 98% somam com um terceiro 1%. Uma casa
 * decimal ("1,0%") é pior ainda: sugere precisão e o número real é 0,96%.
 */
function pct(parte: number, todo: number): string {
  if (todo <= 0) return "0%";
  const p = (parte / todo) * 100;
  if (p > 0 && p < 1) return "<1%";
  return `${Math.round(p)}%`;
}

/**
 * O mesmo número como MANCHETE do card, onde "<1%" seria fraco.
 *
 * ⚠️ Trunca em vez de arredondar: `toFixed(1)` em 0,958 devolve "1,0%",
 * cruzando justamente o limiar que a lista chama de "<1%" — dois lugares do
 * painel diriam coisas diferentes sobre o mesmo número.
 */
function pctManchete(p: number): string {
  if (p > 0 && p < 1) {
    const truncado = Math.floor(p * 10) / 10;
    // Abaixo de 0,1% (1 ganha em 1.000+) truncar dá "0%", e uma manchete de
    // "0%" com oportunidade ganha embaixo se lê como erro do painel.
    if (truncado === 0) return "<0,1%";
    return `${truncado.toString().replace(".", ",")}%`;
  }
  return `${Math.round(p)}%`;
}

/** Número grande do topo do card, clicável para o drilldown do total. */
function CardTotal({
  value,
  caption,
  onClick,
}: {
  value: string;
  caption: string;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="block w-full text-left">
      <p className="text-2xl font-bold leading-none tracking-tight text-slate-900">{value}</p>
      <p className="mt-1 text-[10px] uppercase tracking-wide text-slate-400">{caption}</p>
    </button>
  );
}

/**
 * Composição das oportunidades por status.
 *
 * ⚠️ **Era uma rosca, e a rosca não funcionava aqui.** Com 307 de 313 em
 * aberto, a fatia de "em aberto" tomava o anel inteiro e as duas de 1% viravam
 * um fio de um pixel: o card gastava 150 px de altura para dizer "existe uma
 * cor". Hoje a composição vive numa barra de 6 px e os números aparecem como
 * texto, que é a única forma de 3 em 313 ficar legível.
 *
 * O rótulo ao lado de cada marca também é o que sustenta a paleta: a separação
 * entre o verde de "ganhas" e o vermelho de "perdidas" fica no piso da
 * checagem de daltonismo (ΔE 7,4 em deuteranopia), e ali o texto deixa de ser
 * enfeite e passa a ser o que carrega a identidade.
 */
export function StatusDonut(props: WidgetPipelineProps = {}) {
  const [pipe, setPipe] = usePipelineSelection(props, "all");
  const ops = useDashboardOps(pipe);
  const { drilldown, open, close } = useDrilldown();
  const total = ops.length;

  const linhas = STATUS.map((s) => {
    const lista = ops.filter((o) => o.status === s.key);
    return { ...s, count: lista.length, ops: lista };
  });

  const card = (children: ReactNode) => (
    <WidgetCard
      title="Status da oportunidade"
      subtitle="Composição do que foi criado no período"
      pipelineId={pipe}
      onPipelineChange={setPipe}
    >
      {children}
      <DrilldownDialog state={drilldown} onClose={close} />
    </WidgetCard>
  );

  if (total === 0) {
    return card(<WidgetEmpty text="Nenhuma oportunidade criada no período escolhido." />);
  }

  return card(
    <div>
      {/* O número grande vem primeiro: "quantas?" é a pergunta anterior a "como
          se dividem?", e era ela que estava escondida no meio do anel. */}
      <CardTotal
        value={total.toLocaleString("pt-BR")}
        caption="oportunidades no período"
        onClick={() => open({ title: "Oportunidades do período", ops })}
      />
      <div className="mt-3">
        <ShareBar
          parts={linhas.map((l) => ({
            key: l.key,
            label: l.label,
            value: l.count,
            color: l.color,
          }))}
        />
      </div>
      <div className="mt-2.5 space-y-1">
        {linhas.map((l) => (
          <MarkedBarRow
            key={l.key}
            label={l.label}
            color={l.color}
            share={l.count}
            total={total}
            value={l.count.toLocaleString("pt-BR")}
            hint={pct(l.count, total)}
            onClick={() =>
              open({
                title: `Oportunidades · ${l.label}`,
                ops: l.ops,
                pipelineId: pipe !== "all" ? pipe : undefined,
              })
            }
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Valor em reais por status.
 *
 * ⚠️ **Era um gráfico de barras do Recharts com eixo, e virava um gráfico de
 * UMA barra**: na prática só "em aberto" tem valor, então duas das três linhas
 * ficavam em branco e uma faixa de eixo descrevia uma única marca. Agora o
 * valor é rótulo direto ao lado do nome — o eixo era justamente a peça que
 * obrigava a passar o mouse para saber quanto é.
 */
export function ValueBars(props: WidgetPipelineProps = {}) {
  const [pipe, setPipe] = usePipelineSelection(props, "all");
  const ops = useDashboardOps(pipe);
  const { drilldown, open, close } = useDrilldown();

  const linhas = STATUS.map((s) => {
    const lista = ops.filter((o) => o.status === s.key);
    return { ...s, ops: lista, valor: lista.reduce((sum, o) => sum + o.value, 0) };
  });
  const total = linhas.reduce((s, l) => s + l.valor, 0);
  // A escala das barras é o MAIOR valor, não a soma: a pergunta do card é
  // comparar "aberto" com "ganho", e contra a soma as três barras encolheriam.
  const maior = Math.max(...linhas.map((l) => l.valor));

  const card = (children: ReactNode) => (
    <WidgetCard
      title="Valor de oportunidade"
      subtitle="Soma dos valores por status, no período"
      pipelineId={pipe}
      onPipelineChange={setPipe}
    >
      {children}
      <DrilldownDialog state={drilldown} onClose={close} />
    </WidgetCard>
  );

  if (total === 0) {
    return card(
      <WidgetEmpty text="Nenhuma oportunidade com valor no período. Preencha o valor ao criar o lead." />
    );
  }

  return card(
    <div>
      <CardTotal
        value={formatBRL(total)}
        caption="somando todos os status"
        onClick={() => open({ title: "Oportunidades do período", ops })}
      />
      <div className="mt-3 space-y-1">
        {linhas.map((l) => (
          <MarkedBarRow
            key={l.key}
            label={l.label}
            color={l.color}
            share={l.valor}
            total={maior}
            value={formatBRL(l.valor)}
            onClick={() =>
              open({
                title: `Valor de oportunidade · ${l.label}`,
                ops: l.ops,
                pipelineId: pipe !== "all" ? pipe : undefined,
              })
            }
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Taxa de conversão.
 *
 * ⚠️ **Era um anel radial, e em 1% o anel não dizia nada**: o arco virava um
 * risco de dois pixels no topo, indistinguível de zero, enquanto o texto no
 * meio dizia "1%". Razão contra um limite é medidor, não rosca — na régua reta
 * 1% ocupa 1% do comprimento e continua sendo um traço visível.
 *
 * O que o anel também escondia: conversão baixa pode ser "perdemos" ou "ainda
 * não decidiu", e são conclusões opostas. As três linhas de baixo separam
 * ganho, perda e o que segue em aberto, e a faixa cinza dá a taxa entre as
 * DECIDIDAS — a única comparável entre períodos de tamanhos diferentes, porque
 * não depende de quantas ainda estão na mesa.
 */
export function ConversionGauge(props: WidgetPipelineProps = {}) {
  const [pipe, setPipe] = usePipelineSelection(props, "all");
  const ops = useDashboardOps(pipe);
  const { drilldown, open, close } = useDrilldown();

  const ganhas = ops.filter((o) => o.status === "won");
  const perdidas = ops.filter((o) => o.status === "lost");
  const abertas = ops.filter((o) => o.status === "open");
  const taxa = ops.length ? (ganhas.length / ops.length) * 100 : 0;
  const receita = ganhas.reduce((s, o) => s + o.value, 0);
  const decididas = ganhas.length + perdidas.length;

  const abrir = (titulo: string, lista: typeof ops) =>
    open({ title: titulo, ops: lista, pipelineId: pipe !== "all" ? pipe : undefined });

  return (
    <WidgetCard
      title="Taxa de conversão"
      subtitle="Ganhas ÷ total de oportunidades do período"
      pipelineId={pipe}
      onPipelineChange={setPipe}
      footer={
        <p className="mt-2 border-t pt-2 text-[11px] text-slate-500">
          Receita ganha <span className="font-bold text-slate-800">{formatBRL(receita)}</span>
        </p>
      }
    >
      <div>
        <button
          type="button"
          onClick={() => abrir(`Taxa de conversão · ${ganhas.length} de ${ops.length}`, ganhas)}
          className="block w-full text-left"
          title="Ver as oportunidades ganhas"
        >
          <p className="text-3xl font-bold leading-none tracking-tight text-slate-900">
            {pctManchete(taxa)}
          </p>
          <p className="mt-1 text-[10px] uppercase tracking-wide text-slate-400">
            {ganhas.length.toLocaleString("pt-BR")} de {ops.length.toLocaleString("pt-BR")}{" "}
            oportunidades
          </p>
          <div className="mt-2.5">
            <Meter pct={taxa} color="#6366f1" />
          </div>
        </button>

        {decididas > 0 && (
          <p className="mt-2 rounded-md bg-slate-50 px-2 py-1.5 text-[10px] leading-relaxed text-slate-500">
            Entre as {decididas} já decididas, {pct(ganhas.length, decididas)} fecharam.
          </p>
        )}

        <div className="mt-2 space-y-1">
          <MarkedBarRow
            label="Ganhas"
            color="#22c55e"
            share={ganhas.length}
            total={ops.length}
            value={ganhas.length.toLocaleString("pt-BR")}
            onClick={() => abrir("Oportunidades ganhas", ganhas)}
          />
          <MarkedBarRow
            label="Perdidas"
            color="#ef4444"
            share={perdidas.length}
            total={ops.length}
            value={perdidas.length.toLocaleString("pt-BR")}
            onClick={() => abrir("Oportunidades perdidas", perdidas)}
          />
          {/* Cinza, e não uma quarta cor: "em aberto" aqui é o contexto contra
              o qual se lê ganho e perda, não um terceiro resultado. */}
          <MarkedBarRow
            label="Ainda em aberto"
            color="#94a3b8"
            share={abertas.length}
            total={ops.length}
            value={abertas.length.toLocaleString("pt-BR")}
            onClick={() => abrir("Oportunidades em aberto", abertas)}
          />
        </div>
      </div>
      <DrilldownDialog state={drilldown} onClose={close} />
    </WidgetCard>
  );
}
