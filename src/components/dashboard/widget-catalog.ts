/**
 * Catálogo de widgets do painel de controle.
 *
 * Fica separado dos componentes de propósito: o diálogo de personalização
 * precisa listar os widgets disponíveis (nome, descrição, se pede pipeline,
 * se exige permissão) sem importar Recharts e as telas inteiras junto.
 */

export type WidgetKey =
  | "status-oportunidade"
  | "valor-oportunidade"
  | "taxa-conversao"
  | "funil"
  | "distribuicao-fases"
  | "fonte-leads"
  | "acoes-manuais"
  | "google-analytics"
  | "pagamentos-vendas"
  | "pagamentos-assinaturas"
  | "pagamentos-receita"
  | "atendimento-sla";

export interface WidgetMeta {
  key: WidgetKey;
  title: string;
  description: string;
  /** Ocupa a linha inteira (tabelas/listas) em vez de 1/3 ou 1/2. */
  span: 1 | 2 | 3;
  /** Widget escolhe um pipeline (o valor fica salvo na visualização). */
  pipeline?: boolean;
  /** Módulo que o usuário precisa enxergar para o widget aparecer. */
  requires?: string;
}

export const WIDGETS: WidgetMeta[] = [
  {
    key: "status-oportunidade",
    title: "Status da oportunidade",
    description: "Rosca de abertas, ganhas e perdidas.",
    span: 1,
    pipeline: true,
  },
  {
    key: "valor-oportunidade",
    title: "Valor de oportunidade",
    description: "Barras de valor por status, com receita total.",
    span: 1,
    pipeline: true,
  },
  {
    key: "taxa-conversao",
    title: "Taxa de conversão",
    description: "Percentual de ganhas e receita ganha no período.",
    span: 1,
    pipeline: true,
  },
  {
    key: "funil",
    title: "Funil de leads",
    description: "Fases de um pipeline, com conversão cumulativa.",
    span: 2,
    pipeline: true,
  },
  {
    key: "distribuicao-fases",
    title: "Distribuição de fases",
    description: "Quanto do funil está parado em cada fase.",
    span: 2,
    pipeline: true,
  },
  {
    key: "fonte-leads",
    title: "Relatório de fonte de leads",
    description: "Leads, valores e ganhos por origem.",
    span: 3,
  },
  {
    key: "acoes-manuais",
    title: "Ações manuais",
    description: "Fila de ligações e SMS pendentes.",
    span: 2,
  },
  {
    key: "google-analytics",
    title: "Google Analytics",
    description: "Visitantes e visualizações (depende da integração).",
    span: 3,
  },
  {
    key: "pagamentos-vendas",
    title: "Vendas recentes (Guru)",
    description: "Últimas vendas sincronizadas, com status e valor.",
    span: 2,
    requires: "pagamentos",
  },
  {
    key: "pagamentos-receita",
    title: "Receita por mês (Guru)",
    description: "Receita aprovada dos últimos meses.",
    span: 2,
    requires: "pagamentos",
  },
  {
    key: "atendimento-sla",
    title: "Atendimento (SLA)",
    description:
      "Cumprimento da meta de primeira resposta, resposta típica e quem está esperando.",
    span: 2,
    requires: "relatorios",
  },
  {
    key: "pagamentos-assinaturas",
    title: "Assinaturas (Guru)",
    description: "Ativas, atrasadas e canceladas.",
    span: 1,
    requires: "pagamentos",
  },
];

export function widgetMeta(key: WidgetKey): WidgetMeta | undefined {
  return WIDGETS.find((w) => w.key === key);
}

/** Um widget dentro de uma visualização: a chave + a configuração dele. */
export interface WidgetConfig {
  key: WidgetKey;
  /** "all" = todos os pipelines; "" = primeiro pipeline (funil/distribuição). */
  pipelineId?: string;
}

/**
 * Layout que todo mundo vê antes de personalizar — é exatamente o painel que
 * existia fixo no código, para que ninguém perca nada ao ganhar a
 * personalização.
 */
export const DEFAULT_WIDGETS: WidgetConfig[] = [
  { key: "status-oportunidade", pipelineId: "all" },
  { key: "valor-oportunidade", pipelineId: "all" },
  { key: "taxa-conversao", pipelineId: "all" },
  { key: "funil", pipelineId: "" },
  { key: "distribuicao-fases", pipelineId: "" },
  { key: "fonte-leads" },
  { key: "acoes-manuais" },
  { key: "google-analytics" },
];
