"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { createClient } from "@/lib/supabase/client";
import { useDbStore } from "./contacts";

/**
 * Catálogo de ETIQUETAS (migração 202609091600).
 *
 * ⚠️ **O catálogo é só a lista de nomes VÁLIDOS.** O valor continua gravado em
 * `contacts.tags` (text[]), como sempre foi — é isso que mantém funcionando as
 * listas inteligentes, as campanhas, os formulários (`forms.tag`), a
 * importação/exportação CSV e as ações em massa, que todos leem aquele array.
 * Marcar uma etiqueta num contato NÃO escreve aqui.
 *
 * Criar/renomear/excluir é de ADMIN, pela RLS — não por botão escondido. Marcar
 * continua sendo de todo mundo.
 */
export type ContactTag = {
  id: string;
  name: string;
  position: number;
};

type TagState = {
  tags: ContactTag[];
  loaded: boolean;
  loading: boolean;
  load: () => Promise<void>;
  reload: () => Promise<void>;
  set: (tags: ContactTag[]) => void;
};

const ordenar = (l: ContactTag[]) =>
  [...l].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, "pt-BR"));

async function buscar(): Promise<ContactTag[] | null> {
  await useDbStore.getState().ensureSession();
  const locationId = useDbStore.getState().locationId;
  if (!locationId) return null;
  const supabase = createClient();
  const { data, error } = await supabase
    .from("contact_tags")
    .select("id, name, position")
    .eq("location_id", locationId);
  /*
   * ⚠️ Erro NÃO vira lista vazia marcada como carregada. Antes da migração ser
   * aplicada a tabela não existe, e cachear `[]` como "carregado" esconderia o
   * catálogo até um F5 — o mesmo defeito que a aba Canais já teve.
   */
  if (error || !data) return null;
  return ordenar(data as ContactTag[]);
}

export const useTagStore = create<TagState>((set, get) => ({
  tags: [],
  loaded: false,
  loading: false,
  set: (tags) => set({ tags: ordenar(tags) }),
  load: async () => {
    if (get().loaded || get().loading) return;
    set({ loading: true });
    const tags = await buscar();
    set(tags ? { tags, loaded: true, loading: false } : { loading: false });
  },
  /** Recarrega sem passar por "Carregando..." — usado depois de criar/editar. */
  reload: async () => {
    const tags = await buscar();
    if (tags) set({ tags, loaded: true });
  },
}));

/** A lista de etiquetas da empresa, já ordenada. */
export function useContactTags() {
  const { tags, loaded, loading, load } = useTagStore();
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { tags, loaded, loading };
}

export const tagActions = {
  /**
   * Cria uma etiqueta. Só admin (a RLS recusa os demais).
   *
   * ⚠️ Devolve o MOTIVO da falha, não um booleano: "já existe" e "sem permissão"
   * pedem condutas opostas, e este repositório já pagou por tratar os dois como
   * o mesmo `false` (o "tente novamente" do contato duplicado).
   */
  async create(name: string): Promise<{ ok: boolean; erro?: string }> {
    const nome = name.trim();
    if (!nome) return { ok: false, erro: "Escreva o nome da etiqueta." };
    await useDbStore.getState().ensureSession();
    const locationId = useDbStore.getState().locationId;
    if (!locationId) return { ok: false, erro: "Empresa não encontrada." };
    // O índice é por `lower(name)`; conferir aqui dá a mensagem certa em vez do
    // código cru do Postgres.
    if (useTagStore.getState().tags.some((t) => t.name.toLowerCase() === nome.toLowerCase())) {
      return { ok: false, erro: `A etiqueta "${nome}" já existe.` };
    }
    const supabase = createClient();
    const { error } = await supabase
      .from("contact_tags")
      .insert({ location_id: locationId, name: nome, position: 900 });
    if (error) {
      return {
        ok: false,
        erro: error.code === "42501" ? "Só administradores criam etiquetas." : error.message,
      };
    }
    await useTagStore.getState().reload();
    return { ok: true };
  },

  async rename(id: string, name: string): Promise<{ ok: boolean; erro?: string }> {
    const nome = name.trim();
    if (!nome) return { ok: false, erro: "Escreva o nome da etiqueta." };
    const supabase = createClient();
    /*
     * ⚠️ Confere as LINHAS devolvidas, não o `error`: UPDATE recusado pela RLS
     * volta CALADO (0 linhas, sem erro), e a tela diria "renomeada" com o nome
     * antigo no banco. Armadilha já documentada em `removeMessage`.
     */
    const { data, error } = await supabase
      .from("contact_tags")
      .update({ name: nome })
      .eq("id", id)
      .select("id");
    if (error) return { ok: false, erro: error.message };
    if (!data?.length) return { ok: false, erro: "Só administradores editam etiquetas." };
    await useTagStore.getState().reload();
    return { ok: true };
  },

  /**
   * Tira a etiqueta do CATÁLOGO.
   *
   * ⚠️ **Não mexe nos contatos.** Quem já está marcado continua marcado e as
   * listas inteligentes seguem funcionando — some só a opção de marcar de novo.
   * Apagar de todos os contatos junto seria irreversível e não é o que "excluir
   * da lista" promete.
   */
  async remove(id: string): Promise<{ ok: boolean; erro?: string }> {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("contact_tags")
      .delete()
      .eq("id", id)
      .select("id");
    if (error) return { ok: false, erro: error.message };
    if (!data?.length) return { ok: false, erro: "Só administradores excluem etiquetas." };
    await useTagStore.getState().reload();
    return { ok: true };
  },
};
