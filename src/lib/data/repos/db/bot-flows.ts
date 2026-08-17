"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useDbStore } from "./contacts";
import type { BotFlow } from "@/lib/bot/types";
import { triagemFlow } from "@/lib/bot/flows/triagem";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Fluxos embutidos usados como padrão até a empresa salvar uma versão editada. */
const DEFAULTS: Record<string, BotFlow> = {
  [triagemFlow.key]: triagemFlow,
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
      await useDbStore.getState().load();
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
