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
  contactEmail: string;
  assignedTo: string | null;
  channel: string;
  channelId: string | null;
  inbound: boolean;
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
  contactEmail: r.contact_email ?? "",
  assignedTo: r.assigned_to ?? null,
  channel: r.channel ?? "whatsapp",
  channelId: r.channel_id ?? null,
  inbound: r.inbound ?? false,
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

export interface MyDepartmentFlags {
  loaded: boolean;
  colaborativo: boolean;
  /** Distribui leads por rodízio (0081). */
  usaRodizio: boolean;
  /** Aplica o logout automático por inatividade de 10 min (0081). */
  logoutInatividade: boolean;
}

/**
 * Flags do departamento do usuário atual. Departamentos são legíveis por qualquer
 * membro (RLS da 0033), então funciona para não-admins. Sem departamento → padrões.
 */
export function useMyDepartment(): MyDepartmentFlags {
  const { me } = useMyMembership();
  const [flags, setFlags] = useState<MyDepartmentFlags>({
    loaded: false,
    colaborativo: false,
    usaRodizio: true,
    logoutInatividade: true,
  });
  useEffect(() => {
    if (!me?.departmentId) {
      setFlags({ loaded: true, colaborativo: false, usaRodizio: true, logoutInatividade: true });
      return;
    }
    const supabase = createClient();
    void supabase
      .from("departments")
      .select("colaborativo, usa_rodizio, logout_inatividade")
      .eq("id", me.departmentId)
      .maybeSingle()
      .then(({ data }) =>
        setFlags({
          loaded: true,
          colaborativo: !!data?.colaborativo,
          usaRodizio: data?.usa_rodizio ?? true,
          logoutInatividade: data?.logout_inatividade ?? true,
        })
      );
  }, [me?.departmentId]);
  return flags;
}

/** O usuário pode usar o relatório do setor? admin OU membro de setor colaborativo. */
export function useIsSupervisor(): boolean {
  const { isAdmin } = useMyMembership();
  const { colaborativo } = useMyDepartment();
  return isAdmin || colaborativo;
}
