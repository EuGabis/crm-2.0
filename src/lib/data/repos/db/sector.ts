"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useMyMembership } from "@/lib/data/repos/db/team";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Conversas do setor (migração 0080) — visão de supervisão: admin ou membro de um
 * departamento colaborativo vê TODAS as conversas do setor no relatório e pode
 * assumir a de outro atendente. A caixa de Conversas continua privada.
 */
export interface SectorConversation {
  id: string;
  contactId: string | null;
  contactFirst: string;
  contactLast: string;
  contactPhone: string;
  assignedTo: string | null;
  channelId: string | null;
  closedAt: string | null;
  archivedAt: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string;
  createdAt: string;
}

const mapRow = (r: any): SectorConversation => ({
  id: r.id,
  contactId: r.contact_id ?? null,
  contactFirst: r.contact_first ?? "",
  contactLast: r.contact_last ?? "",
  contactPhone: r.contact_phone ?? "",
  assignedTo: r.assigned_to ?? null,
  channelId: r.channel_id ?? null,
  closedAt: r.closed_at ?? null,
  archivedAt: r.archived_at ?? null,
  lastMessageAt: r.last_message_at ?? null,
  lastMessagePreview: r.last_message_preview ?? "",
  createdAt: r.created_at,
});

export function useSectorConversations() {
  const [rows, setRows] = useState<SectorConversation[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("sector_conversations");
    setRows(error || !data ? [] : (data as any[]).map(mapRow));
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { rows, loading, reload: load };
}

export const sectorActions = {
  /** Assume a conversa (reatribui ao usuário atual, pausa o bot). */
  async takeOver(conversationId: string): Promise<boolean> {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("take_over_conversation", {
      conv_id: conversationId,
    });
    return !error && data === true;
  },
};

/** O usuário pode usar o relatório do setor? admin OU membro de setor colaborativo. */
export function useIsSupervisor(): boolean {
  const { me, isAdmin } = useMyMembership();
  const [colab, setColab] = useState(false);
  useEffect(() => {
    if (!me?.departmentId) {
      setColab(false);
      return;
    }
    const supabase = createClient();
    void supabase
      .from("departments")
      .select("colaborativo")
      .eq("id", me.departmentId)
      .maybeSingle()
      .then(({ data }) => setColab(!!data?.colaborativo));
  }, [me?.departmentId]);
  return isAdmin || colab;
}
