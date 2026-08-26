"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useDbStore } from "./contacts";
import type { BotFlow } from "@/lib/bot/types";
import { triagemFlow } from "@/lib/bot/flows/triagem";
import { secretariaFlow } from "@/lib/bot/flows/secretaria";
import { financeiroFlow } from "@/lib/bot/flows/financeiro";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Fluxos embutidos usados como padrão até a empresa salvar uma versão editada. */
const DEFAULTS: Record<string, BotFlow> = {
  [triagemFlow.key]: triagemFlow,
  [secretariaFlow.key]: secretariaFlow,
  [financeiroFlow.key]: financeiroFlow,
};

/**
 * Carrega a definição editável de um fluxo (bot_flows) da empresa. Se ainda não
 * houver linha salva, devolve o fluxo embutido em código como ponto de partida —
 * o mesmo que o motor usa. `save` faz upsert e passa a valer no atendimento.
 */
export function useBotFlow(key: string) {
  const locationId = useDbStore((s) => s.locationId);
  const [flow, setFlow] = useState<BotFlow | null>(null);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    setReady(false);
    void (async () => {
      await useDbStore.getState().ensureSession();
      const loc = useDbStore.getState().locationId;
      const fallback = DEFAULTS[key] ?? null;
      if (!loc) {
        if (active) {
          setFlow(fallback ? structuredClone(fallback) : null);
          setReady(true);
        }
        return;
      }
      const supabase = createClient();
      const { data } = await supabase
        .from("bot_flows")
        .select("definition")
        .eq("location_id", loc)
        .eq("key", key)
        .maybeSingle();
      if (!active) return;
      const def = (data?.definition as BotFlow | undefined) ?? fallback;
      setFlow(def ? structuredClone(def) : null);
      setReady(true);
    })();
    return () => {
      active = false;
    };
  }, [locationId, key]);

  const save = useCallback(
    async (definition: BotFlow): Promise<{ ok: boolean; error?: string }> => {
      const loc = useDbStore.getState().locationId;
      if (!loc) return { ok: false, error: "Empresa não encontrada" };
      setSaving(true);
      const supabase = createClient();
      const { error } = await supabase.from("bot_flows").upsert(
        {
          location_id: loc,
          key,
          name: definition.name,
          definition,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "location_id,key" },
      );
      setSaving(false);
      if (error) return { ok: false, error: error.message };
      setFlow(structuredClone(definition));
      return { ok: true };
    },
    [key],
  );

  const reset = useCallback(() => {
    const fallback = DEFAULTS[key];
    if (fallback) setFlow(structuredClone(fallback));
  }, [key]);

  return { flow, ready, saving, save, reset };
}

/* ------------------------------------------------------------------ */
/* Gestão de VÁRIOS bots (multi-fluxo)                                 */
/* ------------------------------------------------------------------ */

export interface BotSummary {
  key: string;
  name: string;
  updatedAt: string | null;
  /** Só existe embutido em código (ainda sem linha salva no banco). */
  isTemplate: boolean;
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "bot"
  );
}

/** Modelo simples para um bot novo: saudação → passa pro atendente. */
function starterFlow(key: string, name: string): BotFlow {
  return {
    key,
    name,
    start: "inicio",
    nodes: {
      inicio: {
        id: "inicio",
        type: "message",
        text: "Olá! Em que posso te ajudar?",
        next: "transferir",
      },
      transferir: { id: "transferir", type: "handoff", to: "humano" },
    },
  };
}

/** Lista os bots da empresa (linhas do banco + os embutidos ainda não salvos). */
export function useBotFlowsList() {
  const locationId = useDbStore((s) => s.locationId);
  const [flows, setFlows] = useState<BotSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    await useDbStore.getState().ensureSession();
    const loc = useDbStore.getState().locationId;
    const list: BotSummary[] = [];
    if (loc) {
      const supabase = createClient();
      const { data } = await supabase
        .from("bot_flows")
        .select("key, name, updated_at")
        .eq("location_id", loc)
        .order("updated_at", { ascending: false });
      for (const r of data ?? []) {
        list.push({ key: r.key, name: r.name, updatedAt: r.updated_at, isTemplate: false });
      }
    }
    // Junta os embutidos que ainda não têm linha salva (ex.: a triagem padrão).
    const savedKeys = new Set(list.map((f) => f.key));
    for (const def of Object.values(DEFAULTS)) {
      if (!savedKeys.has(def.key)) {
        list.push({ key: def.key, name: def.name, updatedAt: null, isTemplate: true });
      }
    }
    setFlows(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId]);

  return { flows, loading, reload };
}

export const botFlowActions = {
  /** Cria um bot novo (linha no banco) e devolve a key. */
  async create(name: string): Promise<{ key: string } | { error: string }> {
    const loc = useDbStore.getState().locationId;
    if (!loc) return { error: "Empresa não encontrada" };
    const trimmed = name.trim();
    if (!trimmed) return { error: "Dê um nome ao bot" };
    const supabase = createClient();
    const base = slugify(trimmed);
    // Tenta a key limpa; se já existe, acrescenta um sufixo curto.
    for (let attempt = 0; attempt < 5; attempt++) {
      const key = attempt === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`;
      const def = starterFlow(key, trimmed);
      const { error } = await supabase.from("bot_flows").insert({
        location_id: loc,
        key,
        name: trimmed,
        definition: def,
      });
      if (!error) return { key };
      if (!String(error.message).includes("duplicate")) return { error: error.message };
    }
    return { error: "Não foi possível gerar uma identificação única" };
  },

  async rename(key: string, name: string): Promise<boolean> {
    const loc = useDbStore.getState().locationId;
    if (!loc) return false;
    const supabase = createClient();
    // Renomeia a linha E o name dentro da definição (o motor usa definition.name).
    const { data } = await supabase
      .from("bot_flows")
      .select("definition")
      .eq("location_id", loc)
      .eq("key", key)
      .maybeSingle();
    const def = (data?.definition as BotFlow | undefined) ?? null;
    const { error } = await supabase
      .from("bot_flows")
      .update({
        name,
        ...(def ? { definition: { ...def, name } } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("location_id", loc)
      .eq("key", key);
    return !error;
  },

  async remove(key: string): Promise<boolean> {
    const loc = useDbStore.getState().locationId;
    if (!loc) return false;
    const supabase = createClient();
    const { error } = await supabase
      .from("bot_flows")
      .delete()
      .eq("location_id", loc)
      .eq("key", key);
    return !error;
  },
};

/** Lista simples (key + nome) para preencher o seletor de bot do canal. */
export function useBotFlowOptions() {
  const { flows, loading } = useBotFlowsList();
  return { options: flows.map((f) => ({ value: f.key, label: f.name })), loading };
}
