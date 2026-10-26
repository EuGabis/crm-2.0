"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { createClient } from "@/lib/supabase/client";
import type { FilterCondition } from "@/components/shared/filter-drawer";
import { useDbStore } from "./contacts";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface SmartList {
  id: string;
  name: string;
  conditions: FilterCondition[];
}

export interface DbTask {
  id: string;
  title: string;
  contactId: string | null;
  assigneeId: string | null;
  dueAt: string | null;
  /** Minutos antes do prazo para o CRM avisar; null = sem lembrete (0050). */
  reminderMinutes: number | null;
  status: "pending" | "done";
  createdAt: string;
}

export type FieldType = "text" | "dropdown" | "date" | "number";

export const FIELD_TYPE_LABEL: Record<FieldType, string> = {
  text: "Texto",
  dropdown: "Dropdown",
  date: "Data",
  number: "Número",
};

export interface ContactField {
  id: string;
  name: string;
  type: FieldType;
  options: string[];
  active: boolean;
}

export interface BulkLog {
  id: string;
  operation: string;
  affected: number;
  status: "done" | "processing";
  createdBy: string | null;
  createdAt: string;
}

interface ModuleState {
  loaded: boolean;
  loading: boolean;
  smartLists: SmartList[];
  tasks: DbTask[];
  fields: ContactField[];
  logs: BulkLog[];
  load: () => Promise<void>;
  reload: () => Promise<void>;
  set: (patch: Partial<Pick<ModuleState, "smartLists" | "tasks" | "fields" | "logs">>) => void;
}

const mapTask = (r: any): DbTask => ({
  id: r.id,
  title: r.title,
  contactId: r.contact_id,
  assigneeId: r.assignee_id,
  dueAt: r.due_at,
  reminderMinutes: r.reminder_minutes ?? null,
  status: r.status,
  createdAt: r.created_at,
});

const mapField = (r: any): ContactField => ({
  id: r.id,
  name: r.name,
  type: r.type,
  options: r.options ?? [],
  active: r.active,
});

const mapLog = (r: any): BulkLog => ({
  id: r.id,
  operation: r.operation,
  affected: r.affected,
  status: r.status,
  createdBy: r.created_by,
  createdAt: r.created_at,
});

/**
 * Todas as tarefas que a RLS entrega, paginadas. O PostgREST corta no "Max
 * rows" (1000) sem erro e sem aviso, e já são 551 (502 de uma pessoa só).
 * Ordem desempatada por `id`: tarefa criada em lote sai com o mesmo carimbo, e
 * ordem instável entre páginas repete umas e pula outras.
 */
async function fetchAllTasks(supabase: ReturnType<typeof createClient>) {
  const PAGINA = 1000;
  const rows: any[] = [];
  for (let de = 0; de < 20 * PAGINA; de += PAGINA) {
    const { data, error } = await supabase
      .from("tasks")
      .select("*")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(de, de + PAGINA - 1);
    if (error) return { data: null, error };
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGINA) break;
  }
  return { data: rows, error: null };
}

export const useModuleStore = create<ModuleState>((set, get) => ({
  loaded: false,
  loading: false,
  smartLists: [],
  tasks: [],
  fields: [],
  logs: [],

  load: async () => {
    if (get().loaded || get().loading) return;
    set({ loading: true });
    await useDbStore.getState().ensureSession();
    const supabase = createClient();
    const [lists, tasks, fields, logs] = await Promise.all([
      supabase.from("smart_lists").select("*").order("created_at"),
      fetchAllTasks(supabase),
      supabase.from("contact_fields").select("*").order("position").order("created_at"),
      supabase.from("bulk_logs").select("*").order("created_at", { ascending: false }).limit(50),
    ]);
    set({
      loaded: true,
      loading: false,
      smartLists: (lists.data ?? []).map((r: any) => ({
        id: r.id,
        name: r.name,
        conditions: r.conditions ?? [],
      })),
      tasks: (tasks.data ?? []).map(mapTask),
      fields: (fields.data ?? []).map(mapField),
      logs: (logs.data ?? []).map(mapLog),
    });
  },

  /** Mesma leitura do `load`, sem piscar a tela (tarefas criadas por automação). */
  reload: async () => {
    const supabase = createClient();
    const [lists, tasks, fields, logs] = await Promise.all([
      supabase.from("smart_lists").select("*").order("created_at"),
      fetchAllTasks(supabase),
      supabase.from("contact_fields").select("*").order("position").order("created_at"),
      supabase.from("bulk_logs").select("*").order("created_at", { ascending: false }).limit(50),
    ]);
    if (tasks.error) return;
    set({
      smartLists: (lists.data ?? []).map((r: any) => ({
        id: r.id,
        name: r.name,
        conditions: r.conditions ?? [],
      })),
      tasks: (tasks.data ?? []).map(mapTask),
      fields: (fields.data ?? []).map(mapField),
      logs: (logs.data ?? []).map(mapLog),
    });
  },

  set: (patch) => set(patch),
}));

export function useContactsModule() {
  const store = useModuleStore();
  useEffect(() => {
    void store.load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return store;
}

function locationId() {
  return useDbStore.getState().locationId;
}
function userId() {
  return useDbStore.getState().userId;
}

export async function logBulk(operation: string, affected: number) {
  const loc = locationId();
  if (!loc) return;
  const supabase = createClient();
  const { data } = await supabase
    .from("bulk_logs")
    .insert({ location_id: loc, operation, affected, created_by: userId() })
    .select()
    .single();
  if (data) {
    useModuleStore.getState().set({
      logs: [mapLog(data), ...useModuleStore.getState().logs],
    });
  }
}

export const smartListActions = {
  async add(name: string, conditions: FilterCondition[]): Promise<boolean> {
    const loc = locationId();
    if (!loc) return false;
    const supabase = createClient();
    const { data, error } = await supabase
      .from("smart_lists")
      .insert({ location_id: loc, name, conditions })
      .select()
      .single();
    if (error || !data) return false;
    const s = useModuleStore.getState();
    s.set({
      smartLists: [...s.smartLists, { id: data.id, name: data.name, conditions: data.conditions }],
    });
    return true;
  },
  async remove(id: string): Promise<boolean> {
    const supabase = createClient();
    const { error } = await supabase.from("smart_lists").delete().eq("id", id);
    if (error) return false;
    const s = useModuleStore.getState();
    s.set({ smartLists: s.smartLists.filter((l) => l.id !== id) });
    return true;
  },
};

export type ResultadoTarefa =
  | { ok: true; visivel: boolean }
  | { ok: false; erro: string };

export const taskActions = {
  /**
   * Cria a tarefa. ⚠️ Não pede a linha de volta: tarefa criada PARA um colega
   * não passa na policy de SELECT de quem não vê tudo (202610231400), e um
   * `.select()` faria o insert inteiro cair em 42501. O id nasce aqui e a
   * linha é relida — `visivel: false` quer dizer "criada, mas é de outra
   * pessoa e você não a enxerga".
   */
  async add(input: {
    title: string;
    contactId: string | null;
    assigneeId: string | null;
    dueAt: string | null;
    reminderMinutes?: number | null;
  }): Promise<boolean> {
    const r = await taskActions.criar(input);
    return r.ok;
  },
  async criar(input: {
    title: string;
    contactId: string | null;
    assigneeId: string | null;
    dueAt: string | null;
    reminderMinutes?: number | null;
  }): Promise<ResultadoTarefa> {
    const loc = locationId();
    if (!loc) return { ok: false, erro: "sessão não carregada" };
    const supabase = createClient();
    const id = crypto.randomUUID();
    const { error } = await supabase.from("tasks").insert({
      id,
      location_id: loc,
      title: input.title,
      contact_id: input.contactId,
      assignee_id: input.assigneeId,
      due_at: input.dueAt,
      reminder_minutes: input.reminderMinutes ?? null,
    });
    if (error) return { ok: false, erro: `${error.code ?? ""} ${error.message}`.trim() };
    const { data } = await supabase.from("tasks").select("*").eq("id", id).maybeSingle();
    if (!data) return { ok: true, visivel: false };
    const s = useModuleStore.getState();
    s.set({ tasks: [mapTask(data), ...s.tasks] });
    return { ok: true, visivel: true };
  },
  /**
   * Edita título, contato, responsável e prazo. Confere as LINHAS devolvidas:
   * UPDATE recusado pela RLS não vem com erro. Passar a tarefa para um colega
   * pode tirá-la da vista de quem passou — aí ela sai da lista.
   */
  async update(
    id: string,
    patch: { title: string; contactId: string | null; assigneeId: string | null; dueAt: string | null },
  ): Promise<ResultadoTarefa> {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("tasks")
      .update({
        title: patch.title,
        contact_id: patch.contactId,
        assignee_id: patch.assigneeId,
        due_at: patch.dueAt,
      })
      .eq("id", id)
      .select("id");
    if (error) return { ok: false, erro: `${error.code ?? ""} ${error.message}`.trim() };
    if (!data || data.length === 0) return { ok: false, erro: "sem permissão para editar esta tarefa" };
    const { data: linha } = await supabase.from("tasks").select("*").eq("id", id).maybeSingle();
    const s = useModuleStore.getState();
    s.set({
      tasks: linha
        ? s.tasks.map((t) => (t.id === id ? mapTask(linha) : t))
        : s.tasks.filter((t) => t.id !== id),
    });
    return { ok: true, visivel: !!linha };
  },
  async toggle(id: string): Promise<boolean> {
    const s = useModuleStore.getState();
    const task = s.tasks.find((t) => t.id === id);
    if (!task) return false;
    const status = task.status === "done" ? "pending" : "done";
    const supabase = createClient();
    const { data, error } = await supabase.from("tasks").update({ status }).eq("id", id).select("id");
    if (error || !data || data.length === 0) return false;
    s.set({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, status } : t)) });
    return true;
  },
  async remove(id: string): Promise<boolean> {
    const supabase = createClient();
    // DELETE recusado pela RLS não vem com erro: conferir as linhas.
    const { data, error } = await supabase.from("tasks").delete().eq("id", id).select("id");
    if (error || !data || data.length === 0) return false;
    const s = useModuleStore.getState();
    s.set({ tasks: s.tasks.filter((t) => t.id !== id) });
    return true;
  },
};

export const fieldActions = {
  async add(input: { name: string; type: FieldType; options: string[] }): Promise<boolean> {
    const loc = locationId();
    if (!loc) return false;
    const supabase = createClient();
    const { data, error } = await supabase
      .from("contact_fields")
      .insert({
        location_id: loc,
        name: input.name,
        type: input.type,
        options: input.options,
        position: useModuleStore.getState().fields.length,
      })
      .select()
      .single();
    if (error || !data) return false;
    const s = useModuleStore.getState();
    s.set({ fields: [...s.fields, mapField(data)] });
    return true;
  },
  async toggle(id: string): Promise<boolean> {
    const s = useModuleStore.getState();
    const field = s.fields.find((f) => f.id === id);
    if (!field) return false;
    const supabase = createClient();
    const { error } = await supabase
      .from("contact_fields")
      .update({ active: !field.active })
      .eq("id", id);
    if (error) return false;
    s.set({ fields: s.fields.map((f) => (f.id === id ? { ...f, active: !f.active } : f)) });
    return true;
  },
  async remove(id: string): Promise<boolean> {
    const supabase = createClient();
    const { error } = await supabase.from("contact_fields").delete().eq("id", id);
    if (error) return false;
    const s = useModuleStore.getState();
    s.set({ fields: s.fields.filter((f) => f.id !== id) });
    return true;
  },
};
