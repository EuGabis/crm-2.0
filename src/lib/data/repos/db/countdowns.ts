"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { createClient } from "@/lib/supabase/client";
import { useDbStore } from "./contacts";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface Countdown {
  id: string;
  name: string;
  endsAt: string; // ISO
}

const mapCountdown = (r: any): Countdown => ({
  id: r.id,
  name: r.name,
  endsAt: r.ends_at,
});

interface CountdownState {
  loaded: boolean;
  loading: boolean;
  countdowns: Countdown[];
  load: () => Promise<void>;
  patch: (c: Countdown[]) => void;
}

export const useCountdownStore = create<CountdownState>((set, get) => ({
  loaded: false,
  loading: false,
  countdowns: [],
  load: async () => {
    if (get().loaded || get().loading) return;
    set({ loading: true });
    await useDbStore.getState().load();
    const supabase = createClient();
    const { data } = await supabase
      .from("countdowns")
      .select("*")
      .order("created_at", { ascending: false });
    set({ loaded: true, loading: false, countdowns: (data ?? []).map(mapCountdown) });
  },
  patch: (countdowns) => set({ countdowns }),
}));

export function useCountdowns() {
  const { countdowns, loading, loaded, load } = useCountdownStore();
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { countdowns, loading: loading || !loaded };
}

export const countdownActions = {
  async add(input: { name: string; endsAt: string }): Promise<boolean> {
    const locationId = useDbStore.getState().locationId;
    if (!locationId) return false;
    const supabase = createClient();
    const { data, error } = await supabase
      .from("countdowns")
      .insert({ location_id: locationId, name: input.name, ends_at: input.endsAt })
      .select()
      .single();
    if (error || !data) return false;
    const s = useCountdownStore.getState();
    s.patch([mapCountdown(data), ...s.countdowns]);
    return true;
  },

  async remove(id: string): Promise<boolean> {
    const supabase = createClient();
    const { error } = await supabase.from("countdowns").delete().eq("id", id);
    if (error) return false;
    const s = useCountdownStore.getState();
    s.patch(s.countdowns.filter((c) => c.id !== id));
    return true;
  },
};
