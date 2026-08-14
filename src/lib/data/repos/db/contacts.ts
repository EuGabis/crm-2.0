"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { createClient } from "@/lib/supabase/client";
import type { Channel, Contact, User } from "@/lib/data/types";

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapContact(row: any): Contact {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone,
    company: row.company ?? undefined,
    tags: row.tags ?? [],
    ownerId: row.owner_id ?? "",
    createdAt: row.created_at,
    lastActivityAt: row.last_activity_at ?? row.created_at,
    lastActivityChannel: (row.last_activity_channel ?? "whatsapp") as Channel,
    dnd: row.dnd,
    customFields: row.custom_fields ?? {},
  };
}

interface DbState {
  loaded: boolean;
  loading: boolean;
  retries: number;
  locationId: string | null;
  userId: string | null;
  contacts: Contact[];
  team: User[];
  load: () => Promise<void>;
  setContacts: (fn: (prev: Contact[]) => Contact[]) => void;
}

export const useDbStore = create<DbState>((set, get) => ({
  loaded: false,
  loading: false,
  retries: 0,
  locationId: null,
  userId: null,
  contacts: [],
  team: [],

  load: async () => {
    if (get().loaded || get().loading) return;
    set({ loading: true });
    const supabase = createClient();

    const [{ data: auth, error: authErr }, { data: memberships, error: memErr }] = await Promise.all([
      supabase.auth.getUser(),
      supabase.from("location_members").select("location_id, user_id, role"),
    ]);

    // Falha transitória (sessão ainda hidratando, rede, RLS momentânea): NÃO cacheia
    // como carregado — senão o app inteiro trava vazio ("nenhum canal", listas sumindo)
    // até um F5. Deixa loaded=false e tenta de novo em 1s (bounded) pra se auto-recuperar.
    if (authErr || memErr || !auth?.user) {
      set({ loading: false });
      if (get().retries < 5) {
        set({ retries: get().retries + 1 });
        setTimeout(() => void get().load(), 1000);
      }
      return;
    }

    const membership = memberships?.find((m) => m.user_id === auth.user!.id) ?? memberships?.[0];
    if (!membership) {
      // Usuário válido mas sem empresa (caso real e raro): marca carregado pra não spinnar.
      set({ loading: false, loaded: true });
      return;
    }

    const [{ data: contacts }, { data: profiles }] = await Promise.all([
      supabase
        .from("contacts")
        .select("*")
        .eq("location_id", membership.location_id)
        .order("created_at", { ascending: false }),
      supabase.from("profiles").select("*"),
    ]);

    const roleByUser = new Map(memberships?.map((m) => [m.user_id, m.role]) ?? []);
    const team: User[] = (profiles ?? []).map((p: any) => ({
      id: p.id,
      name: p.name,
      email: p.email,
      role: (roleByUser.get(p.id) ?? "user") as User["role"],
      color: p.color,
    }));

    set({
      loaded: true,
      loading: false,
      locationId: membership.location_id,
      userId: auth.user?.id ?? null,
      contacts: (contacts ?? []).map(mapContact),
      team,
    });
  },

  setContacts: (fn) => set((s) => ({ contacts: fn(s.contacts) })),
}));

/** Carrega (uma vez) e retorna os contatos reais da location do usuário. */
export function useDbContacts() {
  const { contacts, loading, loaded, load } = useDbStore();
  useEffect(() => {
    void load();
  }, [load]);
  return { contacts, loading: loading || !loaded };
}

export function useDbContact(id: string | null) {
  const { contacts, loading } = useDbContacts();
  return { contact: id ? contacts.find((c) => c.id === id) ?? null : null, loading };
}

export function useDbTeam() {
  const { team, load } = useDbStore();
  useEffect(() => {
    void load();
  }, [load]);
  return team;
}

export const dbContactActions = {
  async add(input: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    company?: string;
    tags: string[];
    customFields?: Record<string, string>;
  }): Promise<boolean> {
    const { locationId, userId, setContacts } = useDbStore.getState();
    if (!locationId) return false;
    const supabase = createClient();
    const { data, error } = await supabase
      .from("contacts")
      .insert({
        location_id: locationId,
        first_name: input.firstName,
        last_name: input.lastName,
        email: input.email,
        phone: input.phone,
        company: input.company ?? null,
        tags: input.tags,
        owner_id: userId,
        custom_fields: input.customFields ?? {},
      })
      .select()
      .single();
    if (error || !data) return false;
    setContacts((prev) => [mapContact(data), ...prev]);
    return true;
  },

  async addTag(ids: string[], tag: string): Promise<boolean> {
    const { contacts, setContacts } = useDbStore.getState();
    const supabase = createClient();
    const updates = ids
      .map((id) => contacts.find((c) => c.id === id))
      .filter((c): c is Contact => !!c && !c.tags.includes(tag));
    const results = await Promise.all(
      updates.map((c) =>
        supabase.from("contacts").update({ tags: [...c.tags, tag] }).eq("id", c.id)
      )
    );
    if (results.some((r) => r.error)) return false;
    setContacts((prev) =>
      prev.map((c) =>
        ids.includes(c.id) && !c.tags.includes(tag) ? { ...c, tags: [...c.tags, tag] } : c
      )
    );
    return true;
  },

  async removeTag(ids: string[], tag: string): Promise<boolean> {
    const { contacts, setContacts } = useDbStore.getState();
    const supabase = createClient();
    const updates = ids
      .map((id) => contacts.find((c) => c.id === id))
      .filter((c): c is Contact => !!c && c.tags.includes(tag));
    const results = await Promise.all(
      updates.map((c) =>
        supabase
          .from("contacts")
          .update({ tags: c.tags.filter((t) => t !== tag) })
          .eq("id", c.id)
      )
    );
    if (results.some((r) => r.error)) return false;
    setContacts((prev) =>
      prev.map((c) => (ids.includes(c.id) ? { ...c, tags: c.tags.filter((t) => t !== tag) } : c))
    );
    return true;
  },

  async remove(ids: string[]): Promise<boolean> {
    const supabase = createClient();
    const { error } = await supabase.from("contacts").delete().in("id", ids);
    if (error) return false;
    useDbStore.getState().setContacts((prev) => prev.filter((c) => !ids.includes(c.id)));
    return true;
  },

  async update(
    id: string,
    patch: Partial<
      Pick<Contact, "firstName" | "lastName" | "email" | "phone" | "company" | "customFields">
    >
  ): Promise<boolean> {
    const supabase = createClient();
    const row: Record<string, unknown> = {};
    if (patch.firstName !== undefined) row.first_name = patch.firstName;
    if (patch.lastName !== undefined) row.last_name = patch.lastName;
    if (patch.email !== undefined) row.email = patch.email;
    if (patch.phone !== undefined) row.phone = patch.phone;
    if (patch.company !== undefined) row.company = patch.company || null;
    if (patch.customFields !== undefined) row.custom_fields = patch.customFields;
    const { data, error } = await supabase
      .from("contacts")
      .update(row)
      .eq("id", id)
      .select()
      .single();
    if (error || !data) return false;
    useDbStore
      .getState()
      .setContacts((prev) => prev.map((c) => (c.id === id ? mapContact(data) : c)));
    return true;
  },

  /** Importação em massa (CSV). Retorna o nº de contatos inseridos, ou -1 em erro. */
  async bulkInsert(
    rows: {
      firstName: string;
      lastName: string;
      email: string;
      phone: string;
      company?: string;
      tags: string[];
    }[]
  ): Promise<number> {
    const { locationId, userId, setContacts } = useDbStore.getState();
    if (!locationId || rows.length === 0) return -1;
    const supabase = createClient();
    const { data, error } = await supabase
      .from("contacts")
      .insert(
        rows.map((r) => ({
          location_id: locationId,
          first_name: r.firstName,
          last_name: r.lastName,
          email: r.email,
          phone: r.phone,
          company: r.company ?? null,
          tags: r.tags,
          owner_id: userId,
        }))
      )
      .select();
    if (error || !data) return -1;
    setContacts((prev) => [...data.map(mapContact), ...prev]);
    return data.length;
  },
};
