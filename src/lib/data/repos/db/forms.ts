"use client";

import { useEffect, useState } from "react";
import { create } from "zustand";
import { createClient } from "@/lib/supabase/client";
import type { FormField, LeadForm } from "@/lib/data/types";
import { useDbStore } from "./contacts";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const DEFAULT_FIELDS: FormField[] = [
  { key: "nome", label: "Nome", type: "text", required: true, mapsTo: "name" },
  { key: "email", label: "E-mail", type: "email", required: true, mapsTo: "email" },
  { key: "whatsapp", label: "WhatsApp", type: "tel", required: true, mapsTo: "phone" },
];

function mapForm(r: any): LeadForm {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description ?? "",
    fields: (r.fields ?? []) as FormField[],
    successAction: r.success_action,
    successValue: r.success_value ?? "",
    tag: r.tag,
    smartListId: r.smart_list_id ?? null,
    active: r.active,
    createdAt: r.created_at,
  };
}

function genSlug(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

export function embedSnippet(slug: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || "https://lito-crm.vercel.app";
  return `<script src="${base.replace(/\/$/, "")}/api/forms/${slug}/embed.js"></script>`;
}

interface FormsState {
  loaded: boolean;
  loading: boolean;
  forms: LeadForm[];
  load: () => Promise<void>;
  set: (forms: LeadForm[]) => void;
}

const useFormsStore = create<FormsState>((setState, get) => ({
  loaded: false,
  loading: false,
  forms: [],
  set: (forms) => setState({ forms }),
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
      .from("forms")
      .select("*")
      .eq("location_id", locationId)
      .order("created_at", { ascending: false });
    setState({ loaded: true, loading: false, forms: (data ?? []).map(mapForm) });
  },
}));

export function useForms() {
  const { forms, loaded, loading, load } = useFormsStore();
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { forms, ready: loaded && !loading };
}

export const formActions = {
  async create(input: {
    name: string;
    description?: string;
    fields?: FormField[];
    tag?: string;
  }): Promise<{ ok: boolean; slug?: string; error?: string }> {
    const locationId = useDbStore.getState().locationId;
    if (!locationId) return { ok: false, error: "Empresa não encontrada" };
    const supabase = createClient();
    const tag = (input.tag?.trim() || input.name.trim());

    // 1) Lista Inteligente que filtra pela tag do form
    const { data: sl } = await supabase
      .from("smart_lists")
      .insert({
        location_id: locationId,
        name: input.name.trim(),
        conditions: [{ field: "Tag", operator: "contém", value: tag }],
      })
      .select("id")
      .single();

    // 2) o form
    const slug = genSlug();
    const { data, error } = await supabase
      .from("forms")
      .insert({
        location_id: locationId,
        slug,
        name: input.name.trim(),
        description: input.description?.trim() ?? "",
        fields: input.fields ?? DEFAULT_FIELDS,
        tag,
        smart_list_id: (sl as any)?.id ?? null,
      })
      .select()
      .single();
    if (error || !data) return { ok: false, error: error?.message ?? "Não foi possível criar" };

    const s = useFormsStore.getState();
    s.set([mapForm(data), ...s.forms]);
    return { ok: true, slug };
  },

  async update(
    id: string,
    patch: Partial<Pick<LeadForm, "name" | "description" | "fields" | "successAction" | "successValue" | "active">>,
  ): Promise<boolean> {
    const supabase = createClient();
    const row: any = {};
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.description !== undefined) row.description = patch.description;
    if (patch.fields !== undefined) row.fields = patch.fields;
    if (patch.successAction !== undefined) row.success_action = patch.successAction;
    if (patch.successValue !== undefined) row.success_value = patch.successValue;
    if (patch.active !== undefined) row.active = patch.active;
    const { data, error } = await supabase.from("forms").update(row).eq("id", id).select().single();
    if (error || !data) return false;
    const s = useFormsStore.getState();
    s.set(s.forms.map((f) => (f.id === id ? mapForm(data) : f)));
    return true;
  },

  async remove(id: string): Promise<boolean> {
    const supabase = createClient();
    const { error } = await supabase.from("forms").delete().eq("id", id);
    if (error) return false;
    const s = useFormsStore.getState();
    s.set(s.forms.filter((f) => f.id !== id));
    return true;
  },

  async toggleActive(id: string, active: boolean): Promise<boolean> {
    return formActions.update(id, { active });
  },
};

export function useFormSubmissions(formId: string) {
  const [submissions, setSubmissions] = useState<
    { id: string; payload: Record<string, unknown>; createdAt: string }[]
  >([]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    const supabase = createClient();
    void supabase
      .from("form_submissions")
      .select("id, payload, created_at")
      .eq("form_id", formId)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (!active) return;
        setSubmissions(
          (data ?? []).map((r: any) => ({ id: r.id, payload: r.payload ?? {}, createdAt: r.created_at })),
        );
        setReady(true);
      });
    return () => {
      active = false;
    };
  }, [formId]);
  return { submissions, ready };
}
