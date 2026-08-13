"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { createClient } from "@/lib/supabase/client";
import { useDbStore } from "./contacts";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface AiAgent {
  id: string;
  name: string;
  personality: string;
  goal: string;
  extraInfo: string;
  model: string;
  status: "ativo" | "sugestivo" | "desativado";
  isPrimary: boolean;
  channels: string[];
  actions: Record<string, boolean>;
}

function mapAgent(r: any): AiAgent {
  return {
    id: r.id,
    name: r.name,
    personality: r.personality ?? "",
    goal: r.goal ?? "",
    extraInfo: r.extra_info ?? "",
    model: r.model ?? "gpt-4o-mini",
    status: r.status ?? "sugestivo",
    isPrimary: !!r.is_primary,
    channels: r.channels ?? [],
    actions: r.actions ?? {},
  };
}

interface AgentsState {
  loaded: boolean;
  loading: boolean;
  agents: AiAgent[];
  load: () => Promise<void>;
  set: (agents: AiAgent[]) => void;
}

const useAgentsStore = create<AgentsState>((setState, get) => ({
  loaded: false,
  loading: false,
  agents: [],
  set: (agents) => setState({ agents }),
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
      .from("ai_agents")
      .select("*")
      .eq("location_id", locationId)
      .order("created_at", { ascending: true });
    setState({ loaded: true, loading: false, agents: (data ?? []).map(mapAgent) });
  },
}));

export function useAiAgents() {
  const { agents, loaded, loading, load } = useAgentsStore();
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { agents, ready: loaded && !loading };
}

export const aiAgentActions = {
  async create(input: { name: string }): Promise<{ ok: boolean; id?: string; error?: string }> {
    const locationId = useDbStore.getState().locationId;
    if (!locationId) return { ok: false, error: "Empresa não encontrada" };
    const supabase = createClient();
    const { count } = await supabase
      .from("ai_agents")
      .select("id", { count: "exact", head: true })
      .eq("location_id", locationId);
    const first = (count ?? 0) === 0;
    const { data, error } = await supabase
      .from("ai_agents")
      .insert({ location_id: locationId, name: input.name.trim(), is_primary: first })
      .select()
      .single();
    if (error || !data) return { ok: false, error: error?.message ?? "Não foi possível criar" };
    const s = useAgentsStore.getState();
    s.set([...s.agents, mapAgent(data)]);
    return { ok: true, id: data.id };
  },

  async update(
    id: string,
    patch: Partial<Pick<AiAgent, "name" | "personality" | "goal" | "extraInfo" | "model" | "status" | "channels" | "actions">>,
  ): Promise<boolean> {
    const supabase = createClient();
    const row: any = {};
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.personality !== undefined) row.personality = patch.personality;
    if (patch.goal !== undefined) row.goal = patch.goal;
    if (patch.extraInfo !== undefined) row.extra_info = patch.extraInfo;
    if (patch.model !== undefined) row.model = patch.model;
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.channels !== undefined) row.channels = patch.channels;
    if (patch.actions !== undefined) row.actions = patch.actions;
    const { data, error } = await supabase.from("ai_agents").update(row).eq("id", id).select().single();
    if (error || !data) return false;
    const s = useAgentsStore.getState();
    s.set(s.agents.map((a) => (a.id === id ? mapAgent(data) : a)));
    return true;
  },

  async setPrimary(id: string): Promise<boolean> {
    const locationId = useDbStore.getState().locationId;
    if (!locationId) return false;
    const supabase = createClient();
    const { error: setError } = await supabase.from("ai_agents").update({ is_primary: true }).eq("id", id);
    if (setError) return false;
    const { error: clearError } = await supabase
      .from("ai_agents")
      .update({ is_primary: false })
      .eq("location_id", locationId)
      .neq("id", id);
    if (clearError) return false;
    const s = useAgentsStore.getState();
    s.set(s.agents.map((a) => ({ ...a, isPrimary: a.id === id })));
    return true;
  },

  async remove(id: string): Promise<boolean> {
    const supabase = createClient();
    const { error } = await supabase.from("ai_agents").delete().eq("id", id);
    if (error) return false;
    const s = useAgentsStore.getState();
    s.set(s.agents.filter((a) => a.id !== id));
    return true;
  },

  async chat(
    agentId: string,
    messages: { role: "user" | "assistant"; content: string }[],
  ): Promise<{ ok: boolean; text?: string; error?: string }> {
    const res = await fetch("/api/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, messages }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: json?.error ?? "Falha ao conversar" };
    return { ok: true, text: json.text };
  },
};
