"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { createClient } from "@/lib/supabase/client";
import { useDbStore } from "./contacts";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface GoogleAdsConnection {
  customerId: string;
  connectedEmail: string;
  currencyCode: string;
  connectedAt: string;
  active: boolean;
}

export interface OverviewData {
  currency: string;
  kpis: { clicks: number; conversions: number; cost: number; costPerConv: number };
  series: { date: string; clicks: number; conversions: number; cost: number }[];
  campaigns: {
    name: string;
    status: string;
    clicks: number;
    conversions: number;
    cost: number;
    costPerConv: number;
  }[];
}

interface ConnState {
  loaded: boolean;
  loading: boolean;
  connection: GoogleAdsConnection | null;
  load: () => Promise<void>;
  set: (connection: GoogleAdsConnection | null) => void;
}

const useConnStore = create<ConnState>((setState, get) => ({
  loaded: false,
  loading: false,
  connection: null,
  set: (connection) => setState({ connection }),
  load: async () => {
    if (get().loaded || get().loading) return;
    setState({ loading: true });
    await useDbStore.getState().load();
    const locationId = useDbStore.getState().locationId;
    if (!locationId) {
      setState({ loading: false, loaded: true });
      return;
    }
    const supabase = createClient();
    const { data } = await supabase
      .from("google_ads_connections")
      .select("customer_id, connected_email, currency_code, connected_at, active")
      .eq("location_id", locationId)
      .maybeSingle();
    setState({
      loaded: true,
      loading: false,
      connection: data
        ? {
            customerId: (data as any).customer_id,
            connectedEmail: (data as any).connected_email ?? "",
            currencyCode: (data as any).currency_code ?? "BRL",
            connectedAt: (data as any).connected_at,
            active: (data as any).active,
          }
        : null,
    });
  },
}));

export function useGoogleAdsConnection() {
  const { connection, loaded, loading, load } = useConnStore();
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { connection, ready: loaded && !loading };
}

export const googleAdsActions = {
  startConnectPath(): string {
    return "/api/google-ads/oauth/start";
  },

  async overview(
    from: string,
    to: string,
  ): Promise<{ connected: boolean; data?: OverviewData; error?: string }> {
    const res = await fetch(
      `/api/google-ads/overview?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    );
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { connected: false, error: json?.error ?? "Falha ao carregar" };
    if (!json.connected) return { connected: false };
    return { connected: true, data: json as OverviewData };
  },

  async disconnect(): Promise<boolean> {
    const locationId = useDbStore.getState().locationId;
    if (!locationId) return false;
    const supabase = createClient();
    const { error } = await supabase
      .from("google_ads_connections")
      .delete()
      .eq("location_id", locationId);
    if (error) return false;
    useConnStore.getState().set(null);
    return true;
  },
};
