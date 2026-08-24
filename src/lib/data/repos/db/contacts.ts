"use client";

import { useEffect, useState } from "react";
import { create } from "zustand";
import { createClient } from "@/lib/supabase/client";
import type { Channel, Contact, User } from "@/lib/data/types";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * O PostgREST corta a resposta em `PAGE` linhas (o "Max rows" do projeto no
 * Supabase) — SEM erro e SEM aviso: vem menos gente e o app acha que é tudo.
 *
 * ⚠️ Isso derrubou o nome do contato em TODAS as conversas depois da
 * importação do CRM antigo. Eram 365 contatos (caber em 1000 era acidente);
 * ao passar de 5 mil, o `order by created_at desc` devolveu os 1000 MAIS
 * NOVOS — os importados — e nenhum dos antigos, que são justamente os que têm
 * conversa. `contacts.find(...)` na lista do inbox não achava ninguém e as
 * 361 linhas caíam no fallback "Contato". Nada havia sido perdido no banco.
 *
 * Aqui a busca anda de página em página até a última vir incompleta. Continua
 * carregando a empresa inteira na memória: em 5 mil são 6 requisições e passa
 * batido, mas na casa das 50 mil isso é dezenas de MB por navegação (o
 * `RouteRevalidator` chama `reload()` a cada troca de rota) e a saída passa a
 * ser busca/paginação no servidor.
 */
async function fetchAllContacts(supabase: any, locationId: string) {
  const PAGE = 1000;
  const all: any[] = [];
  for (let from = 0; ; ) {
    const { data, error } = await supabase
      .from("contacts")
      .select("*")
      .eq("location_id", locationId)
      // ⚠️ O desempate por `id` não é enfeite: a importação grava 500 linhas por
      // transação, então as 500 saem com o MESMO `created_at` (o `now()` é o da
      // transação). Ordem instável entre páginas repetiria uns contatos e
      // pularia outros — e o pulado volta a ser "Contato" na conversa.
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + PAGE - 1);
    // Erro no MEIO da paginação devolve erro em vez de meia lista: meia lista é
    // pior, porque parece completa.
    if (error) return { data: null, error };
    const got = data?.length ?? 0;
    all.push(...(data ?? []));
    // Avança pelo que REALMENTE veio, e para só na página vazia: se o "Max rows"
    // do projeto for menor que PAGE, comparar com PAGE pararia na 1ª página e o
    // bug voltaria calado.
    if (got === 0) break;
    from += got;
  }
  return { data: all, error: null };
}

function mapContact(row: any): Contact {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone,
    doc: row.doc ?? undefined,
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
  reload: () => Promise<void>;
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
      fetchAllContacts(supabase, membership.location_id),
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

  /**
   * Relê contatos e equipe sem piscar a tela (não toca em `loading`/`loaded`).
   * O bot cria CONTATO além do card do funil — sem isso, o contato novo só
   * aparecia depois de um F5.
   */
  reload: async () => {
    const { locationId } = get();
    if (!locationId) return;
    const supabase = createClient();
    const [{ data: contacts, error }, { data: memberships }, { data: profiles }] =
      await Promise.all([
        fetchAllContacts(supabase, locationId),
        supabase.from("location_members").select("user_id, role"),
        supabase.from("profiles").select("*"),
      ]);
    // Falha de rede não pode esvaziar a lista que já está na tela.
    if (error) return;
    const roleByUser = new Map(memberships?.map((m: any) => [m.user_id, m.role]) ?? []);
    set({
      contacts: (contacts ?? []).map(mapContact),
      team: (profiles ?? []).map((pr: any) => ({
        id: pr.id,
        name: pr.name,
        email: pr.email,
        role: (roleByUser.get(pr.id) ?? "user") as User["role"],
        color: pr.color,
      })),
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
  const fromStore = id ? contacts.find((c) => c.id === id) ?? null : null;
  // O store carrega no máx. 1000 contatos (limite do PostgREST). Se o contato não
  // está lá (ex.: empresa com 50 mil), busca ELE sob demanda pelo id — assim a
  // conversa/painel abrem com os dados certos independente do tamanho da base.
  const [fetched, setFetched] = useState<Contact | null>(null);
  useEffect(() => {
    if (!id || fromStore) {
      setFetched(null);
      return;
    }
    let active = true;
    void (async () => {
      const supabase = createClient();
      const { data } = await supabase.from("contacts").select("*").eq("id", id).maybeSingle();
      if (active && data) setFetched(mapContact(data));
    })();
    return () => {
      active = false;
    };
  }, [id, fromStore]);
  return { contact: fromStore ?? fetched, loading };
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
    doc?: string;
    company?: string;
    tags: string[];
    customFields?: Record<string, string>;
  }): Promise<boolean> {
    const { locationId, userId, setContacts } = useDbStore.getState();
    if (!locationId) return false;
    const supabase = createClient();
    // Bloqueia duplicado por número (0047): não deixa criar 2 contatos com o
    // mesmo telefone, em qualquer formato.
    if (input.phone.trim()) {
      const { data: existingId } = await supabase.rpc("find_contact_by_phone", {
        p_location: locationId,
        p_phone: input.phone,
      });
      if (existingId) return false;
    }
    const { data, error } = await supabase
      .from("contacts")
      .insert({
        location_id: locationId,
        first_name: input.firstName,
        last_name: input.lastName,
        email: input.email,
        phone: input.phone,
        doc: input.doc?.trim() || null,
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

  /** Devolve o contato já existente com esse número (ou null) — p/ avisar antes de duplicar. */
  async findByPhone(phone: string): Promise<Contact | null> {
    const { locationId, contacts } = useDbStore.getState();
    if (!locationId || !phone.trim()) return null;
    const supabase = createClient();
    const { data: existingId } = await supabase.rpc("find_contact_by_phone", {
      p_location: locationId,
      p_phone: phone,
    });
    if (!existingId) return null;
    return contacts.find((c) => c.id === existingId) ?? null;
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
      Pick<
        Contact,
        "firstName" | "lastName" | "email" | "phone" | "doc" | "company" | "customFields"
      >
    >
  ): Promise<boolean> {
    const supabase = createClient();
    // Bloqueia trocar o telefone para um que já pertence a OUTRO contato (0047).
    if (patch.phone !== undefined && patch.phone.trim()) {
      const { locationId } = useDbStore.getState();
      const { data: existingId } = await supabase.rpc("find_contact_by_phone", {
        p_location: locationId,
        p_phone: patch.phone,
      });
      if (existingId && existingId !== id) return false;
    }
    const row: Record<string, unknown> = {};
    if (patch.firstName !== undefined) row.first_name = patch.firstName;
    if (patch.lastName !== undefined) row.last_name = patch.lastName;
    if (patch.email !== undefined) row.email = patch.email;
    if (patch.phone !== undefined) row.phone = patch.phone;
    if (patch.doc !== undefined) row.doc = patch.doc?.trim() || null;
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

  /**
   * Importação em massa (CSV) — feita em LOTES de propósito.
   *
   * ⚠️ Um único INSERT com as 50 mil linhas do CRM antigo NÃO passa:
   * o papel `authenticated` tem `statement_timeout = 8s` no Supabase, a RLS
   * roda o `with check` linha a linha e o `.select()` mandava as 50 mil de
   * volta pela rede. O erro chegava como 57014 (canceling statement due to
   * statement timeout) — e a tela só dizia "a importação falhou".
   *
   * Agora: lotes de `CHUNK`, no máximo `POOL` em paralelo, SEM `.select()`
   * (a resposta vazia é o que mantém o tráfego pequeno), lote que falha é
   * repartido ao meio até isolar a linha ruim, e o resto entra. Devolve o
   * que entrou, o que ficou de fora e a MENSAGEM real do banco.
   *
   * A lista da tela é relida no fim (`reload()`) em vez de receber 50 mil
   * linhas por `setContacts` — prepend desse tamanho travava a aba.
   */
  async bulkInsert(
    rows: {
      firstName: string;
      lastName: string;
      email: string;
      phone: string;
      doc?: string;
      company?: string;
      tags: string[];
    }[],
    onProgress?: (done: number, total: number) => void
  ): Promise<{ inserted: number; failed: number; error: string | null }> {
    const { locationId } = useDbStore.getState();
    if (!locationId) return { inserted: 0, failed: rows.length, error: "Empresa não carregada — recarregue a página" };
    if (rows.length === 0) return { inserted: 0, failed: 0, error: "Nada para importar" };

    // Os inserts acontecem no SERVIDOR (/api/contacts/import): o cliente só envia
    // os dados em poucos blocos curtos. Assim a aba não trava nem é suspensa no
    // meio de dezenas de milhares de inserts (era o ERR_NETWORK_IO_SUSPENDED).
    const CHUNK = 5000;
    let inserted = 0;
    let failed = 0;
    let firstError: string | null = null;

    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      try {
        const res = await fetch("/api/contacts/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows: chunk }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          failed += chunk.length;
          firstError ??= json?.error ?? `Falha HTTP ${res.status}`;
        } else {
          inserted += json.inserted ?? 0;
          failed += json.failed ?? 0;
          firstError ??= json.error ?? null;
        }
      } catch (e) {
        failed += chunk.length;
        firstError ??= e instanceof Error ? e.message : "Falha de conexão";
      }
      onProgress?.(inserted + failed, rows.length);
    }

    // Relê a lista (não prepend): 50 mil linhas no store por `setContacts` travava a aba.
    await useDbStore.getState().reload();

    return { inserted, failed, error: firstError };
  },
};
