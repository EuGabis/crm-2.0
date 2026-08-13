# Fundação de IA (OpenAI) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Montar a fundação de IA: cliente server da OpenAI (chave só no servidor), rota autenticada `/api/ai/generate` (motor genérico), logs de uso (`ai_logs`) e o playground real no AI Studio.

**Architecture:** `lib/ai/openai.ts` chama a OpenAI com `OPENAI_API_KEY`. A rota autenticada `/api/ai/generate` recebe prompt/system, chama o cliente, grava `ai_logs` e devolve o texto. O repo `db/ai.ts` é a fronteira do cliente; o AI Studio consome (playground + KPIs/lista de uso). Sem serviço externo além da OpenAI.

**Tech Stack:** Next.js (App Router) · TypeScript · Supabase (RLS) · OpenAI Chat Completions API.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-12-ia-fundacao-design.md`. Convenções: `AGENTS.md`.
- **Migração livre = `0025`** → `supabase/migrations/0025_ai_logs.sql`. Idempotente. ⚠️ O outro Claude pode pegar `0025` — reconciliar no merge (renumerar como foi feito: 0020→0022).
- **Migrações aplicadas pelo Gabriel** no SQL Editor (o worker NÃO aplica nem acessa o banco).
- **Sem runner de testes:** verificação = `npx tsc --noEmit` **e** `npm run build` limpos + checagens (curl/estático). Não invente pytest/jest.
- **Segredo nunca `NEXT_PUBLIC_`.** Envs novas: `OPENAI_API_KEY` (secreta) e `OPENAI_MODEL` (default `gpt-4o-mini`). Em `.env.local`, `.env.example`, Vercel (valor real colado pelo Gabriel — o worker só referencia `process.env.*`).
- **`/api/ai/generate` é AUTENTICADA** (tem sessão): fica no matcher normal do `proxy.ts` (NÃO alterar `proxy.ts`). A chave nunca vai ao cliente. `location_id` vem da sessão/membership, nunca do corpo.
- **Multi-tenant:** `ai_logs` tem `location_id` + RLS membership (`location_id in (select private.user_locations())`) + `revoke ... from anon`.
- **Modelo configurável por env** (`OPENAI_MODEL`) — não travar em nome de modelo.
- **Base UI, não Radix.** Texto pt-BR. Commits `feat(ia): ...`. Branch → PR → squash na `main`.
- **Área do Claude B (UI/IA).** Não tocar em pagamentos/Guru.

---

## File Structure

**Criar:**
- `supabase/migrations/0025_ai_logs.sql` — tabela `ai_logs` (RLS).
- `src/lib/ai/openai.ts` — cliente server da OpenAI (`chat`, `defaultModel`). Server-only.
- `src/app/api/ai/generate/route.ts` — POST autenticado: chama a OpenAI + grava log.
- `src/lib/data/repos/db/ai.ts` — repo (`aiActions.generate`, `useAiLogs`, `useAiUsage`, tipo `AiLog`).

**Modificar:**
- `src/app/(app)/ai-studio/page.tsx` — playground real + KPIs/lista de uso reais.
- `.env.example` / `AGENTS.md` — envs + doc (na Task 6).

---

## Task 1: Migração 0025 (ai_logs)

Cria a tabela de logs de geração. Deliverable: SQL pronto pro Gabriel; `tsc`/`build` limpos.

**Files:**
- Create: `supabase/migrations/0025_ai_logs.sql`

**Interfaces:**
- Produces (SQL): `public.ai_logs(id, location_id, feature, model, prompt, response, prompt_tokens, completion_tokens, created_by, created_at)`.

- [ ] **Step 1: Escrever a migração**

Create `supabase/migrations/0025_ai_logs.sql`:

```sql
-- ============================================================
-- Lito CRM — Fundação de IA: logs de geração (ai_logs)
--
-- Uma linha por chamada ao /api/ai/generate: modelo, prompt, resposta, tokens,
-- quem chamou. Padrão multi-tenant: RLS membership, revoke do anon. Membros leem
-- e inserem (a rota roda com a sessão do usuário). Idempotente.
-- ============================================================
set check_function_bodies = off;

create table if not exists public.ai_logs (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations (id) on delete cascade,
  feature text not null default 'generate',      -- ex.: playground, content, inbox-suggest
  model text not null default '',
  prompt text not null default '',
  response text not null default '',
  prompt_tokens int not null default 0,
  completion_tokens int not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists ai_logs_location_idx on public.ai_logs (location_id, created_at desc);

alter table public.ai_logs enable row level security;
revoke all on public.ai_logs from anon;

drop policy if exists "membros leem ai_logs" on public.ai_logs;
create policy "membros leem ai_logs" on public.ai_logs
  for select to authenticated using (location_id in (select private.user_locations()));

drop policy if exists "membros criam ai_logs" on public.ai_logs;
create policy "membros criam ai_logs" on public.ai_logs
  for insert to authenticated with check (location_id in (select private.user_locations()));
```

- [ ] **Step 2: Aplicação (Gabriel)**

Pedir ao Gabriel para rodar `supabase/migrations/0025_ai_logs.sql` no SQL Editor. (O worker não aplica.)

- [ ] **Step 3: Verificar build**

Run: `npx tsc --noEmit && npm run build`
Expected: sem erros (nenhum código novo ainda).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0025_ai_logs.sql
git commit -m "feat(ia): migração 0025 (ai_logs)"
```

---

## Task 2: Cliente OpenAI

Módulo server-only que chama a OpenAI. Deliverable: compila; assinaturas batem com a rota.

**Files:**
- Create: `src/lib/ai/openai.ts`

**Interfaces:**
- Produces:
  - `defaultModel(): string`
  - `chat(messages: { role: "system" | "user" | "assistant"; content: string }[], opts?: { model?: string; temperature?: number }): Promise<{ text: string; usage: { promptTokens: number; completionTokens: number } }>`

- [ ] **Step 1: Escrever o cliente**

Create `src/lib/ai/openai.ts`:

```ts
/**
 * Cliente da OpenAI (Chat Completions). SERVER-ONLY: usa OPENAI_API_KEY, que nunca
 * pode ir ao cliente. Modelo configurável por OPENAI_MODEL (default gpt-4o-mini).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

export function defaultModel(): string {
  return process.env.OPENAI_MODEL || "gpt-4o-mini";
}

function apiKey(): string {
  const k = process.env.OPENAI_API_KEY;
  if (!k) throw new Error("OPENAI_API_KEY ausente no servidor");
  return k;
}

export async function chat(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  opts?: { model?: string; temperature?: number },
): Promise<{ text: string; usage: { promptTokens: number; completionTokens: number } }> {
  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: opts?.model || defaultModel(),
      messages,
      temperature: opts?.temperature ?? 0.7,
    }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.error?.message || `OpenAI ${res.status}`);
  }
  const text: string = json?.choices?.[0]?.message?.content ?? "";
  const usage = json?.usage ?? {};
  return {
    text,
    usage: {
      promptTokens: usage.prompt_tokens ?? 0,
      completionTokens: usage.completion_tokens ?? 0,
    },
  };
}
```

- [ ] **Step 2: Verificar build**

Run: `npx tsc --noEmit && npm run build`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add src/lib/ai/openai.ts
git commit -m "feat(ia): cliente da OpenAI (chat + modelo configurável)"
```

---

## Task 3: Rota `/api/ai/generate`

Rota autenticada que chama a OpenAI e grava o log. Deliverable: build limpo; sem sessão → 401; sem chave → 503.

**Files:**
- Create: `src/app/api/ai/generate/route.ts`

**Interfaces:**
- Consumes: `chat`, `defaultModel` (Task 2); `createClient` de `@/lib/supabase/server`.
- Produces (contrato HTTP consumido pelo repo na Task 4): `POST /api/ai/generate` body `{ system?, prompt, model?, temperature?, feature? }` → `200 { text, usage: { promptTokens, completionTokens } }` | `401` (sem sessão) | `503 { error }` (sem `OPENAI_API_KEY`) | `400 { error }` (prompt vazio) | `502 { error }` (falha OpenAI).

- [ ] **Step 1: Escrever a rota**

Create `src/app/api/ai/generate/route.ts`:

```ts
import { createClient } from "@/lib/supabase/server";
import { chat, defaultModel } from "@/lib/ai/openai";

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
  const prompt = (body?.prompt ?? "").toString().trim();
  if (!prompt) return Response.json({ error: "Prompt vazio" }, { status: 400 });

  const { data: membership } = await supabase
    .from("location_members")
    .select("location_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  const locationId = (membership as any)?.location_id ?? null;

  const model = (body?.model || defaultModel()) as string;
  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [];
  if (body?.system) messages.push({ role: "system", content: String(body.system) });
  messages.push({ role: "user", content: prompt });

  let result;
  try {
    result = await chat(messages, {
      model,
      temperature: typeof body?.temperature === "number" ? body.temperature : undefined,
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Falha na OpenAI" },
      { status: 502 },
    );
  }

  if (locationId) {
    await supabase.from("ai_logs").insert({
      location_id: locationId,
      feature: (body?.feature || "generate") as string,
      model,
      prompt,
      response: result.text,
      prompt_tokens: result.usage.promptTokens,
      completion_tokens: result.usage.completionTokens,
      created_by: user.id,
    });
  }

  return Response.json({ text: result.text, usage: result.usage });
}
```

> Nota: a resolução de `location_id` pela sessão via `location_members` segue o mesmo padrão
> usado em `src/app/api/google-ads/oauth/callback/route.ts` e `api/team/invite`. Se houver um
> helper server pra isso, prefira-o; senão, a consulta inline está correta.

- [ ] **Step 2: Verificar build + auth gate**

Run: `npx tsc --noEmit && npm run build`
Expected: sem erros; rota `/api/ai/generate` no manifesto.

Com `npm run dev` (sem login): `curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/api/ai/generate -H "Content-Type: application/json" -d '{"prompt":"oi"}'` → 401 (ou redirect do proxy). Não gaste mais de uma tentativa; o gate é tsc+build.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/ai/generate/route.ts
git commit -m "feat(ia): rota autenticada /api/ai/generate (OpenAI + grava log)"
```

---

## Task 4: Repo `db/ai.ts`

Fronteira que a UI usa: gerar (via rota) + ler logs/uso (Supabase RLS). Deliverable: build limpo; exports batendo com a UI da Task 5.

**Files:**
- Create: `src/lib/data/repos/db/ai.ts`

**Interfaces:**
- Consumes: `createClient` de `@/lib/supabase/client`; `useDbStore` de `./contacts` (locationId/load); contrato HTTP da Task 3.
- Produces:
  - type `AiLog = { id: string; feature: string; model: string; prompt: string; response: string; promptTokens: number; completionTokens: number; createdAt: string }`
  - `aiActions.generate(input: { system?: string; prompt: string; feature?: string }): Promise<{ ok: boolean; text?: string; error?: string }>`
  - `useAiLogs(limit?: number): { logs: AiLog[]; ready: boolean }`
  - `useAiUsage(): { callsThisMonth: number; tokensThisMonth: number; ready: boolean }`

- [ ] **Step 1: Escrever o repo**

Create `src/lib/data/repos/db/ai.ts`:

```ts
"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useDbStore } from "./contacts";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface AiLog {
  id: string;
  feature: string;
  model: string;
  prompt: string;
  response: string;
  promptTokens: number;
  completionTokens: number;
  createdAt: string;
}

function mapLog(r: any): AiLog {
  return {
    id: r.id,
    feature: r.feature,
    model: r.model,
    prompt: r.prompt ?? "",
    response: r.response ?? "",
    promptTokens: r.prompt_tokens ?? 0,
    completionTokens: r.completion_tokens ?? 0,
    createdAt: r.created_at,
  };
}

export const aiActions = {
  async generate(input: {
    system?: string;
    prompt: string;
    feature?: string;
  }): Promise<{ ok: boolean; text?: string; error?: string }> {
    const res = await fetch("/api/ai/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: json?.error ?? "Falha ao gerar" };
    return { ok: true, text: json.text };
  },
};

function useLocationId(): string | null {
  const [locationId, setLocationId] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void useDbStore
      .getState()
      .load()
      .then(() => {
        if (active) setLocationId(useDbStore.getState().locationId);
      });
    return () => {
      active = false;
    };
  }, []);
  return locationId;
}

export function useAiLogs(limit = 20) {
  const locationId = useLocationId();
  const [logs, setLogs] = useState<AiLog[]>([]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!locationId) return;
    let active = true;
    const supabase = createClient();
    void supabase
      .from("ai_logs")
      .select("*")
      .eq("location_id", locationId)
      .order("created_at", { ascending: false })
      .limit(limit)
      .then(({ data }) => {
        if (!active) return;
        setLogs((data ?? []).map(mapLog));
        setReady(true);
      });
    return () => {
      active = false;
    };
  }, [locationId, limit]);
  return { logs, ready };
}

export function useAiUsage() {
  const locationId = useLocationId();
  const [state, setState] = useState({ callsThisMonth: 0, tokensThisMonth: 0, ready: false });
  useEffect(() => {
    if (!locationId) return;
    let active = true;
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    const supabase = createClient();
    void supabase
      .from("ai_logs")
      .select("prompt_tokens, completion_tokens")
      .eq("location_id", locationId)
      .gte("created_at", start.toISOString())
      .then(({ data }) => {
        if (!active) return;
        const rows = data ?? [];
        const tokens = rows.reduce(
          (a: number, r: any) => a + (r.prompt_tokens ?? 0) + (r.completion_tokens ?? 0),
          0,
        );
        setState({ callsThisMonth: rows.length, tokensThisMonth: tokens, ready: true });
      });
    return () => {
      active = false;
    };
  }, [locationId]);
  return state;
}
```

- [ ] **Step 2: Verificar build**

Run: `npx tsc --noEmit && npm run build`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add src/lib/data/repos/db/ai.ts
git commit -m "feat(ia): repo db (generate via rota + logs + uso do mês)"
```

---

## Task 5: AI Studio real (playground + uso)

Liga o playground e os KPIs/lista de uso aos dados reais. Deliverable: build limpo + browser: gerar responde e aparece nos logs.

**Files:**
- Modify: `src/app/(app)/ai-studio/page.tsx`

**Interfaces:**
- Consumes: `aiActions`, `useAiLogs`, `useAiUsage` de `@/lib/data/repos/db/ai`.

- [ ] **Step 1: Ligar o playground + uso**

In `src/app/(app)/ai-studio/page.tsx`:

- Add imports:
  ```ts
  import { useState } from "react";
  import { aiActions, useAiLogs, useAiUsage } from "@/lib/data/repos/db/ai";
  ```
- No componente `AiStudioPage`, adicionar estado e o handler de geração:
  ```ts
  const [prompt, setPrompt] = useState("");
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const usage = useAiUsage();
  const { logs } = useAiLogs(8);

  const generate = async () => {
    if (!prompt.trim()) {
      toast.error("Escreva o que você quer gerar");
      return;
    }
    setLoading(true);
    setAnswer("");
    const res = await aiActions.generate({ prompt: prompt.trim(), feature: "playground" });
    setLoading(false);
    if (res.ok) setAnswer(res.text ?? "");
    else toast.error(res.error ?? "Não foi possível gerar");
  };
  ```
- Trocar os 3 KPIs mock por reais (usar `usage`):
  ```tsx
  <KpiCard label="Gerações no mês" value={usage.ready ? usage.callsThisMonth.toLocaleString("pt-BR") : "—"} />
  <KpiCard label="Tokens no mês" value={usage.ready ? usage.tokensThisMonth.toLocaleString("pt-BR") : "—"} />
  <KpiCard label="Modelo" value="OpenAI" hint="Configurável em OPENAI_MODEL" />
  ```
- No bloco do playground ("Construa usando IA"), ligar o `Textarea` ao estado e o botão à `generate`, e mostrar a resposta:
  ```tsx
  <Textarea
    value={prompt}
    onChange={(e) => setPrompt(e.target.value)}
    placeholder="Ex.: escreva um e-mail curto convidando leads para uma aula experimental de aviação"
    className="min-h-20 text-xs"
  />
  <Button size="sm" className="h-8 text-xs" onClick={generate} disabled={loading}>
    <Sparkles className="size-3.5" /> {loading ? "Gerando..." : "Gerar"}
  </Button>
  {answer && (
    <div className="mt-3 whitespace-pre-wrap rounded-lg border bg-slate-50 p-3 text-xs text-slate-700">
      {answer}
    </div>
  )}
  ```
- Abaixo do playground, adicionar uma lista curta das últimas gerações:
  ```tsx
  {logs.length > 0 && (
    <div className="mt-5 max-w-2xl">
      <h2 className="mb-2 text-sm font-semibold text-slate-700">Últimas gerações</h2>
      <div className="divide-y rounded-xl border bg-white">
        {logs.map((l) => (
          <div key={l.id} className="px-4 py-2 text-xs">
            <p className="truncate font-medium text-slate-700">{l.prompt}</p>
            <p className="text-[10px] text-slate-400">
              {l.feature} · {l.model} · {l.promptTokens + l.completionTokens} tokens
            </p>
          </div>
        ))}
      </div>
    </div>
  )}
  ```

Remova o `onClick={() => toast.info("Geração com IA chega com o backend")}` antigo do botão.
Garanta que os imports usados (`useState`, `Sparkles`, `toast`, `KpiCard`, `Textarea`, `Button`, `Label`) continuam presentes e sem órfãos.

- [ ] **Step 2: Verificar build + browser**

Run: `npx tsc --noEmit && npm run build`
Expected: sem erros; sem símbolos não usados.

Browser (workflow do preview, se as envs estiverem setadas): abrir `/ai-studio`, escrever um prompt, "Gerar" → resposta aparece; recarregar → aparece em "Últimas gerações" e os KPIs sobem. (Sem `OPENAI_API_KEY` a rota dá 503 e o toast mostra o aviso — esperado até a env estar na Vercel.) `read_console_messages` sem erros.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/ai-studio/page.tsx"
git commit -m "feat(ia): AI Studio real (playground gera de verdade + uso/logs)"
```

---

## Task 6: Envs + docs

Documenta as envs e o módulo. Deliverable: build limpo; `.env.example` + `AGENTS.md` atualizados.

**Files:**
- Modify: `.env.example`
- Modify: `AGENTS.md`

- [ ] **Step 1: Envs de exemplo**

In `.env.example`, acrescentar (sem valores):
```
# IA (OpenAI)
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
```

- [ ] **Step 2: Doc do módulo no AGENTS.md**

In `AGENTS.md`, adicionar uma seção concisa (pt-BR, no tom do arquivo) da Fundação de IA e atualizar a nota de "próxima migração livre" para **0026**. Rodar `ls supabase/migrations/` antes e usar (maior número + 1) — nossa migração é `0025_ai_logs.sql`; se nada maior existir, próxima livre = **0026**. Conteúdo a refletir (bater com o código):
- Fundação de IA (OpenAI): cliente server `src/lib/ai/openai.ts` (chave só no servidor, modelo por `OPENAI_MODEL`), rota autenticada `POST /api/ai/generate` (motor genérico; grava `ai_logs`), repo `src/lib/data/repos/db/ai.ts`.
- Migração `0025_ai_logs.sql` (tabela `ai_logs`: modelo, prompt, resposta, tokens, quem chamou).
- AI Studio (`/ai-studio`) usa a fundação: playground gera de verdade + KPIs/lista de uso saem de `ai_logs`. Agentes de IA (`/agentes-ia`) ainda MOCK — features (Content AI, Conversation AI, base de conhecimento) virão em cima dessa base, cada uma como spec própria.
- Envs (nunca `NEXT_PUBLIC_`): `OPENAI_API_KEY`, `OPENAI_MODEL` (default `gpt-4o-mini`).

- [ ] **Step 3: Verificar build**

Run: `npx tsc --noEmit && npm run build`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add .env.example AGENTS.md
git commit -m "docs(ia): envs, seção da Fundação de IA e próxima migração livre 0026"
```

---

## Handoff (Gabriel — fora do código)

1. Rodar `supabase/migrations/0025_ai_logs.sql` no SQL Editor.
2. Pôr `OPENAI_API_KEY` (e opcional `OPENAI_MODEL`) no `.env.local` e na **Vercel** (production+preview+development) → redeploy (ou deixar a env antes do merge).
3. Merge → deploy. Testar em `/ai-studio` → playground → "Gerar".

## Self-Review (autor do plano)

- **Cobertura da spec:** cliente OpenAI (chave server) → Task 2; rota autenticada + log → Task 3; `ai_logs` → Task 1; repo → Task 4; AI Studio (playground real + KPIs/lista) → Task 5; envs/docs → Task 6. Não-objetivos (features específicas, agentes-ia real, streaming) ficam de fora.
- **Consistência de tipos:** `chat()`/`defaultModel()` (Task 2) consumidos pela rota (Task 3); contrato HTTP `{ text, usage:{promptTokens,completionTokens} }` (Task 3) casa com `aiActions.generate` (Task 4). `AiLog`, `useAiLogs`, `useAiUsage`, `aiActions.generate` (Task 4) consumidos exatamente assim na Task 5. Colunas `ai_logs` (snake_case) iguais entre migração (Task 1), rota (Task 3, insert) e repo (Task 4, `mapLog`).
- **Sem placeholders:** todo passo de código tem o código real; verificação por tsc/build/curl (projeto sem runner), explicitado no header.
- **Ponto de atenção:** modelo default `gpt-4o-mini` é configurável por `OPENAI_MODEL` — se o Gabriel usar outro/mais novo, é só a env (sem código).
