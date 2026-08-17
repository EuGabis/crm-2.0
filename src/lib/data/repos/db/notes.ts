"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useDbStore } from "./contacts";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Comentários (notas internas) de um contato.
 *
 * O CRM nunca teve tabela de nota: o lugar onde a nota já é guardada é a
 * conversa, como mensagem com `internal = true` — é o que a ação `nota-interna`
 * das automações e o botão "Nota" do card do funil gravam. Criar uma segunda
 * casa para a mesma coisa faria a nota escrita num lugar não aparecer no outro.
 *
 * A consulta aqui é PRÓPRIA e enxuta (as conversas do contato e só as mensagens
 * internas delas) em vez de reusar o store de Conversas, que carrega todas as
 * mensagens da empresa — caro demais para abrir um card.
 */

export interface ContactNote {
  id: string;
  conversationId: string;
  body: string;
  at: string;
  /** Quem escreveu (0051); nulo nas notas anteriores à migração. */
  authorId: string | null;
}

export function useContactNotes(contactId: string | null | undefined, enabled = true) {
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    // O `load()` vem ANTES de qualquer setState: chamado direto do efeito, um
    // setState no corpo sincrono dispara renderizacao em cascata (regra
    // react-hooks/set-state-in-effect). Depois do primeiro await, o resto roda
    // em continuacao de promise e a regra fica satisfeita.
    await useDbStore.getState().load();
    if (!contactId) {
      setNotes([]);
      return;
    }
    setLoading(true);
    const loc = useDbStore.getState().locationId;
    if (!loc) {
      setNotes([]);
      setLoading(false);
      return;
    }
    const supabase = createClient();
    const { data: convs } = await supabase
      .from("conversations")
      .select("id")
      .eq("location_id", loc)
      .eq("contact_id", contactId);
    const ids = (convs ?? []).map((c: any) => c.id);
    if (ids.length === 0) {
      setNotes([]);
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from("messages")
      .select("id, conversation_id, body, created_at, created_by")
      .in("conversation_id", ids)
      .eq("internal", true)
      .order("created_at", { ascending: false })
      .limit(100);
    setNotes(
      (data ?? []).map((m: any) => ({
        id: m.id,
        conversationId: m.conversation_id,
        body: m.body ?? "",
        at: m.created_at,
        authorId: m.created_by ?? null,
      })),
    );
    setLoading(false);
  }, [contactId]);

  useEffect(() => {
    if (!enabled) return;
    // A regra não enxerga através de `reload`: o setState de lá acontece depois
    // do primeiro await (continuação de promise), não no corpo síncrono do
    // efeito — que é justamente o que ela quer evitar.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [enabled, reload]);

  return { notes, loading, reload };
}
