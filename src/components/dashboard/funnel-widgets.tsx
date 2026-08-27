"use client";

import {
  MarkedBarRow,
  usePipelineSelection,
  WidgetCard,
  WidgetEmpty,
  type WidgetPipelineProps,
} from "./widget-card";
import { formatBRL } from "@/lib/data/repos/opportunities";
import { useDbPipeline } from "@/lib/data/repos/db/pipeline";
import { useDashboardOps } from "./date-range";
import { DrilldownDialog, useDrilldown } from "./drilldown";

/**
 * Funil do pipeline.
 *
 * ⚠️ **A barra mentia sobre a grandeza.** A largura tinha piso de 18%
 * (`Math.max(18, ...)`), imposto para o rótulo caber DENTRO dela — então uma
 * fase com 2 oportunidades de 73 desenhava quase um quinto da barra da
 * primeira fase. O piso existia por causa do rótulo, e a correção foi tirar o
 * rótulo de dentro: com nome à esquerda e valor à direita, a barra fica livre
 * para ser proporcional de verdade e nenhum texto pode ser cortado por ela.
 *
 * De quebra a linha caiu de 40 px para 20 px de altura, e um pipeline de 9
 * fases passou a caber na mesma altura do card ao lado em vez de esticar o
 * painel.
 */
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
      <div className="space-y-1.5">
        <div className="flex items-end gap-2 pb-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-400">
          <span className="w-[72px] shrink-0">Fase</span>
          <span className="min-w-0 flex-1" />
          <span
            className="w-10 shrink-0 text-right"
            title="Quantos, dos que estão na primeira fase, chegaram até aqui"
          >
            da 1ª
          </span>
          <span
            className="w-10 shrink-0 text-right"
            title="Quantos há nesta fase em relação à fase imediatamente anterior. Acima de 100% significa que esta fase tem MAIS oportunidades que a anterior — normal num retrato do funil, onde os leads não avançam em bloco."
          >
            da ant.
          </span>
        </div>
        {rows.map((r, i) => {
          const cumulative = first ? (r.count / first) * 100 : 0;
          const prev = i === 0 ? r.count : rows[i - 1].count;
          const nextConv = i === 0 ? 100 : prev ? (r.count / prev) * 100 : 0;
          // Proporcional, com piso de 3 px só para o não-zero: sem o piso, uma
          // fase com 1 oportunidade some e o funil parece ter uma fase menos.
          const largura = r.count > 0 ? `max(3px, ${((r.count / max) * 100).toFixed(2)}%)` : "0px";
          return (
            <button
              key={r.stage.id}
              type="button"
              onClick={() =>
                open({
                  title: `${pipeline.name} · ${r.stage.name}`,
                  ops: r.ops,
                  pipelineId: pipeline.id,
                })
              }
              disabled={r.count === 0}
              title={`Ver as ${r.count} oportunidade${r.count === 1 ? "" : "s"} desta fase`}
              className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-slate-50 disabled:cursor-default disabled:hover:bg-transparent"
            >
              <span
                className="w-[72px] shrink-0 truncate text-[11px] font-medium text-slate-700"
                title={r.stage.name}
              >
                {r.stage.name}
              </span>
              <span className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100">
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: largura,
                    // Degradê leve no sentido da barra: profundidade sem
                    // inventar cor nova (a cor da fase segue sendo a base).
                    backgroundImage: `linear-gradient(90deg, ${r.stage.color}, ${r.stage.color}bb)`,
                  }}
                />
              </span>
              {/* Contagem e dinheiro como rótulo DIRETO, fora da barra: era o
                  texto dentro dela que obrigava o piso de largura. */}
              <span className="w-[86px] shrink-0 text-right text-[10px] leading-tight">
                <span className="font-semibold tabular-nums text-slate-800">{r.count}</span>
                <span className="text-slate-400"> · {formatBRL(r.value)}</span>
              </span>
              <span className="w-10 shrink-0 text-right text-[10px] font-medium tabular-nums text-slate-600">
                {cumulative.toFixed(0)}%
              </span>
              {/* Acima de 100% a fase tem MAIS leads que a anterior. Não é erro
                  de conta — é retrato de funil, onde ninguém avança em bloco —
                  mas ler "250%" como conversão engana, e o âmbar é o que faz
                  parar e passar o mouse no cabeçalho da coluna. */}
              <span
                className={`w-10 shrink-0 text-right text-[10px] font-medium tabular-nums ${
                  nextConv > 100 ? "text-amber-600" : "text-slate-600"
                }`}
              >
                {nextConv.toFixed(0)}%
              </span>
            </button>
          );
        })}
      </div>
      <DrilldownDialog state={drilldown} onClose={close} />
    </WidgetCard>
  );
}

/**
 * Distribuição das oportunidades pelas fases do pipeline.
 *
 * ⚠️ **Era uma rosca de 9 fatias com uma delas em 82%.** Duas coisas erradas
 * de uma vez: passando de ~6 fatias as vizinhas ficam indistinguíveis, e com
 * uma fatia dominante as outras oito viram fios. Além disso a rosca precisava
 * de uma legenda de 9 linhas ao lado só para dizer o que era cada cor — ou
 * seja, a informação já estava em texto, e o anel era o que sobrava.
 *
 * Barras rotuladas mostram cada fase com nome, valor e proporção legíveis, e a
 * cor da fase continua sendo a identidade.
 *
 * A ordem é a **do pipeline**, não a do tamanho: fase é categoria ORDENADA
 * (Entrada vem antes de Ganho), e é a sequência que responde "onde o funil
 * está entupido". Ranquear por volume jogaria essa leitura fora.
 */
export function StageDistribution(props: WidgetPipelineProps = {}) {
  const [pipeId, setPipeId] = usePipelineSelection(props, "");
  const pipeline = useDbPipeline(pipeId);
  const ops = useDashboardOps();
  const { drilldown, open, close } = useDrilldown();
  if (!pipeline) return null;

  // TODAS as fases entram (as vazias em cinza): antes as zeradas sumiam e a
  // lista não batia com o funil ao lado.
  const all = pipeline.stages.map((st) => {
    const stageOps = ops.filter((o) => o.pipelineId === pipeline.id && o.stageId === st.id);
    return {
      id: st.id,
      name: st.name,
      ops: stageOps,
      value: stageOps.length,
      money: stageOps.reduce((s, o) => s + o.value, 0),
      color: st.color,
    };
  });
  const total = all.reduce((s, d) => s + d.value, 0);
  const maior = Math.max(1, ...all.map((d) => d.value));

  const card = (children: React.ReactNode) => (
    <WidgetCard
      title="Distribuição de fases"
      subtitle="Como as oportunidades do período se espalham pelas fases"
      pipelineId={pipeId}
      onPipelineChange={setPipeId}
      allowAll={false}
    >
      {children}
      <DrilldownDialog state={drilldown} onClose={close} />
    </WidgetCard>
  );

  if (total === 0) {
    return card(<WidgetEmpty text="Nenhuma oportunidade neste pipeline no período escolhido." />);
  }

  const cheia = all.reduce((a, b) => (b.value > a.value ? b : a), all[0]);

  return card(
    <div>
      {/* Uma frase dizendo qual fase concentra o funil: era a conclusão que o
          leitor tinha que montar sozinho comparando fatias. */}
      <p className="mb-2.5 text-[11px] leading-relaxed text-slate-500">
        <span className="font-semibold text-slate-800">{cheia.name}</span> concentra{" "}
        <span className="font-semibold text-slate-800">
          {Math.round((cheia.value / total) * 100)}%
        </span>{" "}
        das {total.toLocaleString("pt-BR")} oportunidades.
      </p>
      <div className="space-y-1">
        {all.map((d) => (
          <MarkedBarRow
            key={d.id}
            label={d.name}
            labelHint={d.value > 0 ? formatBRL(d.money) : "vazia"}
            color={d.color}
            share={d.value}
            // Escala pela fase MAIS CHEIA, não pelo total: contra o total, oito
            // barras de 1–6% ficariam indistinguíveis entre si.
            total={maior}
            value={d.value.toLocaleString("pt-BR")}
            hint={`${Math.round((d.value / total) * 100)}%`}
            onClick={() =>
              open({ title: `${pipeline.name} · ${d.name}`, ops: d.ops, pipelineId: pipeline.id })
            }
          />
        ))}
      </div>
    </div>
  );
}
