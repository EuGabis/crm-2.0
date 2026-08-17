"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useDbStore } from "./contacts";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Estado das conexões de mídia (Google Drive / Canva).
 *
 * Lê a VIEW `media_integration_status` (0045), não a tabela: a tabela guarda
 * token e é admin-only, então ler dela faria a tela dizer "não conectado" para
 * todo usuário não-admin — foi exatamente o bug que a Guru teve duas vezes.
 */

export type MediaProvider = "google_drive" | "canva";

export interface MediaConnection {
  provider: MediaProvider;
  accountLabel: string | null;
  connectedAt: string;
}

export function useMediaConnections() {
  const [connections, setConnections] = useState<MediaConnection[]>([]);
  const [loaded, setLoaded] = useState(false);
  const locationId = useDbStore((s) => s.locationId);

  const load = useCallback(async () => {
    await useDbStore.getState().load();
    const loc = useDbStore.getState().locationId;
    if (!loc) return;
    const supabase = createClient();
    const { data, error } = await supabase
      .from("media_integration_status")
      .select("*")
      .eq("location_id", loc);
    if (error) {
      // Migração ainda não aplicada, por exemplo. Não trava a tela: o módulo
      // funciona sem as integrações.
      console.warn("[midia] media_integration_status indisponível:", error.message);
      setLoaded(true);
      return;
    }
    setConnections(
      (data ?? []).map((r: any) => ({
        provider: r.provider,
        accountLabel: r.account_label ?? null,
        connectedAt: r.connected_at,
      }))
    );
    setLoaded(true);
  }, []);

  useEffect(() => {
    void load();
  }, [load, locationId]);

  return { connections, loaded, reload: load };
}

export interface MediaSetup {
  redirectUri: string;
  appUrl: string | null;
  google_drive: { configured: boolean; clientId: string | null };
  canva: { configured: boolean; clientId: string | null };
}

export const mediaConnectionActions = {
  /** Estado da configuração do servidor (só admin). Null se não puder ver. */
  async setup(): Promise<MediaSetup | null> {
    const res = await fetch("/api/media/setup");
    if (!res.ok) return null;
    return (await res.json()) as MediaSetup;
  },

  startPath(provider: MediaProvider) {
    return `/api/media/oauth/start?provider=${provider}`;
  },

  async disconnect(provider: MediaProvider): Promise<{ ok: boolean; error?: string }> {
    const res = await fetch("/api/media/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider }),
    });
    const json = await res.json().catch(() => ({}));
    return res.ok ? { ok: true } : { ok: false, error: json?.error };
  },

  async list(provider: MediaProvider, query = "") {
    const res = await fetch(
      `/api/media/files?provider=${provider}&q=${encodeURIComponent(query)}`
    );
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { items: [], error: json?.error as string | undefined };
    return { items: (json.items ?? []) as ExternalItem[], error: undefined };
  },
};

export interface ExternalItem {
  id: string;
  name: string;
  mime: string | null;
  thumbnail: string | null;
  url: string | null;
  updatedAt: string | null;
}
