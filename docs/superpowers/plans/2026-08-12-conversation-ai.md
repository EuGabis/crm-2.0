# Conversation AI (Agentes de IA) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar a aba Agentes de IA → Conversation AI funcional: agentes reais (personalidade/meta/infos/modelo/status) por empresa e o painel "Testar seu bot" conversando de verdade com a OpenAI (via a fundação de IA).

**Architecture:** `ai_agents` (config dos agentes). Rota autenticada `POST /api/ai/chat` carrega o agente, monta o system prompt (personalidade+meta+infos), chama `lib/ai/openai.chat` com o histórico e grava `ai_logs`. Repo `db/ai-agents.ts` é a fronteira; a aba Conversation AI vira um componente real.

**Tech Stack:** Next.js (App Router) · TypeScript · Supabase (RLS) · OpenAI (via a fundação `src/lib/ai/openai.ts`).

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-12-conversation-ai-design.md`. Convenções: `AGENTS.md`. Depende da Fundação de IA (`src/lib/ai/openai.ts`, `ai_logs`, `OPENAI_API_KEY`).
- **Migração livre = `0027`** → `supabase/migrations/0027_ai_agents.sql`. Idempotente. ⚠️ O outro Claude pode pegar `0027` — reconciliar no merge (renumerar como foi feito: 0020→0022).
- **Migrações aplicadas pelo Gabriel** no SQL Editor (o worker NÃO aplica).
- **Sem runner de testes:** verificação = `npx tsc --noEmit` **e** `npm run build` limpos + checagens. Não invente pytest/jest.
- **`OPENAI_API_KEY` server-only** (já existe da fundação); `/api/ai/chat` é AUTENTICADA (fica no matcher normal do `proxy.ts` — NÃO alterar). Nenhuma env nova.
- **Multi-tenant:** `ai_agents` tem `location_id` + RLS membership (`location_id in (select private.user_locations())`) + `revoke ... from anon`. O agente é carregado pela sessão (RLS) — não dá pra testar agente de outra empresa.
- **Base UI, não Radix:** `Select`/`SelectValue` com children explícito; sem `asChild`. Zustand: nunca filtrar/mapear no selector.
- **Texto pt-BR.** Commits `feat(ia): ...`. Branch → PR → squash na `main`. Área do Claude B (UI/IA).

---

## File Structure

**Criar:**
- `supabase/migrations/0027_ai_agents.sql` — tabela `ai_agents` (RLS).
- `src/app/api/ai/chat/route.ts` — POST autenticado: carrega agente, chat com histórico, log.
- `src/lib/data/repos/db/ai-agents.ts` — repo (CRUD + setPrimary + chat; tipo `AiAgent`).
- `src/components/ai/conversation-ai-tab.tsx` — a aba Conversation AI real (lista + form + teste).

**Modificar:**
- `src/app/(app)/agentes-ia/page.tsx` — trocar o bloco inline `{tab === "Conversation AI" && (...)}` por `<ConversationAiTab />` (remover os mocks `AGENTS`, o estado de `actions`/`chat`/`input`/`sendTest` e imports órfãos que sobrarem).
- `AGENTS.md` — doc + próxima migração livre (Task 5).

---

## Task 1: Migração 0027 (ai_agents)

Cria a tabela dos agentes. Deliverable: SQL pronto pro Gabriel; `tsc`/`build` limpos.

**Files:**
- Create: `supabase/migrations/0027_ai_agents.sql`

**Interfaces:**
- Produces (SQL): `public.ai_agents(id, location_id, name, personality, goal, extra_info, model, status, is_primary, channels text[], actions jsonb, created_at, updated_at)`.

- [ ] **Step 1: Escrever a migração**

Create `supabase/migrations/0027_ai_agents.sql`:

```sql
-- ============================================================
-- Lito CRM — Conversation AI: agentes (ai_agents)
--
-- Config de cada agente de IA por empresa: personalidade (system prompt), meta,
-- informações, modelo, status, principal, canais e flags de ações. O "Testar seu bot"
-- monta o system prompt a partir daqui. Padrão multi-tenant: RLS membership, revoke
-- do anon. Idempotente. "Agente principal" é garantido no app (setPrimary desmarca os outros).
-- ============================================================
set check_function_bodies = off;

create table if not exists public.ai_agents (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations (id) on delete cascade,
  name text not null,
  personality text not null default '',       -- system prompt
  goal text not null default '',
  extra_info text not null default '',
  model text not null default 'gpt-4o-mini',
  status text not null default 'sugestivo' check (status in ('ativo', 'sugestivo', 'desativado')),
  is_primary boolean not null default false,
  channels text[] not null default '{}',
  actions jsonb not null default '{}',         -- { agendamento: true, ... }
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ai_agents_location_idx on public.ai_agents (location_id, created_at desc);

alter table public.ai_agents enable row level security;
revoke all on public.ai_agents from anon;

drop policy if exists "membros leem ai_agents" on public.ai_agents;
create policy "membros leem ai_agents" on public.ai_agents
  for select to authenticated using (location_id in (select private.user_locations()));
drop policy if exists "membros criam ai_agents" on public.ai_agents;
create policy "membros criam ai_agents" on public.ai_agents
  for insert to authenticated with check (location_id in (select private.user_locations()));
drop policy if exists "membros editam ai_agents" on public.ai_agents;
create policy "membros editam ai_agents" on public.ai_agents
  for update to authenticated
  using (location_id in (select private.user_locations()))
  with check (location_id in (select private.user_locations()));
drop policy if exists "membros excluem ai_agents" on public.ai_agents;
create policy "membros excluem ai_agents" on public.ai_agents
  for delete to authenticated using (location_id in (select private.user_locations()));

drop trigger if exists ai_agents_updated_at on public.ai_agents;
create trigger ai_agents_updated_at before update on public.ai_agents
  for each row execute function private.set_updated_at();
```

- [ ] **Step 2: Aplicação (Gabriel)**

Pedir ao Gabriel para rodar `supabase/migrations/0027_ai_agents.sql` no SQL Editor. (O worker não aplica.)

- [ ] **Step 3: Verificar build**

Run: `npx tsc --noEmit && npm run build`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0027_ai_agents.sql
git commit -m "feat(ia): migração 0027 (ai_agents)"
```

---

## Task 2: Rota `/api/ai/chat`

Rota autenticada que conversa com o agente (system a partir do agente + histórico). Deliverable: build limpo; sem sessão → 401; sem chave → 503.

**Files:**
- Create: `src/app/api/ai/chat/route.ts`

**Interfaces:**
- Consumes: `chat` de `@/lib/ai/openai`; `createClient` de `@/lib/supabase/server`; tabela `ai_agents` (Task 1) e `ai_logs` (fundação).
- Produces (contrato HTTP consumido pelo repo na Task 3): `POST /api/ai/chat` body `{ agentId, messages: { role:"user"|"assistant"; content:string }[] }` → `200 { text, usage: { promptTokens, completionTokens } }` | `401` | `503 { error }` | `400 { error }` | `404 { error }` | `502 { error }`.

- [ ] **Step 1: Escrever a rota**

Create `src/app/api/ai/chat/route.ts`:

```ts
import { createClient } from "@/lib/supabase/server";
import { chat } from "@/lib/ai/openai";

/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Não autenticado" }, { status: 401 });
  if (!process.env.OPENAI_API_KEY) {
    return Response.json({ error: "IA não configurada (OPENAI_API_KEY ausente)" }, { status: 503 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "payload inválido" }, { status: 400 });
  }
  const agentId = body?.agentId;
  const rawMessages: any[] = Array.isArray(body?.messages) ? body.messages : [];
  if (rawMessages.length === 0) return Response.json({ error: "Sem mensagens" }, { status: 400 });

  const { data: agent } = await supabase
    .from("ai_agents")
    .select("*")
    .eq("id", agentId)
    .maybeSingle();
  if (!agent) return Response.json({ error: "Agente não encontrado" }, { status: 404 });

  const parts = [
    agent.personality,
    agent.goal ? `Objetivo: ${agent.goal}` : "",
    agent.extra_info ? `Informações: ${agent.extra_info}` : "",
  ].filter((p: string) => p && p.trim());
  const system = parts.join("\n\n") || "Você é um assistente prestativo.";

  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: system },
    ...rawMessages.map((m) => ({
      role: m?.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: String(m?.content ?? ""),
    })),
  ];

  let result;
  try {
    result = await chat(messages, { model: agent.model });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Falha na OpenAI" },
      { status: 502 },
    );
  }

  const lastUser = [...rawMessages].reverse().find((m) => m?.role !== "assistant");
  await supabase.from("ai_logs").insert({
    location_id: agent.location_id,
    feature: "agent-test",
    model: agent.model,
    prompt: String(lastUser?.content ?? ""),
    response: result.text,
    prompt_tokens: result.usage.promptTokens,
    completion_tokens: result.usage.completionTokens,
    created_by: user.id,
  });

  return Response.json({ text: result.text, usage: result.usage });
}
```

> Nota: `ai_logs.location_id` usa `agent.location_id` (o agente já é da empresa do usuário via
> RLS), então o log fica na empresa certa sem precisar reconsultar `location_members`.

- [ ] **Step 2: Verificar build + auth gate**

Run: `npx tsc --noEmit && npm run build`
Expected: sem erros; rota `/api/ai/chat` no manifesto.

Estático (com `npm run dev`, sem login): `curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/api/ai/chat -H "Content-Type: application/json" -d '{"agentId":"x","messages":[{"role":"user","content":"oi"}]}'` → 401. Uma tentativa; gate = tsc+build.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/ai/chat/route.ts"
git commit -m "feat(ia): rota /api/ai/chat (agente + histórico → OpenAI, grava log)"
```

---

## Task 3: Repo `db/ai-agents.ts`

Fronteira que a UI usa: CRUD de agentes + setPrimary + chat. Deliverable: build limpo; exports batendo com a UI da Task 4.

**Files:**
- Create: `src/lib/data/repos/db/ai-agents.ts`

**Interfaces:**
- Consumes: `createClient` de `@/lib/supabase/client`; `useDbStore` de `./contacts`; contrato HTTP da Task 2.
- Produces:
  - type `AiAgent = { id: string; name: string; personality: string; goal: string; extraInfo: string; model: string; status: "ativo"|"sugestivo"|"desativado"; isPrimary: boolean; channels: string[]; actions: Record<string, boolean> }`
  - `useAiAgents(): { agents: AiAgent[]; ready: boolean }`
  - `aiAgentActions.create(input: { name: string }): Promise<{ ok: boolean; id?: string; error?: string }>`
  - `aiAgentActions.update(id: string, patch: Partial<Pick<AiAgent, "name"|"personality"|"goal"|"extraInfo"|"model"|"status"|"channels"|"actions">>): Promise<boolean>`
  - `aiAgentActions.setPrimary(id: string): Promise<boolean>`
  - `aiAgentActions.remove(id: string): Promise<boolean>`
  - `aiAgentActions.chat(agentId: string, messages: { role: "user"|"assistant"; content: string }[]): Promise<{ ok: boolean; text?: string; error?: string }>`

- [ ] **Step 1: Escrever o repo**

Create `src/lib/data/repos/db/ai-agents.ts`:

```ts
"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { createClient } from "@/lib/supabase/client";
import { useDbStore } from "./contacts";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface AiAgent {
  id: string;
  name: string;
  personality: string;
  goal: string;
  extraInfo: string;
  model: string;
  status: "ativo" | "sugestivo" | "desativado";
  isPrimary: boolean;
  channels: string[];
  actions: Record<string, boolean>;
}

function mapAgent(r: any): AiAgent {
  return {
    id: r.id,
    name: r.name,
    personality: r.personality ?? "",
    goal: r.goal ?? "",
    extraInfo: r.extra_info ?? "",
    model: r.model ?? "gpt-4o-mini",
    status: r.status ?? "sugestivo",
    isPrimary: !!r.is_primary,
    channels: r.channels ?? [],
    actions: r.actions ?? {},
  };
}

interface AgentsState {
  loaded: boolean;
  loading: boolean;
  agents: AiAgent[];
  load: () => Promise<void>;
  set: (agents: AiAgent[]) => void;
}

const useAgentsStore = create<AgentsState>((setState, get) => ({
  loaded: false,
  loading: false,
  agents: [],
  set: (agents) => setState({ agents }),
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
      .from("ai_agents")
      .select("*")
      .eq("location_id", locationId)
      .order("created_at", { ascending: true });
    setState({ loaded: true, loading: false, agents: (data ?? []).map(mapAgent) });
  },
}));

export function useAiAgents() {
  const { agents, loaded, loading, load } = useAgentsStore();
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { agents, ready: loaded && !loading };
}

export const aiAgentActions = {
  async create(input: { name: string }): Promise<{ ok: boolean; id?: string; error?: string }> {
    const locationId = useDbStore.getState().locationId;
    if (!locationId) return { ok: false, error: "Empresa não encontrada" };
    const supabase = createClient();
    const first = useAgentsStore.getState().agents.length === 0;
    const { data, error } = await supabase
      .from("ai_agents")
      .insert({ location_id: locationId, name: input.name.trim(), is_primary: first })
      .select()
      .single();
    if (error || !data) return { ok: false, error: error?.message ?? "Não foi possível criar" };
    const s = useAgentsStore.getState();
    s.set([...s.agents, mapAgent(data)]);
    return { ok: true, id: data.id };
  },

  async update(
    id: string,
    patch: Partial<Pick<AiAgent, "name" | "personality" | "goal" | "extraInfo" | "model" | "status" | "channels" | "actions">>,
  ): Promise<boolean> {
    const supabase = createClient();
    const row: any = {};
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.personality !== undefined) row.personality = patch.personality;
    if (patch.goal !== undefined) row.goal = patch.goal;
    if (patch.extraInfo !== undefined) row.extra_info = patch.extraInfo;
    if (patch.model !== undefined) row.model = patch.model;
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.channels !== undefined) row.channels = patch.channels;
    if (patch.actions !== undefined) row.actions = patch.actions;
    const { data, error } = await supabase.from("ai_agents").update(row).eq("id", id).select().single();
    if (error || !data) return false;
    const s = useAgentsStore.getState();
    s.set(s.agents.map((a) => (a.id === id ? mapAgent(data) : a)));
    return true;
  },

  async setPrimary(id: string): Promise<boolean> {
    const locationId = useDbStore.getState().locationId;
    if (!locationId) return false;
    const supabase = createClient();
    await supabase
      .from("ai_agents")
      .update({ is_primary: false })
      .eq("location_id", locationId)
      .neq("id", id);
    const { error } = await supabase.from("ai_agents").update({ is_primary: true }).eq("id", id);
    if (error) return false;
    const s = useAgentsStore.getState();
    s.set(s.agents.map((a) => ({ ...a, isPrimary: a.id === id })));
    return true;
  },

  async remove(id: string): Promise<boolean> {
    const supabase = createClient();
    const { error } = await supabase.from("ai_agents").delete().eq("id", id);
    if (error) return false;
    const s = useAgentsStore.getState();
    s.set(s.agents.filter((a) => a.id !== id));
    return true;
  },

  async chat(
    agentId: string,
    messages: { role: "user" | "assistant"; content: string }[],
  ): Promise<{ ok: boolean; text?: string; error?: string }> {
    const res = await fetch("/api/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, messages }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: json?.error ?? "Falha ao conversar" };
    return { ok: true, text: json.text };
  },
};
```

- [ ] **Step 2: Verificar build**

Run: `npx tsc --noEmit && npm run build`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add src/lib/data/repos/db/ai-agents.ts
git commit -m "feat(ia): repo db (CRUD de agentes + setPrimary + chat)"
```

---

## Task 4: Aba Conversation AI real (componente + wiring)

Extrai a aba num componente real (lista + form + teste) e liga na página. Deliverable: build limpo + browser: criar agente, salvar, conversar no teste.

**Files:**
- Create: `src/components/ai/conversation-ai-tab.tsx`
- Modify: `src/app/(app)/agentes-ia/page.tsx`

**Interfaces:**
- Consumes: `useAiAgents`, `aiAgentActions`, `AiAgent` de `@/lib/data/repos/db/ai-agents`.

- [ ] **Step 1: Componente da aba**

Create `src/components/ai/conversation-ai-tab.tsx`:

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { Send } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAiAgents, aiAgentActions, type AiAgent } from "@/lib/data/repos/db/ai-agents";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<AiAgent["status"], string> = {
  ativo: "Ativo",
  sugestivo: "Sugestivo",
  desativado: "Desativado",
};
const ACTION_KEYS = [
  "Agendamento de compromissos",
  "Acionar um fluxo de trabalho",
  "Informações de contato",
  "Parar bot",
  "Transferência humana",
  "Follow-up automático",
];

export function ConversationAiTab() {
  const { agents, ready } = useAiAgents();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(
    () => agents.find((a) => a.id === selectedId) ?? agents[0] ?? null,
    [agents, selectedId],
  );

  // form
  const [personality, setPersonality] = useState("");
  const [goal, setGoal] = useState("");
  const [extraInfo, setExtraInfo] = useState("");
  const [model, setModel] = useState("gpt-4o-mini");
  const [status, setStatus] = useState<AiAgent["status"]>("sugestivo");
  const [actions, setActions] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!selected) return;
    setPersonality(selected.personality);
    setGoal(selected.goal);
    setExtraInfo(selected.extraInfo);
    setModel(selected.model);
    setStatus(selected.status);
    setActions(selected.actions ?? {});
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // criar
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const doCreate = async () => {
    if (!newName.trim()) return toast.error("Dê um nome ao agente");
    const res = await aiAgentActions.create({ name: newName.trim() });
    if (res.ok) {
      setSelectedId(res.id ?? null);
      setCreateOpen(false);
      setNewName("");
      toast.success("Agente criado");
    } else toast.error(res.error ?? "Falha ao criar");
  };

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    const ok = await aiAgentActions.update(selected.id, {
      personality,
      goal,
      extraInfo,
      model,
      status,
      actions,
    });
    setSaving(false);
    if (ok) toast.success("Agente salvo");
    else toast.error("Não foi possível salvar");
  };

  // teste
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  useEffect(() => {
    setMessages([]);
  }, [selected?.id]);

  const sendTest = async () => {
    if (!selected) return toast.error("Crie ou selecione um agente");
    const text = input.trim();
    if (!text || sending) return;
    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setInput("");
    setSending(true);
    const res = await aiAgentActions.chat(selected.id, next);
    setSending(false);
    if (res.ok) setMessages([...next, { role: "assistant", content: res.text ?? "" }]);
    else {
      toast.error(res.error ?? "Falha ao responder");
      setMessages(messages); // desfaz a msg do usuário
      setInput(text);
    }
  };

  if (ready && agents.length === 0) {
    return (
      <div className="rounded-xl border bg-white p-8 text-center">
        <p className="text-sm font-semibold text-slate-700">Nenhum agente ainda</p>
        <p className="mt-1 text-xs text-slate-500">Crie um agente de IA e teste a conversa aqui.</p>
        <Button size="sm" className="mt-3 h-8 text-xs" onClick={() => setCreateOpen(true)}>
          + Criar bot
        </Button>
        <CreateDialog open={createOpen} onOpenChange={setCreateOpen} value={newName} onChange={setNewName} onCreate={doCreate} />
      </div>
    );
  }

  return (
    <>
      <h1 className="mb-4 text-lg font-bold text-slate-900">Agentes de Conversation AI</h1>
      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          {/* Lista */}
          <div className="rounded-xl border bg-white">
            <div className="flex items-center justify-between border-b px-4 py-2.5">
              <h2 className="text-sm font-semibold text-slate-700">Lista de agentes</h2>
              <Button size="sm" className="h-7 text-xs" onClick={() => setCreateOpen(true)}>+ Criar bot</Button>
            </div>
            <p className="border-b bg-amber-50 px-4 py-2 text-[11px] text-amber-700">
              Importante: somente o agente principal responde às mensagens recebidas.
            </p>
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b text-[11px] text-slate-400">
                  <th className="px-4 py-2 font-medium">Nome do agente</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((a) => (
                  <tr
                    key={a.id}
                    onClick={() => setSelectedId(a.id)}
                    className={cn("cursor-pointer border-b last:border-0 hover:bg-slate-50", selected?.id === a.id && "bg-indigo-50/60")}
                  >
                    <td className="px-4 py-2.5 font-medium text-slate-800">
                      {a.name}{" "}
                      {a.isPrimary && <Badge className="ml-1 bg-indigo-100 text-[9px] text-indigo-700">Principal</Badge>}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge variant="secondary" className={cn(a.status === "ativo" && "bg-emerald-100 text-emerald-700")}>
                        {STATUS_LABEL[a.status]}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex gap-2 text-[11px]">
                        {!a.isPrimary && (
                          <button
                            onClick={(e) => { e.stopPropagation(); void aiAgentActions.setPrimary(a.id).then((ok) => ok && toast.success("Definido como principal")); }}
                            className="text-indigo-600 hover:underline"
                          >Tornar principal</button>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); void aiAgentActions.remove(a.id).then((ok) => ok && toast.success("Agente excluído")); }}
                          className="text-rose-600 hover:underline"
                        >Excluir</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Form */}
          {selected && (
            <div className="rounded-xl border bg-white p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-700">Metas do bot — {selected.name}</h2>
                <div className="flex items-center gap-2">
                  <Select value={status} onValueChange={(v) => v && setStatus(v as AiAgent["status"])}>
                    <SelectTrigger className="h-7 w-[110px] text-xs" size="sm"><SelectValue>{STATUS_LABEL[status]}</SelectValue></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ativo" className="text-xs">Ativo</SelectItem>
                      <SelectItem value="sugestivo" className="text-xs">Sugestivo</SelectItem>
                      <SelectItem value="desativado" className="text-xs">Desativado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs font-bold">Personalidade</Label>
                  <Textarea value={personality} onChange={(e) => setPersonality(e.target.value)} placeholder="Ex.: Você é a Laura, assistente comercial. Tom simpático e consultivo." className="min-h-16 text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-bold">Meta</Label>
                  <Textarea value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Ex.: Levar o lead até a demonstração." className="min-h-16 text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-bold">Informações adicionais</Label>
                  <Textarea value={extraInfo} onChange={(e) => setExtraInfo(e.target.value)} placeholder="Contexto/produto/preços que o bot deve saber." className="min-h-16 text-xs" />
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-xs font-bold">Modelo</Label>
                  <Input value={model} onChange={(e) => setModel(e.target.value)} className="h-8 w-40 text-xs" />
                </div>
              </div>
              <p className="mt-3 mb-1.5 text-xs font-bold text-slate-700">Configure suas ações</p>
              <div className="flex flex-wrap gap-1.5">
                {ACTION_KEYS.map((label) => (
                  <button
                    key={label}
                    onClick={() => setActions((m) => ({ ...m, [label]: !m[label] }))}
                    className={cn("rounded-full border px-2.5 py-1 text-[11px] font-medium", actions[label] ? "border-indigo-300 bg-indigo-50 text-indigo-700" : "text-slate-500 hover:bg-slate-50")}
                  >{label}</button>
                ))}
              </div>
              <div className="mt-4">
                <Button size="sm" className="h-8 text-xs" onClick={save} disabled={saving}>{saving ? "Salvando..." : "Salvar agente"}</Button>
              </div>
            </div>
          )}
        </div>

        {/* Teste */}
        <div className="flex h-fit flex-col rounded-xl border bg-white">
          <div className="border-b px-4 py-2.5"><h2 className="text-sm font-semibold text-slate-700">Testar seu bot</h2></div>
          <div className="flex max-h-96 min-h-56 flex-col gap-2 overflow-y-auto p-3 [scrollbar-width:thin]">
            {messages.length === 0 && (
              <p className="text-xs text-slate-400">
                {selected ? `Converse com "${selected.name}" para testar.` : "Crie ou selecione um agente."}
              </p>
            )}
            {messages.map((m, i) => (
              <div key={i} className={cn("max-w-[85%] whitespace-pre-wrap rounded-xl px-3 py-1.5 text-xs", m.role === "assistant" ? "self-start bg-slate-100 text-slate-700" : "self-end bg-indigo-500 text-white")}>
                {m.content}
              </div>
            ))}
            {sending && <div className="self-start rounded-xl bg-slate-100 px-3 py-1.5 text-xs text-slate-400">Digitando...</div>}
          </div>
          <div className="flex items-center gap-2 border-t p-2.5">
            <Input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendTest()} placeholder="Enviar uma mensagem" className="h-8 text-xs" disabled={!selected || sending} />
            <Button size="sm" className="size-8 p-0" onClick={sendTest} disabled={!selected || sending}><Send className="size-3.5" /></Button>
          </div>
        </div>
      </div>
      <CreateDialog open={createOpen} onOpenChange={setCreateOpen} value={newName} onChange={setNewName} onCreate={doCreate} />
    </>
  );
}

function CreateDialog({ open, onOpenChange, value, onChange, onCreate }: { open: boolean; onOpenChange: (v: boolean) => void; value: string; onChange: (v: string) => void; onCreate: () => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Novo agente</DialogTitle></DialogHeader>
        <div className="grid gap-1.5">
          <Label className="text-xs">Nome do agente</Label>
          <Input value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onCreate()} placeholder="Ex.: IA Comercial" className="h-8 text-xs" autoFocus />
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button size="sm" className="h-8 text-xs" onClick={onCreate}>Criar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Ligar na página**

In `src/app/(app)/agentes-ia/page.tsx`:
- Add import: `import { ConversationAiTab } from "@/components/ai/conversation-ai-tab";`
- Substituir o bloco inteiro `{tab === "Conversation AI" && ( ... )}` (o `<>...</>` com KPIs mock + lista `AGENTS` + form + teste) por:
  ```tsx
  {tab === "Conversation AI" && <ConversationAiTab />}
  ```
- Remover os mocks/estado que ficarem SÓ desse bloco: a constante `AGENTS`, e o estado local do teste/ações (`chat`, `input`, `sendTest`, `actions`, `setActions` — conferir por busca; se algum for usado por outra aba, deixar). Remover imports órfãos resultantes (ex.: `Send` se não for usado por outra aba). **Não** remova `KpiCard`/`Badge`/`Textarea`/etc. se outras abas usarem. Meta: build limpo, sem símbolo não usado.

- [ ] **Step 3: Verificar build + browser**

Run: `npx tsc --noEmit && npm run build`
Expected: sem erros; sem símbolos não usados.

Browser (se `OPENAI_API_KEY` + migração `0027` estiverem prontos): `/agentes-ia` → Conversation AI → "+ Criar bot" (nome) → preencher Personalidade/Meta → Salvar → no "Testar seu bot", mandar uma mensagem → resposta real coerente. Sem a chave, a resposta dá toast de 503 — esperado. `read_console_messages` sem erros.

- [ ] **Step 4: Commit**

```bash
git add src/components/ai/conversation-ai-tab.tsx "src/app/(app)/agentes-ia/page.tsx"
git commit -m "feat(ia): aba Conversation AI real (agentes + Testar seu bot funcional)"
```

---

## Task 5: Docs

Documenta o módulo. Deliverable: build limpo; `AGENTS.md` atualizado.

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Doc no AGENTS.md**

In `AGENTS.md`, na seção da Fundação de IA (ou logo abaixo), adicionar um parágrafo do Conversation AI e atualizar a nota de "próxima migração livre" para **0028**. Rodar `ls supabase/migrations/` antes; nossa migração é `0027_ai_agents.sql` → se nada maior existir, próxima livre = **0028**. Conteúdo (bater com o código):
- Conversation AI (aba de `/agentes-ia`): agentes reais em `ai_agents` (migração `0027`), componente `src/components/ai/conversation-ai-tab.tsx`, repo `src/lib/data/repos/db/ai-agents.ts`. O "Testar seu bot" usa `POST /api/ai/chat` (monta o system prompt do agente + histórico → OpenAI; grava `ai_logs` feature "agent-test").
- Ainda MOCK nessa aba: KPIs, Logs, IA de voz, Base de Conhecimento, execução das ações, e auto-responder em conversas reais (fase seguinte, depende da Meta/WhatsApp). Sem env nova.

- [ ] **Step 2: Verificar build**

Run: `npx tsc --noEmit && npm run build`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "docs(ia): seção Conversation AI e próxima migração livre 0028"
```

---

## Handoff (Gabriel — fora do código)

1. Rodar `supabase/migrations/0027_ai_agents.sql` no SQL Editor.
2. Garantir `OPENAI_API_KEY` na Vercel (da Fundação de IA) — sem env nova.
3. Merge → deploy. Em `/agentes-ia → Conversation AI`: criar agente, preencher, salvar, e conversar no "Testar seu bot".

## Self-Review (autor do plano)

- **Cobertura da spec:** `ai_agents` → Task 1; rota `/api/ai/chat` (system do agente + histórico + log) → Task 2; repo CRUD/setPrimary/chat → Task 3; aba real (lista+form+teste) → Task 4; docs → Task 5. Não-objetivos (auto-reply real, RAG, voz, execução de ações, KPIs/Logs reais) ficam de fora.
- **Consistência de tipos:** `chat()` da fundação consumido pela rota (Task 2); contrato `{ text, usage }` (Task 2) casa com `aiAgentActions.chat` (Task 3); `AiAgent`/`useAiAgents`/`aiAgentActions.*` (Task 3) consumidos exatamente assim na Task 4. Colunas `ai_agents` (snake_case) iguais entre migração (Task 1), rota (Task 2) e repo (Task 3, `mapAgent`). `messages: {role:"user"|"assistant"}` idêntico em rota/repo/UI.
- **Sem placeholders:** todo passo tem código real; verificação por tsc/build/curl (projeto sem runner), explicitado no header.
- **Ponto de atenção:** agente principal é garantido no app (`setPrimary` desmarca os outros) — não há constraint de unicidade no banco (aceitável na v1).
