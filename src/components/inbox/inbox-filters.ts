"use client";

import { create } from "zustand";
import type {
  ConversationFilter,
  InboxScope,
  InboxStatusView,
  InboxViewConfig,
} from "@/lib/data/types";

/**
 * Estado de filtro da caixa de entrada, fora dos componentes porque três lugares
 * mexem nele: o rail (escopo e visualizações salvas), a lista (abas, busca,
 * ordenação) e a própria visualização, que restaura os quatro de uma vez.
 */

export const SORT_OPTIONS = [
  "Mais recentes · Todas as mensagens",
  "Mais antigas · Todas as mensagens",
  "Mais recentes · Mensagens manuais",
  "Mais antigas · Mensagens manuais",
  "Maior atraso de SLA",
  "Próxima meta de SLA",
];

const DEFAULTS: InboxViewConfig = {
  scope: "group",
  filter: "all",
  sort: SORT_OPTIONS[0],
  query: "",
  status: "abertas",
};

interface InboxUiState extends InboxViewConfig {
  /** Visualização salva aplicada agora (some assim que algo é ajustado à mão). */
  activeViewId: string | null;
  setScope: (scope: InboxScope) => void;
  setFilter: (filter: ConversationFilter) => void;
  setSort: (sort: string) => void;
  setQuery: (query: string) => void;
  setStatus: (status: InboxStatusView) => void;
  applyView: (id: string, config: InboxViewConfig) => void;
  reset: () => void;
}

export const useInboxUi = create<InboxUiState>((set) => ({
  ...DEFAULTS,
  activeViewId: null,
  setScope: (scope) => set({ scope, activeViewId: null }),
  setFilter: (filter) => set({ filter, activeViewId: null }),
  setSort: (sort) => set({ sort, activeViewId: null }),
  setQuery: (query) => set({ query, activeViewId: null }),
  setStatus: (status) => set({ status, activeViewId: null }),
  applyView: (activeViewId, config) => set({ ...DEFAULTS, ...config, activeViewId }),
  reset: () => set({ ...DEFAULTS, activeViewId: null }),
}));

/** Snapshot do estado atual, para salvar como visualização. */
export function currentViewConfig(): InboxViewConfig {
  const { scope, filter, sort, query, status } = useInboxUi.getState();
  return { scope, filter, sort, query, status };
}

export const scopeLabel: Record<InboxScope, string> = {
  group: "Caixa de entrada do grupo",
  mine: "Atribuídas a mim",
  bot: "Conversas com automação",
  offline: "Recebidas enquanto offline",
};

export const statusLabel: Record<InboxStatusView, string> = {
  abertas: "Abertas",
  finalizadas: "Finalizadas",
  arquivadas: "Arquivadas",
  todas: "Todas",
};
