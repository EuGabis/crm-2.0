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
}

export function useContactNotes(contactId: string | null | undefined, enabled = true) {
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!contactId) {
      setNotes([]);
      return;
    }
    setLoading(true);
    await useDbStore.getState().load();
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
      .select("id, conversation_id, body, created_at")
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
      })),
    );
    setLoading(false);
  }, [contactId]);

  useEffect(() => {
    if (!enabled) return;
    void reload();
  }, [enabled, reload]);

  return { notes, loading, reload };
}
