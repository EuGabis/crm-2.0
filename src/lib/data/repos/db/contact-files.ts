"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useDbStore } from "./contacts";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Arquivos de um contato: as mensagens COM MÍDIA das conversas dele.
 *
 * O CRM não tem tabela de "documento do contato" — arquivo aqui é anexo de
 * conversa (bucket privado `conversation-media`, migração 0019). Inventar uma
 * segunda casa faria o PDF enviado no atendimento não aparecer no painel de
 * arquivos, que é justamente onde a pessoa vai procurar.
 *
 * Consulta própria e enxuta, pelo mesmo motivo de `db/notes.ts`: o store de
 * Conversas carrega todas as mensagens da empresa.
 */

export type FileOrigin = "interno" | "enviado" | "recebido";

export interface ContactFile {
  id: string;
  conversationId: string;
  name: string;
  mime: string | null;
  size: number | null;
  path: string;
  type: string;
  origin: FileOrigin;
  at: string;
}

export function formatFileSize(bytes: number | null): string {
  if (!bytes || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function useContactFiles(contactId: string | null | undefined, enabled = true) {
  const [files, setFiles] = useState<ContactFile[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    // O `load()` vem ANTES de qualquer setState: chamado direto do efeito, um
    // setState no corpo sincrono dispara renderizacao em cascata (regra
    // react-hooks/set-state-in-effect). Depois do primeiro await, o resto roda
    // em continuacao de promise e a regra fica satisfeita.
    await useDbStore.getState().load();
    if (!contactId) {
      setFiles([]);
      return;
    }
    setLoading(true);
    const loc = useDbStore.getState().locationId;
    if (!loc) {
      setFiles([]);
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
      setFiles([]);
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from("messages")
      .select("id, conversation_id, type, body, internal, direction, media_path, media_name, media_mime, media_size, created_at")
      .in("conversation_id", ids)
      .not("media_path", "is", null)
      .order("created_at", { ascending: false })
      .limit(200);
    setFiles(
      (data ?? []).map((m: any) => ({
        id: m.id,
        conversationId: m.conversation_id,
        // Áudio gravado no navegador não tem nome de arquivo útil.
        name: m.media_name || m.body || "Arquivo",
        mime: m.media_mime ?? null,
        size: m.media_size ?? null,
        path: m.media_path,
        type: m.type,
        origin: m.internal ? "interno" : m.direction === "in" ? "recebido" : "enviado",
        at: m.created_at,
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

  return { files, loading, reload };
}
