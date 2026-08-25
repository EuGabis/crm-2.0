"use client";

import { ConversionGauge, StatusDonut, ValueBars } from "./opportunity-widgets";
import { FunnelWidget, StageDistribution } from "./funnel-widgets";
import { GaCards, LeadSourceTable, ManualActionsCard } from "./report-widgets";
import {
  RecentSalesWidget,
  RevenueByMonthWidget,
  SubscriptionsWidget,
} from "./payment-widgets";
import { ServiceSlaWidget } from "./service-widgets";
import { widgetMeta, type WidgetConfig, type WidgetKey } from "./widget-catalog";
import { cn } from "@/lib/utils";

const SPAN_CLASS: Record<number, string> = {
  1: "md:col-span-2",
  2: "md:col-span-3",
  3: "md:col-span-6",
};

/**
 * Desenha um widget a partir da configuração salva. A grade é de 6 colunas:
 * span 1 = 1/3, span 2 = 1/2, span 3 = linha inteira — as mesmas proporções do
 * painel fixo que existia antes.
 */
export function DashboardWidget({
  config,
  onPipelineChange,
}: {
  config: WidgetConfig;
  onPipelineChange?: (pipelineId: string) => void;
}) {
  const meta = widgetMeta(config.key);
  if (!meta) return null;

  const pipeProps = meta.pipeline
    ? { pipelineId: config.pipelineId, onPipelineChange }
    : {};

  const content: Record<WidgetKey, React.ReactNode> = {
    "status-oportunidade": <StatusDonut {...pipeProps} />,
    "valor-oportunidade": <ValueBars {...pipeProps} />,
    "taxa-conversao": <ConversionGauge {...pipeProps} />,
    funil: <FunnelWidget {...pipeProps} />,
    "distribuicao-fases": <StageDistribution {...pipeProps} />,
    "fonte-leads": <LeadSourceTable />,
    "acoes-manuais": <ManualActionsCard />,
    "google-analytics": <GaCards />,
    "pagamentos-vendas": <RecentSalesWidget />,
    "pagamentos-receita": <RevenueByMonthWidget />,
    "pagamentos-assinaturas": <SubscriptionsWidget />,
    "atendimento-sla": <ServiceSlaWidget />,
  };

  return <div className={cn(SPAN_CLASS[meta.span])}>{content[config.key]}</div>;
}
