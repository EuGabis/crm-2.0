"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { createClient } from "@/lib/supabase/client";
import { useDbStore } from "./contacts";
import type { AutoResposta, TipoJanela } from "@/lib/bot/auto-resposta";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Respostas automáticas com janela (migração 202608281945).
 *
 * O tipo `AutoResposta` vem de `lib/bot/auto-resposta.ts` — o MESMO que o webhook
 * usa para decidir se a janela está aberta. Um tipo só para as duas pontas é o
 * que garante que a tela não prometa um campo que o motor ignora.
 */

interface State {
  itens: AutoResposta[];
  loading: boolean;
  loaded: boolean;
  load: () => Promise<void>;
  reload: () => Promise<void>;
  patch: (p: Partial<State>) => void;
}

function mapear(r: any): AutoResposta {
  return {
    id: r.id,
    nome: r.nome,
    mensagem: r.mensagem,
    ativo: r.ativo,
    tipo: r.tipo,
    channelId: r.channel_id,
    diasSemana: r.dias_semana,
    horaInicio: r.hora_inicio,
    horaFim: r.hora_fim,
    inicioEm: r.inicio_em,
    fimEm: r.fim_em,
  };
}

async function buscar(): Promise<AutoResposta[]> {
  // ⚠️ `ensureSession()` e não `load()`: só se precisa da empresa. `load()`
  // baixaria os 41 mil contatos para descobrir o `location_id` — a armadilha
  // documentada na seção de Contatos.
  await useDbStore.getState().ensureSession();
  const location = useDbStore.getState().locationId;
  if (!location) return [];
  const supabase = createClient();
  const { data } = await supabase
    .from("auto_respostas")
    .select("*")
    .eq("location_id", location)
    .order("created_at", { ascending: false });
  return (data ?? []).map(mapear);
}

const useStore = create<State>((set, get) => ({
  itens: [],
  loading: false,
  loaded: false,
  load: async () => {
    if (get().loaded || get().loading) return;
    set({ loading: true });
    set({ itens: await buscar(), loading: false, loaded: true });
  },
  reload: async () => {
    if (!get().loaded) return;
    set({ itens: await buscar() });
  },
  patch: (p) => set(p),
}));

export function useAutoRespostas() {
  const store = useStore();
  useEffect(() => {
    void store.load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return store;
}

export interface EntradaAutoResposta {
  nome: string;
  mensagem: string;
  tipo: TipoJanela;
  channelId: string | null;
  diasSemana: number[] | null;
  horaInicio: string | null;
  horaFim: string | null;
  inicioEm: string | null;
  fimEm: string | null;
  ativo: boolean;
}

function paraBanco(e: EntradaAutoResposta, location: string) {
  return {
    location_id: location,
    nome: e.nome.trim(),
    mensagem: e.mensagem.trim(),
    tipo: e.tipo,
    channel_id: e.channelId,
    ativo: e.ativo,
    // ⚠️ Os campos do OUTRO tipo vão explicitamente a null. Sem isso, editar uma
    // regra de "recorrente" para "período" deixaria hora_inicio/hora_fim para
    // trás, e a restrição do banco (`auto_respostas_campos_do_tipo`) passaria
    // enquanto a linha carregaria dados de dois modos ao mesmo tempo.
    dias_semana: e.tipo === "recorrente" ? e.diasSemana : null,
    hora_inicio: e.tipo === "recorrente" ? e.horaInicio : null,
    hora_fim: e.tipo === "recorrente" ? e.horaFim : null,
    inicio_em: e.tipo === "periodo" ? e.inicioEm : null,
    fim_em: e.tipo === "periodo" ? e.fimEm : null,
  };
}

export const autoRespostaActions = {
  async criar(e: EntradaAutoResposta): Promise<{ ok: boolean; error?: string }> {
    await useDbStore.getState().ensureSession();
    const location = useDbStore.getState().locationId;
    if (!location) return { ok: false, error: "Empresa não encontrada" };
    const supabase = createClient();
    const { error } = await supabase.from("auto_respostas").insert(paraBanco(e, location));
    if (error) return { ok: false, error: error.message };
    await useStore.getState().reload();
    return { ok: true };
  },

  async atualizar(id: string, e: EntradaAutoResposta): Promise<{ ok: boolean; error?: string }> {
    await useDbStore.getState().ensureSession();
    const location = useDbStore.getState().locationId;
    if (!location) return { ok: false, error: "Empresa não encontrada" };
    const supabase = createClient();
    const { data, error } = await supabase
      .from("auto_respostas")
      .update({ ...paraBanco(e, location), updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("id");
    if (error) return { ok: false, error: error.message };
    // ⚠️ Confere as LINHAS, não só o `error`: UPDATE recusado pela RLS (aqui, por
    // não ser admin) volta SEM erro e a tela diria "salvo" sem ter salvado. É a
    // armadilha nº 1 deste projeto.
    if (!data?.length) return { ok: false, error: "Sem permissão — só administradores editam" };
    await useStore.getState().reload();
    return { ok: true };
  },

  async remover(id: string): Promise<{ ok: boolean; error?: string }> {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("auto_respostas")
      .delete()
      .eq("id", id)
      .select("id");
    if (error) return { ok: false, error: error.message };
    if (!data?.length) return { ok: false, error: "Sem permissão — só administradores excluem" };
    await useStore.getState().reload();
    return { ok: true };
  },

  async alternarAtivo(id: string, ativo: boolean): Promise<boolean> {
    const supabase = createClient();
    const { data } = await supabase
      .from("auto_respostas")
      .update({ ativo, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("id");
    if (!data?.length) return false;
    await useStore.getState().reload();
    return true;
  },
};
