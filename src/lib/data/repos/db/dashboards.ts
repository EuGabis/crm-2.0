"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { createClient } from "@/lib/supabase/client";
import { useDbStore } from "./contacts";
import type { WidgetConfig } from "@/components/dashboard/widget-catalog";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Painéis de controle (migração 0037), em dois escopos:
 *
 *   * "user"       — pessoal; só o dono lê e edita.
 *   * "department" — montado pelo admin para um departamento; todo mundo do
 *                    departamento lê, só admin edita.
 *
 * A RLS é a fronteira (migração 0052: painel pessoal só o dono lê; admin lê
 * todos os de departamento, porque é ele quem os monta). O filtro por dono
 * abaixo é uma SEGUNDA barreira, no client: enquanto a policy da 0037 esteve no
 * ar, o admin recebia o painel pessoal dos colegas, a tela adotava o primeiro
 * como se fosse o dele e salvar respondia "sem permissão para editar este
 * painel" — o erro não era de permissão, era o painel errado na tela. Um
 * ambiente com a migração atrasada não deve reviver isso.
 */

export type DashboardScope = "user" | "department";

export interface DashboardView {
  id: string;
  scope: DashboardScope;
  userId: string | null;
  departmentId: string | null;
  name: string;
  widgets: WidgetConfig[];
  isDefault: boolean;
  createdAt: string;
}

function mapRow(r: any): DashboardView {
  return {
    id: r.id,
    scope: (r.scope ?? "user") as DashboardScope,
    userId: r.user_id ?? null,
    departmentId: r.department_id ?? null,
    name: r.name,
    widgets: Array.isArray(r.widgets) ? (r.widgets as WidgetConfig[]) : [],
    isDefault: !!r.is_default,
    createdAt: r.created_at,
  };
}

interface State {
  loaded: boolean;
  loading: boolean;
  views: DashboardView[];
  load: (force?: boolean) => Promise<void>;
  set: (views: DashboardView[]) => void;
}

const useStore = create<State>((setState, get) => ({
  loaded: false,
  loading: false,
  views: [],
  set: (views) => setState({ views }),
  load: async (force = false) => {
    if ((get().loaded && !force) || get().loading) return;
    setState({ loading: true });
    await useDbStore.getState().ensureSession();
    const locationId = useDbStore.getState().locationId;
    if (!locationId) {
      // Não marca `loaded`: cachear vazio antes da empresa chegar prenderia o
      // painel no layout padrão para sempre (mesmo bug de `db/whatsapp.ts`).
      setState({ loading: false });
      return;
    }
    const supabase = createClient();
    const { data, error } = await supabase
      .from("dashboard_views")
      .select("*")
      .eq("location_id", locationId)
      .order("created_at", { ascending: true });
    if (error) {
      setState({ loading: false });
      return;
    }
    const userId = useDbStore.getState().userId;
    const views = (data ?? [])
      .map(mapRow)
      // Painel pessoal que não é meu não é meu, nem para admin.
      .filter((v) => v.scope !== "user" || !v.userId || v.userId === userId);
    setState({ loaded: true, loading: false, views });
  },
}));

export function useDashboardViews() {
  const { views, loaded, load } = useStore();
  const locationId = useDbStore((s) => s.locationId);
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId]);
  return { views, loaded };
}

const loc = () => useDbStore.getState().locationId;
const uid = () => useDbStore.getState().userId;

export const dashboardActions = {
  /** `departmentId` presente = painel do departamento (exige admin na RLS). */
  async create(
    name: string,
    widgets: WidgetConfig[],
    departmentId?: string | null
  ): Promise<DashboardView | null> {
    const locationId = loc();
    const userId = uid();
    if (!locationId || !userId) return null;
    const isDept = !!departmentId;
    const supabase = createClient();
    const { data, error } = await supabase
      .from("dashboard_views")
      .insert({
        location_id: locationId,
        scope: isDept ? "department" : "user",
        user_id: isDept ? null : userId,
        department_id: isDept ? departmentId : null,
        name: name.trim() || (isDept ? "Painel do departamento" : "Meu painel"),
        widgets,
        created_by: userId,
        // O primeiro painel do escopo já nasce padrão — senão o usuário
        // personaliza, recarrega a página e volta pro layout de fábrica sem
        // entender por quê.
        is_default: isDept
          ? !useStore.getState().views.some((v) => v.departmentId === departmentId)
          : // "já tenho painel pessoal?" — contar o dos outros faria o primeiro
            // painel de alguém nascer sem ser padrão, e a pessoa voltaria ao
            // layout de fábrica no F5 seguinte.
            !useStore.getState().views.some((v) => v.scope === "user" && v.userId === userId),
      })
      .select()
      .single();
    if (error || !data) return null;
    const view = mapRow(data);
    useStore.getState().set([...useStore.getState().views, view]);
    return view;
  },

  async setWidgets(id: string, widgets: WidgetConfig[]): Promise<boolean> {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("dashboard_views")
      .update({ widgets, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .maybeSingle();
    // `data` nulo com error nulo = a RLS recusou (não-admin editando painel de
    // departamento). Sem essa checagem a tela mostraria "salvo" e o banco
    // continuaria igual.
    if (error || !data) return false;
    useStore
      .getState()
      .set(useStore.getState().views.map((v) => (v.id === id ? { ...v, widgets } : v)));
    return true;
  },

  async rename(id: string, name: string): Promise<boolean> {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("dashboard_views")
      .update({ name: name.trim(), updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .maybeSingle();
    if (error || !data) return false;
    useStore
      .getState()
      .set(useStore.getState().views.map((v) => (v.id === id ? { ...v, name: name.trim() } : v)));
    return true;
  },

  /**
   * Marca o painel padrão do escopo. Desmarca o anterior ANTES de marcar o
   * novo: os índices únicos parciais da 0037 recusariam dois padrões.
   */
  async setDefault(id: string): Promise<boolean> {
    const locationId = loc();
    const userId = uid();
    if (!locationId || !userId) return false;
    const view = useStore.getState().views.find((v) => v.id === id);
    if (!view) return false;
    const supabase = createClient();
    const clear = supabase
      .from("dashboard_views")
      .update({ is_default: false })
      .eq("location_id", locationId)
      .eq("is_default", true);
    const { error: clearErr } =
      view.scope === "department"
        ? await clear.eq("department_id", view.departmentId)
        : await clear.eq("user_id", userId).eq("scope", "user");
    if (clearErr) return false;
    const { error } = await supabase
      .from("dashboard_views")
      .update({ is_default: true })
      .eq("id", id);
    if (error) return false;
    useStore.getState().set(
      useStore.getState().views.map((v) => {
        const sameScope =
          view.scope === "department"
            ? v.departmentId === view.departmentId
            : v.scope === "user";
        return sameScope ? { ...v, isDefault: v.id === id } : v;
      })
    );
    return true;
  },

  async remove(id: string): Promise<boolean> {
    const supabase = createClient();
    const { error } = await supabase.from("dashboard_views").delete().eq("id", id);
    if (error) return false;
    useStore.getState().set(useStore.getState().views.filter((v) => v.id !== id));
    return true;
  },
};
