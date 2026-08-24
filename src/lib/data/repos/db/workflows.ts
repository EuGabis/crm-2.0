"use client";

import { useEffect } from "react";
import { create as createStore } from "zustand";
import { createClient } from "@/lib/supabase/client";
import type { Workflow, WorkflowNode } from "@/lib/data/types";
import { useDbStore } from "./contacts";

/* eslint-disable @typescript-eslint/no-explicit-any */

const mapWorkflow = (r: any): Workflow => ({
  id: r.id,
  name: r.name,
  folder: r.folder ?? null,
  status: r.status,
  enrolledTotal: r.enrolled_total ?? 0,
  enrolledActive: r.enrolled_active ?? 0,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  trigger: (r.trigger as WorkflowNode | null) ?? null,
  actions: Array.isArray(r.actions) ? (r.actions as WorkflowNode[]) : [],
});

interface WfState {
  loaded: boolean;
  loading: boolean;
  workflows: Workflow[];
  load: () => Promise<void>;
  patch: (w: Workflow[]) => void;
  patchOne: (w: Workflow) => void;
}

const byUpdatedDesc = (a: Workflow, b: Workflow) => b.updatedAt.localeCompare(a.updatedAt);

export const useWfStore = createStore<WfState>((set, get) => ({
  loaded: false,
  loading: false,
  workflows: [],

  load: async () => {
    if (get().loaded || get().loading) return;
    set({ loading: true });
    await useDbStore.getState().load();
    const supabase = createClient();
    const { data } = await supabase
      .from("workflows")
      .select("*")
      .order("updated_at", { ascending: false });
    set({ loaded: true, loading: false, workflows: (data ?? []).map(mapWorkflow) });
  },

  patch: (workflows) => set({ workflows: [...workflows].sort(byUpdatedDesc) }),
  patchOne: (w) =>
    set((s) => ({
      workflows: [w, ...s.workflows.filter((x) => x.id !== w.id)].sort(byUpdatedDesc),
    })),
}));

export function useDbWorkflows() {
  const { workflows, loading, loaded, load } = useWfStore();
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { workflows, loading: loading || !loaded };
}

export function useDbWorkflow(id: string | null) {
  const { workflows, loading, loaded, load } = useWfStore();
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const workflow = id ? workflows.find((w) => w.id === id) ?? null : null;
  return { workflow, loading: loading || !loaded };
}

/**
 * Persiste trigger/actions de um fluxo no banco e atualiza o store local
 * de forma otimista. A RLS garante que só membros da location editam.
 */
async function persist(
  id: string,
  patch: { trigger?: WorkflowNode | null; actions?: WorkflowNode[]; status?: Workflow["status"] }
): Promise<boolean> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("workflows")
    .update({
      ...(patch.trigger !== undefined ? { trigger: patch.trigger } : {}),
      ...(patch.actions !== undefined ? { actions: patch.actions } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
    })
    .eq("id", id)
    .select()
    .single();
  if (error || !data) return false;
  useWfStore.getState().patchOne(mapWorkflow(data));
  return true;
}

export const workflowDbActions = {
  /** Cria um fluxo como rascunho e devolve o id (ou null em falha). */
  async create(name: string, folder?: string): Promise<string | null> {
    const locationId = useDbStore.getState().locationId;
    if (!locationId) return null;
    const supabase = createClient();
    const { data, error } = await supabase
      .from("workflows")
      .insert({
        location_id: locationId,
        name,
        folder: folder ?? null,
        status: "draft",
        trigger: null,
        actions: [],
      })
      .select()
      .single();
    if (error || !data) return null;
    useWfStore.getState().patchOne(mapWorkflow(data));
    return data.id as string;
  },

  setTrigger(id: string, node: WorkflowNode): Promise<boolean> {
    return persist(id, { trigger: node });
  },

  addAction(id: string, node: WorkflowNode): Promise<boolean> {
    const wf = useWfStore.getState().workflows.find((w) => w.id === id);
    const actions = [...(wf?.actions ?? []), node];
    return persist(id, { actions });
  },

  removeNode(workflowId: string, nodeId: string): Promise<boolean> {
    const wf = useWfStore.getState().workflows.find((w) => w.id === workflowId);
    if (!wf) return Promise.resolve(false);
    if (wf.trigger?.id === nodeId) return persist(workflowId, { trigger: null });
    return persist(workflowId, { actions: wf.actions.filter((a) => a.id !== nodeId) });
  },

  toggleStatus(id: string): Promise<boolean> {
    const wf = useWfStore.getState().workflows.find((w) => w.id === id);
    if (!wf) return Promise.resolve(false);
    return persist(id, { status: wf.status === "published" ? "draft" : "published" });
  },
};
