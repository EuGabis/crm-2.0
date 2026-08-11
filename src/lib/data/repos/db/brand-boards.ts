"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { createClient } from "@/lib/supabase/client";
import { useDbStore } from "./contacts";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface BrandBoard {
  id: string;
  name: string;
  palette: string[];
  font: string;
}

const mapBoard = (r: any): BrandBoard => ({
  id: r.id,
  name: r.name,
  palette: r.palette ?? [],
  font: r.font ?? "Inter",
});

interface BoardState {
  loaded: boolean;
  loading: boolean;
  boards: BrandBoard[];
  load: () => Promise<void>;
  patch: (b: BrandBoard[]) => void;
}

export const useBrandBoardStore = create<BoardState>((set, get) => ({
  loaded: false,
  loading: false,
  boards: [],
  load: async () => {
    if (get().loaded || get().loading) return;
    set({ loading: true });
    await useDbStore.getState().load();
    const supabase = createClient();
    const { data } = await supabase
      .from("brand_boards")
      .select("*")
      .order("created_at", { ascending: false });
    set({ loaded: true, loading: false, boards: (data ?? []).map(mapBoard) });
  },
  patch: (boards) => set({ boards }),
}));

export function useBrandBoards() {
  const { boards, loading, loaded, load } = useBrandBoardStore();
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { boards, loading: loading || !loaded };
}

export const brandBoardActions = {
  async add(input: { name: string; palette: string[]; font: string }): Promise<boolean> {
    const locationId = useDbStore.getState().locationId;
    if (!locationId) return false;
    const supabase = createClient();
    const { data, error } = await supabase
      .from("brand_boards")
      .insert({ location_id: locationId, name: input.name, palette: input.palette, font: input.font })
      .select()
      .single();
    if (error || !data) return false;
    const s = useBrandBoardStore.getState();
    s.patch([mapBoard(data), ...s.boards]);
    return true;
  },

  async remove(id: string): Promise<boolean> {
    const supabase = createClient();
    const { error } = await supabase.from("brand_boards").delete().eq("id", id);
    if (error) return false;
    const s = useBrandBoardStore.getState();
    s.patch(s.boards.filter((b) => b.id !== id));
    return true;
  },
};
