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

/*
 * A regra de temperatura mora em `lib/leads/temperatura.ts`: este arquivo é
 * "use client" e o motor do FUP (servidor) precisa da MESMA regra — duas cópias
 * divergiriam e o FUP dispararia para um lead que a caixa pinta de frio.
 */
export { temperaturaDe, type Temperatura } from "@/lib/leads/temperatura";

type State = {
  porConversa: Map<string, Desfecho>;
  loaded: boolean;
  loading: boolean;
  load: () => Promise<void>;
  atualizar: () => Promise<void>;
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
    const data = await buscarDesfechos(locationId, null);
    // Erro não vira mapa vazio marcado como carregado: antes da migração estar
    // aplicada a tabela pode não existir, e cachear vazio esconderia o selo até
    // um F5. Mesma razão do catálogo de etiquetas.
    if (!data) return set({ loading: false });
    const mapa = new Map<string, Desfecho>();
    aplicar(mapa, data);
    set({ porConversa: mapa, loaded: true, loading: false });
  },
  atualizar: async () => {
    if (!get().loaded) return;
    const locationId = useDbStore.getState().locationId;
    if (!locationId) return;
    let cursor: string | null = null;
    for (const d of get().porConversa.values()) if (!cursor || d.createdAt > cursor) cursor = d.createdAt;
    const data = await buscarDesfechos(locationId, cursor);
    if (!data?.length) return;
    const mapa = new Map(get().porConversa);
    // Os novos chegam do mais novo para o mais velho e SUBSTITUEM o vigente.
    const vistos = new Set<string>();
    for (const r of data) {
      const id = r.conversation_id as string;
      if (vistos.has(id)) continue;
      vistos.add(id);
      mapa.delete(id);
    }
    aplicar(mapa, data);
    set({ porConversa: mapa });
  },
}));

/*
 * 🔴 Armadilha nº 7: sem `.range()` o PostgREST devolvia só as MIL linhas mais
 * recentes, sem aviso — o lead triado antes disso chegava à caixa sem selo de
 * frio/quente. E o mapa carregava UMA vez por sessão: lead triado com a caixa
 * aberta também ficava sem selo até o F5. Paginado (desempate por id) e com
 * `atualizar()` incremental a cada minuto.
 */
async function buscarDesfechos(locationId: string, desde: string | null) {
  const supabase = createClient();
  const todos: Record<string, unknown>[] = [];
  for (let pagina = 0; pagina < 50; pagina++) {
    let q = supabase
      .from("bot_desfechos")
      .select("conversation_id, resultado, pontos, limiar, created_at")
      .eq("location_id", locationId)
      .not("conversation_id", "is", null);
    if (desde) q = q.gte("created_at", desde);
    const { data, error } = await q
      // Mais NOVO primeiro: a tabela é append-only e a conversa reaberta ganha
      // outra linha; o primeiro que entra no mapa é o desfecho vigente.
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(pagina * 1000, pagina * 1000 + 999);
    if (error || !data) return null;
    todos.push(...(data as Record<string, unknown>[]));
    if (data.length < 1000) break;
  }
  return todos;
}

function aplicar(mapa: Map<string, Desfecho>, data: Record<string, unknown>[]) {
  for (const r of data) {
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
}

/** Mapa `conversationId → desfecho vigente`. Carrega uma vez por sessão. */
export function useDesfechos() {
  const { porConversa, load, atualizar } = useDesfechoStore();
  useEffect(() => {
    void load();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void atualizar();
    }, 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return porConversa;
}
