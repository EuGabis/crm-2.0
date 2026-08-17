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
    await useDbStore.getState().load();
    const supabase = createClient();
    const [lists, tasks, fields, logs] = await Promise.all([
      supabase.from("smart_lists").select("*").order("created_at"),
      supabase.from("tasks").select("*").order("created_at", { ascending: false }),
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

export const taskActions = {
  async add(input: {
    title: string;
    contactId: string | null;
    assigneeId: string | null;
    dueAt: string | null;
    reminderMinutes?: number | null;
  }): Promise<boolean> {
    const loc = locationId();
    if (!loc) return false;
    const supabase = createClient();
    const { data, error } = await supabase
      .from("tasks")
      .insert({
        location_id: loc,
        title: input.title,
        contact_id: input.contactId,
        assignee_id: input.assigneeId,
        due_at: input.dueAt,
        reminder_minutes: input.reminderMinutes ?? null,
      })
      .select()
      .single();
    if (error || !data) return false;
    const s = useModuleStore.getState();
    s.set({ tasks: [mapTask(data), ...s.tasks] });
    return true;
  },
  async toggle(id: string): Promise<boolean> {
    const s = useModuleStore.getState();
    const task = s.tasks.find((t) => t.id === id);
    if (!task) return false;
    const status = task.status === "done" ? "pending" : "done";
    const supabase = createClient();
    const { error } = await supabase.from("tasks").update({ status }).eq("id", id);
    if (error) return false;
    s.set({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, status } : t)) });
    return true;
  },
  async remove(id: string): Promise<boolean> {
    const supabase = createClient();
    const { error } = await supabase.from("tasks").delete().eq("id", id);
    if (error) return false;
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
