"use client";

import { useEffect, useMemo } from "react";
import { create } from "zustand";
import { createClient } from "@/lib/supabase/client";
import { useDbStore } from "./contacts";

/* eslint-disable @typescript-eslint/no-explicit-any */

export type MemberRole = "admin" | "user";

/** Permissões por módulo: chave = slug da rota. */
export type ModulePermissions = Record<string, boolean>;

/**
 * Departamento = segmentação de acesso compartilhada (migração 0033).
 * O `permissions` dele é a BASE; `location_members.permissions` guarda só as
 * exceções de cada pessoa.
 */
export interface Department {
  id: string;
  name: string;
  description: string;
  permissions: ModulePermissions;
  /**
   * Números de WhatsApp que o departamento atende (migração 0035).
   * Vazio = sem restrição: vê conversa de qualquer número.
   */
  channelIds: string[];
  /** Atendentes (user_ids) no rodízio de distribuição de leads. Vazio = todos do depto. */
  leadPool: string[];
  createdAt: string;
}

export interface TeamMember {
  userId: string;
  name: string;
  email: string;
  color: string;
  role: MemberRole;
  onlyAssigned: boolean;
  /** Só as exceções ao departamento. Vazio = segue o departamento à risca. */
  permissions: ModulePermissions;
  departmentId: string | null;
  createdAt: string;
}

export interface Invitation {
  id: string;
  email: string;
  role: MemberRole;
  onlyAssigned: boolean;
  permissions: ModulePermissions;
  departmentId: string | null;
  status: "pending" | "accepted" | "revoked";
  createdAt: string;
}

/**
 * Acesso efetivo a um módulo. A ordem é a decidida com o Gabriel:
 * admin vê tudo → exceção individual → departamento → libera (legado).
 */
export function canAccess(
  moduleKey: string,
  member: Pick<TeamMember, "role" | "permissions" | "departmentId"> | null,
  departments: Department[]
): boolean {
  if (!member) return true;
  if (member.role === "admin") return true;
  const own = member.permissions?.[moduleKey];
  if (typeof own === "boolean") return own;
  const dep = departments.find((d) => d.id === member.departmentId);
  const fromDep = dep?.permissions?.[moduleKey];
  if (typeof fromDep === "boolean") return fromDep;
  return true;
}

/** Mapa de acesso efetivo de um membro, módulo a módulo. */
export function effectivePermissions(
  member: Pick<TeamMember, "role" | "permissions" | "departmentId">,
  departments: Department[],
  moduleKeys: string[]
): ModulePermissions {
  return Object.fromEntries(
    moduleKeys.map((k) => [k, canAccess(k, member, departments)])
  );
}

const mapInvite = (r: any): Invitation => ({
  id: r.id,
  email: r.email,
  role: r.role,
  onlyAssigned: r.only_assigned,
  permissions: r.permissions ?? {},
  departmentId: r.department_id ?? null,
  status: r.status,
  createdAt: r.created_at,
});

const mapDepartment = (r: any, channelIds: string[] = []): Department => ({
  id: r.id,
  name: r.name,
  description: r.description ?? "",
  permissions: r.permissions ?? {},
  channelIds,
  leadPool: r.lead_pool ?? [],
  createdAt: r.created_at,
});

interface TeamState {
  loaded: boolean;
  loading: boolean;
  members: TeamMember[];
  invitations: Invitation[];
  departments: Department[];
  load: (force?: boolean) => Promise<void>;
  patch: (p: Partial<Pick<TeamState, "members" | "invitations" | "departments">>) => void;
}

export const useTeamStore = create<TeamState>((set, get) => ({
  loaded: false,
  loading: false,
  members: [],
  invitations: [],
  departments: [],

  load: async (force = false) => {
    if ((get().loaded && !force) || get().loading) return;
    set({ loading: true });
    await useDbStore.getState().load();
    const locationId = useDbStore.getState().locationId;
    if (!locationId) {
      set({ loading: false, loaded: true });
      return;
    }
    const supabase = createClient();
    const [memberships, profiles, invites, departments, depChannels] = await Promise.all([
      supabase.from("location_members").select("*").eq("location_id", locationId),
      supabase.from("profiles").select("*"),
      supabase
        .from("invitations")
        .select("*")
        .eq("location_id", locationId)
        .order("created_at", { ascending: false }),
      supabase
        .from("departments")
        .select("*")
        .eq("location_id", locationId)
        .order("name"),
      supabase
        .from("department_channels")
        .select("department_id, channel_id")
        .eq("location_id", locationId),
    ]);

    const channelsByDep = new Map<string, string[]>();
    for (const row of (depChannels.data ?? []) as any[]) {
      const list = channelsByDep.get(row.department_id) ?? [];
      list.push(row.channel_id);
      channelsByDep.set(row.department_id, list);
    }

    const profileById = new Map((profiles.data ?? []).map((p: any) => [p.id, p]));
    const members: TeamMember[] = (memberships.data ?? []).map((m: any) => {
      const p = profileById.get(m.user_id);
      return {
        userId: m.user_id,
        name: p?.name ?? "Usuário",
        email: p?.email ?? "",
        color: p?.color ?? "#6366f1",
        role: m.role,
        onlyAssigned: m.only_assigned,
        permissions: m.permissions ?? {},
        departmentId: m.department_id ?? null,
        createdAt: m.created_at,
      };
    });

    set({
      loaded: true,
      loading: false,
      members: members.sort((a, b) => a.name.localeCompare(b.name)),
      invitations: (invites.data ?? []).map(mapInvite),
      departments: (departments.data ?? []).map((d: any) =>
        mapDepartment(d, channelsByDep.get(d.id) ?? [])
      ),
    });
  },

  patch: (p) => set(p),
}));

export function useTeam() {
  const store = useTeamStore();
  useEffect(() => {
    void store.load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return store;
}

/** Departamentos da empresa (segmentações de acesso). */
export function useDepartments() {
  const { departments, load } = useTeamStore();
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return departments;
}

/** Membership do usuário logado (papel e permissões efetivas). */
export function useMyMembership() {
  const { members, departments, loaded, load } = useTeamStore();
  const userId = useDbStore((s) => s.userId);
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return useMemo(() => {
    const me = members.find((m) => m.userId === userId) ?? null;
    return {
      loaded,
      me,
      isAdmin: me?.role === "admin",
      department: departments.find((d) => d.id === me?.departmentId) ?? null,
      /** Admin → exceção individual → departamento → libera. */
      can: (moduleKey: string) => canAccess(moduleKey, me, departments),
    };
  }, [members, departments, userId, loaded]);
}

const locationId = () => useDbStore.getState().locationId;

async function reload() {
  await useTeamStore.getState().load(true);
}

/** Substitui os números do departamento (apaga e regrava — a lista é pequena). */
async function syncChannels(
  departmentId: string,
  channelIds: string[],
  loc: string
): Promise<void> {
  const supabase = createClient();
  await supabase.from("department_channels").delete().eq("department_id", departmentId);
  if (channelIds.length === 0) return;
  await supabase.from("department_channels").insert(
    channelIds.map((channel_id) => ({
      department_id: departmentId,
      channel_id,
      location_id: loc,
    }))
  );
}

export const departmentActions = {
  async create(input: {
    name: string;
    description: string;
    permissions: ModulePermissions;
    channelIds?: string[];
    leadPool?: string[];
  }): Promise<{ ok: boolean; error?: string }> {
    const loc = locationId();
    if (!loc) return { ok: false, error: "Empresa não encontrada" };
    const supabase = createClient();
    const { data: auth } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from("departments")
      .insert({
        location_id: loc,
        name: input.name.trim(),
        description: input.description.trim(),
        permissions: input.permissions,
        lead_pool: input.leadPool ?? [],
        created_by: auth.user?.id ?? null,
      })
      .select()
      .single();
    if (error || !data) {
      return {
        ok: false,
        error: error?.code === "23505" ? "Já existe um departamento com esse nome" : "Não foi possível criar",
      };
    }
    const channelIds = input.channelIds ?? [];
    if (channelIds.length > 0) await syncChannels(data.id, channelIds, loc);
    const s = useTeamStore.getState();
    s.patch({
      departments: [...s.departments, mapDepartment(data, channelIds)].sort((a, b) =>
        a.name.localeCompare(b.name)
      ),
    });
    return { ok: true };
  },

  async update(
    id: string,
    patch: {
      name?: string;
      description?: string;
      permissions?: ModulePermissions;
      channelIds?: string[];
      leadPool?: string[];
    }
  ): Promise<{ ok: boolean; error?: string }> {
    const loc = locationId();
    if (!loc) return { ok: false, error: "Empresa não encontrada" };
    const row: Record<string, unknown> = {};
    if (patch.name !== undefined) row.name = patch.name.trim();
    if (patch.description !== undefined) row.description = patch.description.trim();
    if (patch.permissions !== undefined) row.permissions = patch.permissions;
    if (patch.leadPool !== undefined) row.lead_pool = patch.leadPool;
    const supabase = createClient();
    const { data, error } = await supabase
      .from("departments")
      .update(row)
      .eq("id", id)
      .select()
      .single();
    if (error || !data) {
      return {
        ok: false,
        error: error?.code === "23505" ? "Já existe um departamento com esse nome" : "Não foi possível salvar",
      };
    }
    const s = useTeamStore.getState();
    const current = s.departments.find((d) => d.id === id)?.channelIds ?? [];
    const channelIds = patch.channelIds ?? current;
    if (patch.channelIds !== undefined) await syncChannels(id, patch.channelIds, loc);
    s.patch({
      departments: s.departments
        .map((d) => (d.id === id ? mapDepartment(data, channelIds) : d))
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
    return { ok: true };
  },

  /** Excluir não derruba ninguém: quem estava nele fica sem departamento. */
  async remove(id: string): Promise<{ ok: boolean; error?: string }> {
    const supabase = createClient();
    const { error } = await supabase.from("departments").delete().eq("id", id);
    if (error) return { ok: false, error: "Não foi possível excluir" };
    const s = useTeamStore.getState();
    s.patch({
      departments: s.departments.filter((d) => d.id !== id),
      members: s.members.map((m) =>
        m.departmentId === id ? { ...m, departmentId: null } : m
      ),
    });
    return { ok: true };
  },
};

export const teamActions = {
  /**
   * Cria o convite e dispara o e-mail personalizado (rota /api/team/invite,
   * que valida a sessão e a permissão de admin no servidor).
   */
  async invite(input: {
    email: string;
    role: MemberRole;
    onlyAssigned: boolean;
    permissions: ModulePermissions;
    departmentId?: string | null;
  }): Promise<{ ok: boolean; error?: string; warning?: string }> {
    const email = input.email.trim().toLowerCase();
    const state = useTeamStore.getState();
    if (state.members.some((m) => m.email.toLowerCase() === email)) {
      return { ok: false, error: "Esta pessoa já faz parte da equipe" };
    }

    let payload: { invite?: unknown; error?: string; warning?: string };
    try {
      const res = await fetch("/api/team/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          role: input.role,
          onlyAssigned: input.onlyAssigned,
          permissions: input.permissions,
          departmentId: input.departmentId ?? null,
        }),
      });
      payload = await res.json();
      if (!res.ok) {
        return { ok: false, error: payload.error ?? "Não foi possível criar o convite" };
      }
    } catch {
      return { ok: false, error: "Falha de conexão ao criar o convite" };
    }

    if (payload.invite) {
      state.patch({ invitations: [mapInvite(payload.invite), ...state.invitations] });
    }
    return { ok: true, warning: payload.warning };
  },

  async revokeInvite(id: string): Promise<boolean> {
    const supabase = createClient();
    const { error } = await supabase
      .from("invitations")
      .update({ status: "revoked" })
      .eq("id", id);
    if (error) return false;
    const s = useTeamStore.getState();
    s.patch({
      invitations: s.invitations.map((i) => (i.id === id ? { ...i, status: "revoked" } : i)),
    });
    return true;
  },

  async deleteInvite(id: string): Promise<boolean> {
    const supabase = createClient();
    const { error } = await supabase.from("invitations").delete().eq("id", id);
    if (error) return false;
    const s = useTeamStore.getState();
    s.patch({ invitations: s.invitations.filter((i) => i.id !== id) });
    return true;
  },

  async updateMember(
    userId: string,
    patch: {
      role?: MemberRole;
      onlyAssigned?: boolean;
      permissions?: ModulePermissions;
      departmentId?: string | null;
    }
  ): Promise<{ ok: boolean; error?: string }> {
    const loc = locationId();
    if (!loc) return { ok: false, error: "Empresa não encontrada" };
    const row: Record<string, unknown> = {};
    if (patch.role !== undefined) row.role = patch.role;
    if (patch.onlyAssigned !== undefined) row.only_assigned = patch.onlyAssigned;
    if (patch.permissions !== undefined) row.permissions = patch.permissions;
    if (patch.departmentId !== undefined) row.department_id = patch.departmentId;

    const supabase = createClient();
    const { error } = await supabase
      .from("location_members")
      .update(row)
      .eq("location_id", loc)
      .eq("user_id", userId);
    if (error) {
      // O banco protege o último administrador
      return {
        ok: false,
        error: error.message.includes("pelo menos um administrador")
          ? "A empresa precisa de pelo menos um administrador"
          : "Não foi possível salvar as alterações",
      };
    }
    const s = useTeamStore.getState();
    s.patch({
      members: s.members.map((m) =>
        m.userId === userId
          ? {
              ...m,
              role: patch.role ?? m.role,
              onlyAssigned: patch.onlyAssigned ?? m.onlyAssigned,
              permissions: patch.permissions ?? m.permissions,
              departmentId:
                patch.departmentId !== undefined ? patch.departmentId : m.departmentId,
            }
          : m
      ),
    });
    return { ok: true };
  },

  async removeMember(userId: string): Promise<{ ok: boolean; error?: string }> {
    const loc = locationId();
    if (!loc) return { ok: false, error: "Empresa não encontrada" };
    if (userId === useDbStore.getState().userId) {
      return { ok: false, error: "Você não pode remover a si mesmo" };
    }
    const supabase = createClient();
    const { error } = await supabase
      .from("location_members")
      .delete()
      .eq("location_id", loc)
      .eq("user_id", userId);
    if (error) {
      return {
        ok: false,
        error: error.message.includes("pelo menos um administrador")
          ? "A empresa precisa de pelo menos um administrador"
          : "Não foi possível remover o usuário",
      };
    }
    const s = useTeamStore.getState();
    s.patch({ members: s.members.filter((m) => m.userId !== userId) });
    return { ok: true };
  },

  reload,
};
