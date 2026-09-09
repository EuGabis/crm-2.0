"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { createClient } from "@/lib/supabase/client";
import { useDbStore } from "./contacts";

/**
 * O desfecho da triagem do bot, por conversa (tabela `bot_desfechos`,
 * migração 202609031955).
 *
 * Serve à caixa de entrada: o lead que não bateu a pontuação do bot é FRIO —
 * cai para o vendedor, mas não é prioridade, e isso precisa estar visível na
 * lista em vez de exigir abrir a conversa.
 */
export type Desfecho = {
  conversationId: string;
  /** 'quente'/'frio' no fluxo comercial; o ASSUNTO no da secretaria. */
  resultado: string;
  pontos: number | null;
  limiar: number | null;
  createdAt: string;
};

export type Temperatura = "frio" | "quente" | null;

/**
 * A temperatura do lead, ou `null` quando o fluxo não pontua.
 *
 * 🔴 **Decide pela ARITMÉTICA, não pelo texto de `resultado`.** A tentação era
 * `resultado === "frio"`, e ela quebra por dois motivos:
 *
 *  1. os valores saem de `hotValue`/`coldValue` do nó `score`, que são
 *     **configuráveis no editor de bot** — renomear "frio" para "morno" apagaria
 *     o selo da tela sem ninguém relacionar as duas coisas;
 *  2. o fluxo da SECRETARIA grava o ASSUNTO em `resultado` ("docs", "outros"),
 *     e comparar texto ali classificaria assunto como temperatura.
 *
 * `pontos` e `limiar` são o par que só existe quando houve nota: a secretaria
 * grava os dois NULL de propósito — "NULL diz não pontuou; um zero diria
 * pontuou zero, que é outra coisa" (202609031955).
 *
 * Exportada para ter teste: a regra é curta, e errar aqui pinta de frio um lead
 * quente sem gerar erro nenhum.
 */
export function temperaturaDe(d: Pick<Desfecho, "pontos" | "limiar"> | undefined): Temperatura {
  if (!d) return null;
  const { pontos, limiar } = d;
  if (pontos == null || limiar == null) return null;
  if (!Number.isFinite(Number(pontos)) || !Number.isFinite(Number(limiar))) return null;
  return Number(pontos) < Number(limiar) ? "frio" : "quente";
}

type State = {
  porConversa: Map<string, Desfecho>;
  loaded: boolean;
  loading: boolean;
  load: () => Promise<void>;
};

export const useDesfechoStore = create<State>((set, get) => ({
  porConversa: new Map(),
  loaded: false,
  loading: false,
  load: async () => {
    if (get().loaded || get().loading) return;
    set({ loading: true });
    await useDbStore.getState().ensureSession();
    const locationId = useDbStore.getState().locationId;
    if (!locationId) return set({ loading: false });
    const supabase = createClient();
    const { data, error } = await supabase
      .from("bot_desfechos")
      .select("conversation_id, resultado, pontos, limiar, created_at")
      .eq("location_id", locationId)
      .not("conversation_id", "is", null)
      /*
       * Mais NOVO primeiro: a tabela é append-only e uma conversa REABERTA passa
       * pela triagem de novo, ganhando outra linha. O primeiro que entra no mapa
       * vence, então o mapa fica com o desfecho vigente — nunca com o de um
       * atendimento encerrado semanas atrás.
       */
      .order("created_at", { ascending: false });
    // Erro não vira mapa vazio marcado como carregado: antes da migração estar
    // aplicada a tabela pode não existir, e cachear vazio esconderia o selo até
    // um F5. Mesma razão do catálogo de etiquetas.
    if (error || !data) return set({ loading: false });
    const mapa = new Map<string, Desfecho>();
    for (const r of data as Record<string, unknown>[]) {
      const id = r.conversation_id as string;
      if (mapa.has(id)) continue;
      mapa.set(id, {
        conversationId: id,
        resultado: (r.resultado as string) ?? "",
        pontos: r.pontos == null ? null : Number(r.pontos),
        limiar: r.limiar == null ? null : Number(r.limiar),
        createdAt: r.created_at as string,
      });
    }
    set({ porConversa: mapa, loaded: true, loading: false });
  },
}));

/** Mapa `conversationId → desfecho vigente`. Carrega uma vez por sessão. */
export function useDesfechos() {
  const { porConversa, load } = useDesfechoStore();
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return porConversa;
}
