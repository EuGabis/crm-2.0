"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { createClient } from "@/lib/supabase/client";
import type { Opportunity, Pipeline, PipelineScope, Stage } from "@/lib/data/types";
import { useDbStore } from "./contacts";
import { logBulk } from "./contacts-module";

/* eslint-disable @typescript-eslint/no-explicit-any */

const mapStage = (r: any): Stage => ({
  id: r.id,
  name: r.name,
  color: r.color,
  order: r.position,
});

const mapOpportunity = (r: any): Opportunity => ({
  id: r.id,
  contactId: r.contact_id,
  pipelineId: r.pipeline_id,
  stageId: r.stage_id,
  name: r.name,
  source: r.source,
  value: Number(r.value),
  ownerId: r.owner_id ?? undefined,
  status: r.status,
  createdAt: r.created_at,
});

/** Deduz o status a partir do nome da fase (ganho/perda). */
function statusForStage(stage: Stage | undefined): Opportunity["status"] {
  const n = (stage?.name ?? "").toUpperCase();
  if (n.includes("PERDID")) return "lost";
  if (n.includes("ASSINOU") || n.includes("GANHO") || n.includes("GANHA")) return "won";
  return "open";
}

interface PipelineDbState {
  loaded: boolean;
  loading: boolean;
  pipelines: Pipeline[];
  opportunities: Opportunity[];
  load: () => Promise<void>;
  reload: () => Promise<void>;
  patch: (p: Partial<Pick<PipelineDbState, "pipelines" | "opportunities">>) => void;
}

/**
 * Busca pipelines + fases + oportunidades e devolve o formato da store.
 * Separado do `load` para que `reload` reaproveite exatamente a mesma leitura —
 * duas consultas paralelas divergindo seria a origem de bug silencioso.
 */
async function fetchPipelineState(): Promise<
  Pick<PipelineDbState, "pipelines" | "opportunities"> | null
> {
  const supabase = createClient();
  const [pipes, stages, opps] = await Promise.all([
    supabase.from("pipelines").select("*").order("position").order("created_at"),
    supabase.from("stages").select("*").order("position"),
    supabase.from("opportunities").select("*").order("created_at", { ascending: false }),
  ]);
  if (pipes.error || stages.error || opps.error) return null;
  const stagesByPipe = new Map<string, Stage[]>();
  (stages.data ?? []).forEach((r: any) => {
    const list = stagesByPipe.get(r.pipeline_id) ?? [];
    list.push(mapStage(r));
    stagesByPipe.set(r.pipeline_id, list);
  });
  return {
    pipelines: (pipes.data ?? []).map((p: any) => ({
      id: p.id,
      name: p.name,
      stages: stagesByPipe.get(p.id) ?? [],
      // Colunas da 0039. `?? "empresa"` cobre o intervalo entre subir o código
      // e aplicar a migração: sem elas, tudo é da empresa (como era antes).
      scope: (p.scope ?? "empresa") as PipelineScope,
      departmentId: p.department_id ?? null,
      ownerId: p.owner_id ?? null,
    })),
    opportunities: (opps.data ?? []).map(mapOpportunity),
  };
}

export const usePipelineDbStore = create<PipelineDbState>((set, get) => ({
  loaded: false,
  loading: false,
  pipelines: [],
  opportunities: [],

  load: async () => {
    if (get().loaded || get().loading) return;
    set({ loading: true });
    await useDbStore.getState().ensureSession();
    const data = await fetchPipelineState();
    set(data ? { ...data, loaded: true, loading: false } : { loading: false });
  },

  /**
   * Relê tudo SEM piscar a tela: não mexe em `loading` nem em `loaded`, então
   * nenhum componente volta para o "Carregando...". Usado quando o usuário
   * troca de página (ver `components/layout/route-revalidator.tsx`) — o card que
   * o bot criou depois do primeiro carregamento aparecia só com F5.
   */
  reload: async () => {
    await useDbStore.getState().ensureSession();
    const data = await fetchPipelineState();
    // Falha de rede não pode esvaziar o funil que já está na tela.
    if (data) set(data);
  },

  patch: (p) => set(p),
}));

export function usePipelineDb() {
  const store = usePipelineDbStore();
  useEffect(() => {
    void store.load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return store;
}

const loc = () => useDbStore.getState().locationId;
const uid = () => useDbStore.getState().userId;
const state = () => usePipelineDbStore.getState();

/** Pipelines reais (carrega on-demand). */
export function useDbPipelines(): Pipeline[] {
  return usePipelineDb().pipelines;
}

/** Oportunidades reais (carrega on-demand). */
export function useDbOpportunities(): Opportunity[] {
  return usePipelineDb().opportunities;
}

/** Resolve um pipeline por id; ""/"all"/id inexistente caem no primeiro. */
export function useDbPipeline(id: string): Pipeline | null {
  const { pipelines } = usePipelineDb();
  if (id && id !== "all") {
    const found = pipelines.find((p) => p.id === id);
    if (found) return found;
  }
  return pipelines[0] ?? null;
}

export const oppActions = {
  async move(id: string, stageId: string): Promise<boolean> {
    const s = state();
    const stage = s.pipelines.flatMap((p) => p.stages).find((st) => st.id === stageId);
    const status = statusForStage(stage);
    const supabase = createClient();
    const { error } = await supabase
      .from("opportunities")
      .update({ stage_id: stageId, status })
      .eq("id", id);
    if (error) return false;
    s.patch({
      opportunities: s.opportunities.map((o) => (o.id === id ? { ...o, stageId, status } : o)),
    });
    return true;
  },

  /** Define/troca o responsável (owner_id) de uma oportunidade. null = sem dono. */
  async assign(id: string, ownerId: string | null): Promise<boolean> {
    const s = state();
    const supabase = createClient();
    const { error } = await supabase
      .from("opportunities")
      .update({ owner_id: ownerId })
      .eq("id", id);
    if (error) return false;
    s.patch({
      opportunities: s.opportunities.map((o) =>
        o.id === id ? { ...o, ownerId: ownerId ?? undefined } : o
      ),
    });
    return true;
  },

  async moveMany(ids: string[], stageId: string): Promise<boolean> {
    const s = state();
    const stage = s.pipelines.flatMap((p) => p.stages).find((st) => st.id === stageId);
    const status = statusForStage(stage);
    const supabase = createClient();
    const { error } = await supabase
      .from("opportunities")
      .update({ stage_id: stageId, status })
      .in("id", ids);
    if (error) return false;
    s.patch({
      opportunities: s.opportunities.map((o) =>
        ids.includes(o.id) ? { ...o, stageId, status } : o
      ),
    });
    void logBulk(`Mover ${ids.length} lead(s) para "${stage?.name ?? "fase"}"`, ids.length);
    return true;
  },

  async add(input: {
    contactId: string;
    contactName: string;
    pipelineId: string;
    stageId: string;
    value: number;
    source: string;
    // Dono do card. Quando vem da conversa, é o RESPONSÁVEL dela (não quem
    // clicou): um admin criando o card na conversa do Paulo cria PARA o Paulo.
    // `null` = grupo (sem dono). Ausente = padrão (quem criou, via `uid()`).
    ownerId?: string | null;
  }): Promise<boolean> {
    const location = loc();
    if (!location) return false;
    const supabase = createClient();
    const { data, error } = await supabase
      .from("opportunities")
      .insert({
        location_id: location,
        contact_id: input.contactId,
        pipeline_id: input.pipelineId,
        stage_id: input.stageId,
        name: input.contactName,
        source: input.source,
        value: input.value,
        owner_id: input.ownerId !== undefined ? input.ownerId : uid(),
      })
      .select()
      .single();
    if (error || !data) return false;
    const s = state();
    s.patch({ opportunities: [mapOpportunity(data), ...s.opportunities] });
    return true;
  },

  async remove(ids: string[]): Promise<boolean> {
    const supabase = createClient();
    const { error } = await supabase.from("opportunities").delete().in("id", ids);
    if (error) return false;
    const s = state();
    s.patch({ opportunities: s.opportunities.filter((o) => !ids.includes(o.id)) });
    if (ids.length > 1) void logBulk("Excluir oportunidades", ids.length);
    return true;
  },
};

export const pipelineActions = {
  /**
   * Cria um pipeline com escopo (0039). Usuário comum só consegue criar
   * `scope: "user"` com ele mesmo de dono — a RLS recusa o resto, então aqui
   * não há checagem duplicada de papel: quem manda é o banco.
   */
  async addPipeline(
    name: string,
    visibility: { scope: PipelineScope; departmentId?: string | null; ownerId?: string | null } = {
      scope: "user",
    }
  ): Promise<boolean> {
    const location = loc();
    if (!location) return false;
    const supabase = createClient();
    const { data, error } = await supabase
      .from("pipelines")
      .insert({
        location_id: location,
        name,
        position: state().pipelines.length,
        scope: visibility.scope,
        department_id: visibility.scope === "department" ? visibility.departmentId : null,
        owner_id:
          visibility.scope === "user" ? (visibility.ownerId ?? uid()) : null,
        created_by: uid(),
      })
      .select()
      .single();
    if (error || !data) return false;
    const s = state();
    s.patch({
      pipelines: [
        ...s.pipelines,
        {
          id: data.id,
          name: data.name,
          stages: [],
          scope: data.scope ?? "empresa",
          departmentId: data.department_id ?? null,
          ownerId: data.owner_id ?? null,
        },
      ],
    });
    return true;
  },

  /** Troca o escopo (só admin — a RLS recusa para os demais). */
  async setPipelineScope(
    id: string,
    visibility: { scope: PipelineScope; departmentId?: string | null; ownerId?: string | null }
  ): Promise<boolean> {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("pipelines")
      .update({
        scope: visibility.scope,
        department_id: visibility.scope === "department" ? visibility.departmentId : null,
        owner_id: visibility.scope === "user" ? visibility.ownerId : null,
      })
      .eq("id", id)
      .select()
      .maybeSingle();
    // `data` nulo sem erro = RLS recusou. Sem checar, a tela diria "salvo".
    if (error || !data) return false;
    const s = state();
    s.patch({
      pipelines: s.pipelines.map((p) =>
        p.id === id
          ? {
              ...p,
              scope: data.scope,
              departmentId: data.department_id ?? null,
              ownerId: data.owner_id ?? null,
            }
          : p
      ),
    });
    return true;
  },

  async renamePipeline(id: string, name: string): Promise<boolean> {
    const supabase = createClient();
    const { error } = await supabase.from("pipelines").update({ name }).eq("id", id);
    if (error) return false;
    const s = state();
    s.patch({ pipelines: s.pipelines.map((p) => (p.id === id ? { ...p, name } : p)) });
    return true;
  },

  async removePipeline(id: string): Promise<"ok" | "has-opps" | "error"> {
    const s = state();
    if (s.opportunities.some((o) => o.pipelineId === id)) return "has-opps";
    const supabase = createClient();
    const { error } = await supabase.from("pipelines").delete().eq("id", id);
    if (error) return "error";
    s.patch({ pipelines: s.pipelines.filter((p) => p.id !== id) });
    return "ok";
  },

  async addStage(pipelineId: string, name: string, color: string): Promise<boolean> {
    const location = loc();
    if (!location) return false;
    const s = state();
    const pipe = s.pipelines.find((p) => p.id === pipelineId);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("stages")
      .insert({
        location_id: location,
        pipeline_id: pipelineId,
        name,
        color,
        position: pipe?.stages.length ?? 0,
      })
      .select()
      .single();
    if (error || !data) return false;
    s.patch({
      pipelines: s.pipelines.map((p) =>
        p.id === pipelineId ? { ...p, stages: [...p.stages, mapStage(data)] } : p
      ),
    });
    return true;
  },

  async renameStage(id: string, name: string): Promise<boolean> {
    const supabase = createClient();
    const { error } = await supabase.from("stages").update({ name }).eq("id", id);
    if (error) return false;
    const s = state();
    s.patch({
      pipelines: s.pipelines.map((p) => ({
        ...p,
        stages: p.stages.map((st) => (st.id === id ? { ...st, name } : st)),
      })),
    });
    return true;
  },

  async removeStage(id: string): Promise<"ok" | "has-opps" | "error"> {
    const s = state();
    if (s.opportunities.some((o) => o.stageId === id)) return "has-opps";
    const supabase = createClient();
    const { error } = await supabase.from("stages").delete().eq("id", id);
    if (error) return "error";
    s.patch({
      pipelines: s.pipelines.map((p) => ({
        ...p,
        stages: p.stages.filter((st) => st.id !== id),
      })),
    });
    return "ok";
  },
};
