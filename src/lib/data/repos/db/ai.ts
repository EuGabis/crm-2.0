"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useDbStore } from "./contacts";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface AiLog {
  id: string;
  feature: string;
  model: string;
  prompt: string;
  response: string;
  promptTokens: number;
  completionTokens: number;
  createdAt: string;
}

function mapLog(r: any): AiLog {
  return {
    id: r.id,
    feature: r.feature,
    model: r.model,
    prompt: r.prompt ?? "",
    response: r.response ?? "",
    promptTokens: r.prompt_tokens ?? 0,
    completionTokens: r.completion_tokens ?? 0,
    createdAt: r.created_at,
  };
}

export const aiActions = {
  async generate(input: {
    system?: string;
    prompt: string;
    feature?: string;
  }): Promise<{ ok: boolean; text?: string; error?: string }> {
    const res = await fetch("/api/ai/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: json?.error ?? "Falha ao gerar" };
    return { ok: true, text: json.text };
  },
};

function useLocationId(): string | null {
  const [locationId, setLocationId] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    // `ensureSession`, não `load()`: aqui só se precisa saber a empresa, e
    // `load()` baixaria a lista inteira de contatos de brinde.
    void useDbStore
      .getState()
      .ensureSession()
      .then(() => {
        if (active) setLocationId(useDbStore.getState().locationId);
      });
    return () => {
      active = false;
    };
  }, []);
  return locationId;
}

export function useAiLogs(limit = 20) {
  const locationId = useLocationId();
  const [logs, setLogs] = useState<AiLog[]>([]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!locationId) return;
    let active = true;
    const supabase = createClient();
    void supabase
      .from("ai_logs")
      .select("*")
      .eq("location_id", locationId)
      .order("created_at", { ascending: false })
      .limit(limit)
      .then(({ data }) => {
        if (!active) return;
        setLogs((data ?? []).map(mapLog));
        setReady(true);
      });
    return () => {
      active = false;
    };
  }, [locationId, limit]);
  return { logs, ready };
}

export function useAiUsage() {
  const locationId = useLocationId();
  const [state, setState] = useState({ callsThisMonth: 0, tokensThisMonth: 0, ready: false });
  useEffect(() => {
    if (!locationId) return;
    let active = true;
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    const supabase = createClient();
    void supabase
      .from("ai_logs")
      .select("prompt_tokens, completion_tokens")
      .eq("location_id", locationId)
      .gte("created_at", start.toISOString())
      .then(({ data }) => {
        if (!active) return;
        const rows = data ?? [];
        const tokens = rows.reduce(
          (a: number, r: any) => a + (r.prompt_tokens ?? 0) + (r.completion_tokens ?? 0),
          0,
        );
        setState({ callsThisMonth: rows.length, tokensThisMonth: tokens, ready: true });
      });
    return () => {
      active = false;
    };
  }, [locationId]);
  return state;
}

/**
 * Histórico das análises que o USUÁRIO ATUAL pediu na aba Análise IA.
 *
 * Só as próprias, e não as da empresa: a policy de leitura de `ai_logs` é por
 * location, então sem o filtro dois administradores veriam as perguntas um do
 * outro embaralhadas na mesma lista — e o que a pessoa quer reler é o que ELA
 * perguntou.
 *
 * ⚠️ `recarregar` existe porque a lista não se atualiza sozinha: a análise nova
 * é gravada pela ROTA (no servidor), então o client não fica sabendo do insert.
 */
export function useAiAnalyses(feature = "reports-analysis", limit = 30) {
  const locationId = useLocationId();
  const [analises, setAnalises] = useState<AiLog[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [gatilho, setGatilho] = useState(0);

  useEffect(() => {
    if (!locationId) return;
    let ativo = true;
    const userId = useDbStore.getState().userId;
    void createClient()
      .from("ai_logs")
      .select("*")
      .eq("location_id", locationId)
      .eq("feature", feature)
      .eq("created_by", userId ?? "")
      .order("created_at", { ascending: false })
      .limit(limit)
      .then(({ data }: any) => {
        if (!ativo) return;
        setAnalises(((data ?? []) as any[]).map(mapLog));
        setCarregando(false);
      });
    return () => {
      ativo = false;
    };
  }, [locationId, feature, limit, gatilho]);

  return { analises, carregando, recarregar: () => setGatilho((g) => g + 1) };
}
