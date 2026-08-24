"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { createClient } from "@/lib/supabase/client";
import type { Workflow, WorkflowNode } from "@/lib/data/types";
import { useDbStore } from "./contacts";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Fluxos de automação REAIS (tabela public.workflows). Diferente do repo mock:
 * aqui o fluxo é gravado no banco com `trigger` / `actions` (os nós da tela) e,
 * derivados deles, `trigger_key` + `steps` — que é o que o MOTOR (0007 + cron)
 * lê para executar. Publicar = status 'published' → o gatilho passa a enfileirar
 * runs de verdade.
 */

// Catálogo visual -> ActionKey do executor (src/lib/automations/types.ts).
// null = ação ainda sem equivalente no motor (não entra nos steps executáveis).
const ACTION_KEY_MAP: Record<string, string | null> = {
  "adicionar-tag": "adicionar-tag",
  "remover-tag": "remover-tag",
  "atualizar-campo": "atualizar-campo",
  "atribuir-usuario": "atribuir-usuario",
  "adicionar-tarefa": "criar-tarefa",
  "atualizar-oportunidade": "criar-oportunidade",
  "enviar-email": "enviar-email",
  "nota-interna": "nota-interna",
  "enviar-whatsapp": "enviar-whatsapp",
  "enviar-sms": "enviar-sms",
  "if-else": "condicao",
  "esperar": "esperar",
  "webhook": "webhook",
  // sem equivalente no motor (por enquanto):
  "ir-para": null,
  "split-test": null,
  "conversao-meta": null,
  "agente-ia": null,
};

/** Ações que o motor EXECUTA de fato hoje (as demais são puladas/no-op). */
export const EXECUTABLE_ACTIONS = new Set(
  Object.entries(ACTION_KEY_MAP)
    .filter(([, v]) => v !== null)
    .map(([k]) => k),
);

function deriveEngine(wf: Pick<Workflow, "trigger" | "actions">) {
  const steps = wf.actions
    .map((a) => {
      const key = ACTION_KEY_MAP[a.key];
      return key ? { key, config: a.config ?? {} } : null;
    })
    .filter(Boolean);
  return {
    trigger_key: wf.trigger?.key ?? null,
    trigger_config: wf.trigger?.config ?? {},
    steps,
  };
}

const mapWorkflow = (r: any): Workflow => ({
  id: r.id,
  name: r.name,
  folder: r.folder ?? null,
  status: r.status === "published" ? "published" : "draft",
  enrolledTotal: r.enrolled_total ?? 0,
  enrolledActive: r.enrolled_active ?? 0,
  createdAt: r.created_at,
  updatedAt: r.updated_at ?? r.created_at,
  trigger: r.trigger && typeof r.trigger === "object" && r.trigger.key ? (r.trigger as WorkflowNode) : null,
  actions: Array.isArray(r.actions) ? (r.actions as WorkflowNode[]) : [],
});

interface WfState {
  loaded: boolean;
  loading: boolean;
  workflows: Workflow[];
  load: () => Promise<void>;
  patch: (list: Workflow[]) => void;
}

export const useWfStore = create<WfState>((set, get) => ({
  loaded: false,
  loading: false,
  workflows: [],
  load: async () => {
    if (get().loaded || get().loading) return;
    set({ loading: true });
    await useDbStore.getState().load();
    const supabase = createClient();
    const { data } = await supabase.from("workflows").select("*").order("created_at", { ascending: false });
    set({ loaded: true, loading: false, workflows: (data ?? []).map(mapWorkflow) });
  },
  patch: (list) => set({ workflows: list }),
}));

const loc = () => useDbStore.getState().locationId;

/** Grava o fluxo inteiro no banco (nós + derivados do motor) e atualiza a store. */
async function save(wf: Workflow): Promise<void> {
  const supabase = createClient();
  const engine = deriveEngine(wf);
  await supabase
    .from("workflows")
    .update({
      name: wf.name,
      folder: wf.folder,
      status: wf.status,
      trigger: wf.trigger,
      actions: wf.actions,
      trigger_key: engine.trigger_key,
      trigger_config: engine.trigger_config,
      steps: engine.steps,
    })
    .eq("id", wf.id);
  const s = useWfStore.getState();
  s.patch(s.workflows.map((w) => (w.id === wf.id ? wf : w)));
}

function current(id: string): Workflow | null {
  return useWfStore.getState().workflows.find((w) => w.id === id) ?? null;
}

export const dbWorkflowActions = {
  async create(name: string, folder?: string): Promise<string | null> {
    const location = loc();
    if (!location) return null;
    const supabase = createClient();
    const { data, error } = await supabase
      .from("workflows")
      .insert({
        location_id: location,
        name,
        folder: folder ?? null,
        status: "draft",
        trigger: null,
        actions: [],
      })
      .select("*")
      .single();
    if (error || !data) return null;
    const wf = mapWorkflow(data);
    const s = useWfStore.getState();
    s.patch([wf, ...s.workflows]);
    return wf.id;
  },

  async setTrigger(id: string, node: WorkflowNode): Promise<void> {
    const wf = current(id);
    if (!wf) return;
    await save({ ...wf, trigger: node });
  },

  async addAction(id: string, node: WorkflowNode): Promise<void> {
    const wf = current(id);
    if (!wf) return;
    await save({ ...wf, actions: [...wf.actions, node] });
  },

  async updateNodeConfig(id: string, nodeId: string, config: Record<string, unknown>): Promise<void> {
    const wf = current(id);
    if (!wf) return;
    const patchNode = (n: WorkflowNode): WorkflowNode =>
      n.id === nodeId ? { ...n, config } : n;
    await save({
      ...wf,
      trigger: wf.trigger ? patchNode(wf.trigger) : null,
      actions: wf.actions.map(patchNode),
    });
  },

  async removeNode(id: string, nodeId: string): Promise<void> {
    const wf = current(id);
    if (!wf) return;
    await save({
      ...wf,
      trigger: wf.trigger?.id === nodeId ? null : wf.trigger,
      actions: wf.actions.filter((a) => a.id !== nodeId),
    });
  },

  async toggleStatus(id: string): Promise<void> {
    const wf = current(id);
    if (!wf) return;
    await save({ ...wf, status: wf.status === "published" ? "draft" : "published" });
  },

  async remove(id: string): Promise<void> {
    const supabase = createClient();
    await supabase.from("workflows").delete().eq("id", id);
    const s = useWfStore.getState();
    s.patch(s.workflows.filter((w) => w.id !== id));
  },
};

export function useDbWorkflows() {
  const { workflows, load } = useWfStore();
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return workflows;
}

export function useDbWorkflow(id: string | null) {
  const workflows = useDbWorkflows();
  return id ? workflows.find((w) => w.id === id) ?? null : null;
}
