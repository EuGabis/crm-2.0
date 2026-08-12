# Construtor de Formulários de Captação — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir o módulo Sites → Formulários: montar formulários de captação, gerar um embed `<script>` pra colar no site, e cada envio vira Contato (com a tag do form) agrupado numa Lista Inteligente pronta pra e-mail marketing.

**Architecture:** Config dos forms em `public.forms` (+ `form_submissions`). Rotas PÚBLICAS `/api/forms/[slug]/embed.js` (JS que renderiza o form, sem estilo) e `/api/forms/[slug]/submit` (cria/atualiza contato via service role, CORS liberado, honeypot). UI no módulo Sites; repo `db/forms.ts`. Ao criar um form, cria-se também uma Lista Inteligente que filtra pela tag do form.

**Tech Stack:** Next.js (App Router) · TypeScript · Supabase (RLS + service role) · Base UI (shadcn) · nenhum serviço externo.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-12-formularios-design.md`. Convenções: `AGENTS.md`.
- **Migração livre = `0024`** → `supabase/migrations/0024_forms.sql`. Idempotente. ⚠️ O outro Claude pode pegar `0024` — reconciliar no merge (renumerar como foi feito: 0020→0022).
- **Migrações aplicadas pelo Gabriel** no SQL Editor (o worker NÃO aplica nem acessa o banco).
- **Sem runner de testes:** verificação = `npx tsc --noEmit` **e** `npm run build` limpos + checagens manuais (curl/estático). Não invente pytest/jest.
- **Rotas `/api/forms/*` são PÚBLICAS** (o form roda no site do cliente, sem sessão): ficam **FORA do matcher do `proxy.ts`** e usam `createAdminClient()` (service role). **CORS liberado** só nessas rotas (+ `OPTIONS`).
- **Anti-spam:** honeypot (campo oculto). Nada de segredo/PII em query string.
- **Multi-tenant:** `forms`/`form_submissions` têm `location_id` + RLS membership (`location_id in (select private.user_locations())`) + `revoke ... from anon`. A escrita pública usa service role.
- **Lista Inteligente da tag:** condição `{ "field": "Tag", "operator": "contém", "value": "<forms.tag>" }` (casa com `matchesConditions` em `src/components/contacts/module-tabs.tsx`). Campanhas miram `type: "tag"` ou `type: "smart_list"` (`@/lib/marketing/types` — já suportado).
- **Estilo do form embed:** SEM classes/estilo (herda o CSS do site).
- **Base UI, não Radix:** triggers com `render={<.../>}`. Texto pt-BR. Commits `feat(forms): ...`. Branch → PR → squash na `main`.
- **Área do Claude B (Sites/UI).** Não tocar em pagamentos/Guru.

---

## File Structure

**Criar:**
- `supabase/migrations/0024_forms.sql` — tabelas `forms` + `form_submissions` (RLS).
- `src/lib/data/repos/db/forms.ts` — repo (CRUD de forms + cria a Lista Inteligente; submissions; embedSnippet).
- `src/app/api/forms/[slug]/submit/route.ts` — POST público (cria contato) + OPTIONS (CORS).
- `src/app/api/forms/[slug]/embed.js/route.ts` — GET público que devolve o JS do form.
- `src/components/sites/forms/forms-tab.tsx` — lista de forms + ações.
- `src/components/sites/forms/form-editor.tsx` — editor (campos + detalhes) num Dialog.

**Modificar:**
- `src/lib/data/types.ts` — tipos `FormField` e `LeadForm`.
- `src/proxy.ts` — adicionar `api/forms` ao matcher de exclusão.
- `src/app/(app)/sites/page.tsx` — trocar o mock da aba "Formulários" por `<FormsTab />` (remover a constante `FORMS` se ficar sem uso).
- `.env.example` / `AGENTS.md` — (só docs na Task 6; sem env nova).

---

## Task 1: Migração 0024 + tipos

Cria o schema e os tipos TS. Deliverable: SQL pronto pro Gabriel; `tsc`/`build` limpos.

**Files:**
- Create: `supabase/migrations/0024_forms.sql`
- Modify: `src/lib/data/types.ts`

**Interfaces:**
- Produces (SQL): `public.forms(id, location_id, slug unique, name, description, fields jsonb, success_action, success_value, tag, smart_list_id, active, created_at, updated_at)`; `public.form_submissions(id, location_id, form_id, contact_id, payload jsonb, created_at)`.
- Produces (TS):
  - `FormField = { key: string; label: string; type: "text"|"email"|"tel"|"textarea"; required: boolean; mapsTo: string }` (mapsTo ∈ `"name"|"email"|"phone"|"company"|"custom:<nome>"`).
  - `LeadForm = { id: string; slug: string; name: string; description: string; fields: FormField[]; successAction: "redirect"|"message"; successValue: string; tag: string; smartListId: string|null; active: boolean; createdAt: string }`.

- [ ] **Step 1: Escrever a migração**

Create `supabase/migrations/0024_forms.sql`:

```sql
-- ============================================================
-- Lito CRM — Formulários de captação (Sites → Formulários)
--
-- `forms`: config do formulário (campos, ação de sucesso, tag, lista inteligente).
-- `form_submissions`: histórico de cada envio. O envio público (rota /api/forms/*)
-- grava com a service role; membros LEEM via RLS. Padrão multi-tenant. Idempotente.
-- ============================================================
set check_function_bodies = off;

create table if not exists public.forms (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations (id) on delete cascade,
  slug text not null unique,                 -- id público usado no embed
  name text not null,
  description text not null default '',
  fields jsonb not null default '[]',        -- FormField[]
  success_action text not null default 'message' check (success_action in ('redirect', 'message')),
  success_value text not null default 'Obrigado! Recebemos seu contato.',
  tag text not null,                          -- tag aplicada ao contato no envio
  smart_list_id uuid references public.smart_lists (id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists forms_location_idx on public.forms (location_id, created_at desc);

alter table public.forms enable row level security;
revoke all on public.forms from anon;

drop policy if exists "membros leem forms" on public.forms;
create policy "membros leem forms" on public.forms
  for select to authenticated using (location_id in (select private.user_locations()));
drop policy if exists "membros criam forms" on public.forms;
create policy "membros criam forms" on public.forms
  for insert to authenticated with check (location_id in (select private.user_locations()));
drop policy if exists "membros editam forms" on public.forms;
create policy "membros editam forms" on public.forms
  for update to authenticated
  using (location_id in (select private.user_locations()))
  with check (location_id in (select private.user_locations()));
drop policy if exists "membros excluem forms" on public.forms;
create policy "membros excluem forms" on public.forms
  for delete to authenticated using (location_id in (select private.user_locations()));

drop trigger if exists forms_updated_at on public.forms;
create trigger forms_updated_at before update on public.forms
  for each row execute function private.set_updated_at();

create table if not exists public.form_submissions (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations (id) on delete cascade,
  form_id uuid not null references public.forms (id) on delete cascade,
  contact_id uuid references public.contacts (id) on delete set null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists form_submissions_form_idx on public.form_submissions (form_id, created_at desc);

alter table public.form_submissions enable row level security;
revoke all on public.form_submissions from anon;

-- Membros LEEM/EXCLUEM; a inserção é feita pela rota pública com service role (bypassa RLS).
drop policy if exists "membros leem envios" on public.form_submissions;
create policy "membros leem envios" on public.form_submissions
  for select to authenticated using (location_id in (select private.user_locations()));
drop policy if exists "membros excluem envios" on public.form_submissions;
create policy "membros excluem envios" on public.form_submissions
  for delete to authenticated using (location_id in (select private.user_locations()));
```

- [ ] **Step 2: Aplicação (Gabriel)**

Pedir ao Gabriel para rodar `supabase/migrations/0024_forms.sql` no SQL Editor. (O worker não aplica.)

- [ ] **Step 3: Tipos**

In `src/lib/data/types.ts`, adicionar ao final (ou junto dos tipos de domínio):

```ts
export interface FormField {
  key: string;
  label: string;
  type: "text" | "email" | "tel" | "textarea";
  required: boolean;
  /** name | email | phone | company | custom:<nome do campo> */
  mapsTo: string;
}

export interface LeadForm {
  id: string;
  slug: string;
  name: string;
  description: string;
  fields: FormField[];
  successAction: "redirect" | "message";
  successValue: string;
  tag: string;
  smartListId: string | null;
  active: boolean;
  createdAt: string;
}
```

- [ ] **Step 4: Verificar build**

Run: `npx tsc --noEmit && npm run build`
Expected: sem erros (nenhum código novo usa os tipos ainda).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0024_forms.sql src/lib/data/types.ts
git commit -m "feat(forms): migração 0024 (forms + form_submissions) e tipos"
```

---

## Task 2: Repo `db/forms.ts`

Fronteira que a UI usa: CRUD de forms (Supabase RLS) + cria a Lista Inteligente da tag; submissions; snippet do embed. Deliverable: build limpo; exports batendo com a UI da Task 5.

**Files:**
- Create: `src/lib/data/repos/db/forms.ts`

**Interfaces:**
- Consumes: `createClient` de `@/lib/supabase/client`; `useDbStore` de `./contacts` (locationId/load); tipos `LeadForm`/`FormField`.
- Produces:
  - `useForms(): { forms: LeadForm[]; ready: boolean }`
  - `formActions.create(input: { name: string; description?: string; fields?: FormField[]; tag?: string }): Promise<{ ok: boolean; slug?: string; error?: string }>` — cria o form (slug gerado, campos padrão se ausentes, tag default = name) **e** a Lista Inteligente da tag; grava `smart_list_id`.
  - `formActions.update(id: string, patch: Partial<Pick<LeadForm, "name"|"description"|"fields"|"successAction"|"successValue"|"active">>): Promise<boolean>`
  - `formActions.remove(id: string): Promise<boolean>`
  - `formActions.toggleActive(id: string, active: boolean): Promise<boolean>`
  - `useFormSubmissions(formId: string): { submissions: { id: string; payload: Record<string,unknown>; createdAt: string }[]; ready: boolean }`
  - `embedSnippet(slug: string): string`
  - `DEFAULT_FIELDS: FormField[]`

- [ ] **Step 1: Escrever o repo**

Create `src/lib/data/repos/db/forms.ts`:

```ts
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
```

- [ ] **Step 2: Verificar build**

Run: `npx tsc --noEmit && npm run build`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add src/lib/data/repos/db/forms.ts
git commit -m "feat(forms): repo db (CRUD + Lista Inteligente da tag + embed snippet)"
```

---

## Task 3: Rota pública de envio + exclusão no proxy

`POST /api/forms/[slug]/submit` cria/atualiza o contato (service role) e grava o envio; `OPTIONS` responde CORS. Deliverable: build limpo; `OPTIONS` retorna headers CORS; honeypot descarta (verificação estática/curl).

**Files:**
- Create: `src/app/api/forms/[slug]/submit/route.ts`
- Modify: `src/proxy.ts` (matcher)

**Interfaces:**
- Consumes: `createAdminClient` de `@/lib/supabase/admin`.
- Produces (contrato HTTP consumido pelo embed da Task 4): `POST /api/forms/{slug}/submit` body JSON `{ [fieldKey]: string, _hp?: string }` → `200 { ok:true, action:"redirect"|"message", value:string }` | `409 { error }` (form inativo) | `404 { error }` | `400 { error }`. `OPTIONS` → `204` com headers CORS.

- [ ] **Step 1: Tirar `api/forms` do matcher do proxy**

In `src/proxy.ts`, adicionar `api/forms` à lista de exclusões do matcher:

```ts
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/automations|api/whatsapp|api/forms|api/webhooks|api/integrations|api/marketing|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
```

- [ ] **Step 2: Escrever a rota de envio**

Create `src/app/api/forms/[slug]/submit/route.ts`:

```ts
import { createAdminClient } from "@/lib/supabase/admin";

/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

function json(body: any, status = 200) {
  return Response.json(body, { status, headers: CORS });
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: "payload inválido" }, 400);
  }

  // honeypot: bot preencheu → descarta silenciosamente
  if (typeof body?._hp === "string" && body._hp.trim() !== "") {
    return json({ ok: true, action: "message", value: "Obrigado!" });
  }

  let db;
  try {
    db = createAdminClient();
  } catch {
    return json({ error: "servidor sem credenciais" }, 503);
  }

  const { data: form } = await db
    .from("forms")
    .select("id, location_id, fields, tag, active, success_action, success_value")
    .eq("slug", slug)
    .maybeSingle();
  if (!form) return json({ error: "formulário não encontrado" }, 404);
  if (!form.active) return json({ error: "formulário inativo" }, 409);

  const fields: any[] = form.fields ?? [];
  // mapeia os campos recebidos pelos mapsTo
  let firstName = "";
  let lastName = "";
  let email = "";
  let phone = "";
  let company: string | null = null;
  const custom: Record<string, string> = {};
  for (const f of fields) {
    const raw = (body?.[f.key] ?? "").toString().trim();
    if (!raw) continue;
    if (f.mapsTo === "name") {
      const parts = raw.split(/\s+/);
      firstName = parts.shift() ?? raw;
      lastName = parts.join(" ");
    } else if (f.mapsTo === "email") email = raw;
    else if (f.mapsTo === "phone") phone = raw;
    else if (f.mapsTo === "company") company = raw;
    else if (typeof f.mapsTo === "string" && f.mapsTo.startsWith("custom:")) {
      custom[f.mapsTo.slice(7)] = raw;
    }
  }

  // dedup: por email (senão por telefone) na location
  let contactId: string | null = null;
  let existing: any = null;
  if (email) {
    const { data } = await db
      .from("contacts")
      .select("id, tags, custom_fields")
      .eq("location_id", form.location_id)
      .eq("email", email)
      .maybeSingle();
    existing = data;
  }
  if (!existing && phone) {
    const { data } = await db
      .from("contacts")
      .select("id, tags, custom_fields")
      .eq("location_id", form.location_id)
      .eq("phone", phone)
      .maybeSingle();
    existing = data;
  }

  const nowIso = new Date().toISOString();
  if (existing) {
    const tags = Array.from(new Set([...(existing.tags ?? []), form.tag]));
    const mergedCustom = { ...(existing.custom_fields ?? {}), ...custom };
    await db
      .from("contacts")
      .update({
        tags,
        custom_fields: mergedCustom,
        ...(company ? { company } : {}),
        last_activity_at: nowIso,
      })
      .eq("id", existing.id);
    contactId = existing.id;
  } else {
    const { data: created } = await db
      .from("contacts")
      .insert({
        location_id: form.location_id,
        first_name: firstName || email || phone || "Lead",
        last_name: lastName,
        email,
        phone,
        company,
        tags: [form.tag],
        custom_fields: custom,
        last_activity_at: nowIso,
      })
      .select("id")
      .single();
    contactId = created?.id ?? null;
  }

  await db.from("form_submissions").insert({
    location_id: form.location_id,
    form_id: form.id,
    contact_id: contactId,
    payload: body,
  });

  return json({ ok: true, action: form.success_action, value: form.success_value });
}
```

- [ ] **Step 3: Verificar build + CORS**

Run: `npx tsc --noEmit && npm run build`
Expected: sem erros; rota `/api/forms/[slug]/submit` no manifesto.

Com `npm run dev`: `curl -s -o /dev/null -w "%{http_code}" -X OPTIONS http://localhost:3000/api/forms/xxx/submit` → `204`. `curl -s -X POST http://localhost:3000/api/forms/inexistente/submit -H "Content-Type: application/json" -d '{"_hp":""}'` → `{"error":"formulário não encontrado"}` (404). (Não gaste mais de uma tentativa subindo o dev; o gate é tsc+build.)

- [ ] **Step 4: Commit**

```bash
git add src/proxy.ts "src/app/api/forms/[slug]/submit/route.ts"
git commit -m "feat(forms): rota pública de envio (cria contato + tag, CORS, honeypot)"
```

---

## Task 4: Rota do embed (JS que renderiza o form)

`GET /api/forms/[slug]/embed.js` devolve JavaScript que renderiza o form (sem estilo) e envia pro `/submit`. Deliverable: build limpo; GET retorna JS (`application/javascript`).

**Files:**
- Create: `src/app/api/forms/[slug]/embed.js/route.ts`

**Interfaces:**
- Consumes: `createAdminClient` (lê a config do form, público); contrato do `/submit` (Task 3).
- Produces: `GET /api/forms/{slug}/embed.js` → corpo `text/javascript`.

- [ ] **Step 1: Escrever a rota do embed**

Create `src/app/api/forms/[slug]/embed.js/route.ts`:

```ts
import { createAdminClient } from "@/lib/supabase/admin";

/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = "force-dynamic";

function js(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=60",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const base = process.env.NEXT_PUBLIC_APP_URL || "https://lito-crm.vercel.app";

  let form: any = null;
  try {
    const db = createAdminClient();
    const { data } = await db
      .from("forms")
      .select("slug, fields, active")
      .eq("slug", slug)
      .maybeSingle();
    form = data;
  } catch {
    return js(`console.error("[Lito Forms] servidor sem credenciais");`, 503);
  }
  if (!form || !form.active) {
    return js(`console.warn("[Lito Forms] formulário indisponível: ${slug}");`);
  }

  const config = JSON.stringify({
    slug: form.slug,
    fields: form.fields ?? [],
    endpoint: `${base.replace(/\/$/, "")}/api/forms/${form.slug}/submit`,
  });

  // O script renderiza o form (sem estilo) onde o <script> está e envia por fetch.
  const body = `(function(){
  var F = ${config};
  var mount = document.getElementById("lito-form-" + F.slug) || document.currentScript.parentNode;
  var form = document.createElement("form");
  F.fields.forEach(function(f){
    var wrap = document.createElement("p");
    var label = document.createElement("label");
    label.textContent = f.label + (f.required ? " *" : "");
    label.setAttribute("for", "litf_" + f.key);
    var input = f.type === "textarea" ? document.createElement("textarea") : document.createElement("input");
    if (f.type !== "textarea") input.type = (f.type === "email" ? "email" : f.type === "tel" ? "tel" : "text");
    input.id = "litf_" + f.key; input.name = f.key; if (f.required) input.required = true;
    wrap.appendChild(label); wrap.appendChild(document.createElement("br")); wrap.appendChild(input);
    form.appendChild(wrap);
  });
  // honeypot oculto
  var hp = document.createElement("input");
  hp.type = "text"; hp.name = "_hp"; hp.tabIndex = -1; hp.autocomplete = "off";
  hp.style.position = "absolute"; hp.style.left = "-9999px"; hp.setAttribute("aria-hidden", "true");
  form.appendChild(hp);
  var btn = document.createElement("button"); btn.type = "submit"; btn.textContent = "Enviar";
  form.appendChild(btn);
  var msg = document.createElement("p");
  form.appendChild(msg);
  form.addEventListener("submit", function(e){
    e.preventDefault(); btn.disabled = true; msg.textContent = "Enviando...";
    var payload = {}; F.fields.forEach(function(f){ payload[f.key] = (form.elements[f.key]||{}).value || ""; });
    payload._hp = hp.value;
    fetch(F.endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
      .then(function(r){ return r.json(); })
      .then(function(res){
        if (!res.ok) { msg.textContent = res.error || "Não foi possível enviar."; btn.disabled = false; return; }
        if (res.action === "redirect" && res.value) { window.location.href = res.value; return; }
        form.innerHTML = ""; msg.textContent = res.value || "Obrigado!"; form.appendChild(msg);
      })
      .catch(function(){ msg.textContent = "Erro de conexão."; btn.disabled = false; });
  });
  mount.appendChild(form);
})();`;

  return js(body);
}
```

- [ ] **Step 2: Verificar build + content-type**

Run: `npx tsc --noEmit && npm run build`
Expected: sem erros; rota `/api/forms/[slug]/embed.js` no manifesto.

Com `npm run dev`: `curl -s -I http://localhost:3000/api/forms/xxx/embed.js` → `Content-Type: application/javascript...` e corpo com `console.warn` (form inexistente). (Uma tentativa; gate = tsc+build.)

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/forms/[slug]/embed.js/route.ts"
git commit -m "feat(forms): rota do embed (JS que renderiza o form sem estilo)"
```

---

## Task 5: UI — Sites → Formulários (lista + editor)

Troca o mock pela aba real: lista de forms, criar/editar (campos + detalhes), copiar embed. Deliverable: build limpo + browser: cria form, abre editor, copia embed.

**Files:**
- Create: `src/components/sites/forms/forms-tab.tsx`
- Create: `src/components/sites/forms/form-editor.tsx`
- Modify: `src/app/(app)/sites/page.tsx`

**Interfaces:**
- Consumes: `useForms`, `formActions`, `embedSnippet`, `DEFAULT_FIELDS` de `@/lib/data/repos/db/forms`; tipos `LeadForm`/`FormField`; `useContactsModule` (campos personalizados) de `@/lib/data/repos/db/contacts-module` (para "Adicionar campo").

- [ ] **Step 1: Editor do formulário**

Create `src/components/sites/forms/form-editor.tsx`:

```tsx
"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Switch } from "@/components/ui/switch";
import { Trash2, Plus } from "lucide-react";
import { formActions } from "@/lib/data/repos/db/forms";
import type { FormField, LeadForm } from "@/lib/data/types";

const MAP_OPTIONS: { value: string; label: string }[] = [
  { value: "name", label: "Nome" },
  { value: "email", label: "E-mail" },
  { value: "phone", label: "Telefone/WhatsApp" },
  { value: "company", label: "Empresa" },
];

export function FormEditor({
  form,
  open,
  onOpenChange,
}: {
  form: LeadForm;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [name, setName] = useState(form.name);
  const [description, setDescription] = useState(form.description);
  const [fields, setFields] = useState<FormField[]>(form.fields);
  const [successAction, setSuccessAction] = useState(form.successAction);
  const [successValue, setSuccessValue] = useState(form.successValue);
  const [active, setActive] = useState(form.active);
  const [saving, setSaving] = useState(false);

  const setField = (i: number, patch: Partial<FormField>) =>
    setFields((fs) => fs.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const removeField = (i: number) => setFields((fs) => fs.filter((_, j) => j !== i));
  const addField = () =>
    setFields((fs) => [
      ...fs,
      { key: `campo${fs.length + 1}`, label: "Novo campo", type: "text", required: false, mapsTo: "company" },
    ]);

  const save = async () => {
    if (!name.trim()) {
      toast.error("Dê um nome ao formulário");
      return;
    }
    setSaving(true);
    const ok = await formActions.update(form.id, {
      name: name.trim(),
      description,
      fields,
      successAction,
      successValue,
      active,
    });
    setSaving(false);
    if (ok) {
      toast.success("Formulário salvo");
      onOpenChange(false);
    } else toast.error("Não foi possível salvar");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Editar formulário</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-[1fr_260px]">
          {/* Campos */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold">Campos</Label>
            {fields.map((f, i) => (
              <div key={i} className="flex items-center gap-1.5 rounded-md border p-2">
                <Input
                  value={f.label}
                  onChange={(e) => setField(i, { label: e.target.value })}
                  className="h-8 text-xs"
                  placeholder="Rótulo"
                />
                <Select value={f.mapsTo} onValueChange={(v) => v && setField(i, { mapsTo: v })}>
                  <SelectTrigger className="h-8 w-[130px] text-xs" size="sm">
                    <SelectValue>{MAP_OPTIONS.find((o) => o.value === f.mapsTo)?.label ?? f.mapsTo}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {MAP_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value} className="text-xs">
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <button
                  onClick={() => setField(i, { required: !f.required })}
                  className={`rounded px-1.5 py-1 text-[10px] font-semibold ${f.required ? "bg-indigo-100 text-indigo-700" : "bg-slate-100 text-slate-500"}`}
                >
                  Obrigatório
                </button>
                <button onClick={() => removeField(i)} className="text-slate-400 hover:text-rose-600">
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
            <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={addField}>
              <Plus className="size-3.5" /> Adicionar campo
            </Button>
          </div>

          {/* Detalhes */}
          <div className="space-y-3">
            <div className="grid gap-1">
              <Label className="text-xs">Nome</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 text-xs" />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">Descrição</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="min-h-14 text-xs"
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">Ação de sucesso</Label>
              <Select value={successAction} onValueChange={(v) => v && setSuccessAction(v as any)}>
                <SelectTrigger className="h-8 text-xs" size="sm">
                  <SelectValue>{successAction === "redirect" ? "Redirecionar (URL)" : "Mostrar mensagem"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="message" className="text-xs">Mostrar mensagem</SelectItem>
                  <SelectItem value="redirect" className="text-xs">Redirecionar (URL)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">{successAction === "redirect" ? "URL de redirecionamento" : "Mensagem de sucesso"}</Label>
              <Input value={successValue} onChange={(e) => setSuccessValue(e.target.value)} className="h-8 text-xs" />
            </div>
            <label className="flex items-center gap-2 text-xs">
              <Switch checked={active} onCheckedChange={setActive} /> Ativado
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button size="sm" className="h-8 text-xs" onClick={save} disabled={saving}>
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

> Nota: `MAP_OPTIONS` cobre os campos padrão. Campos personalizados (`custom:<nome>`) ficam
> como estão se já existirem no form; adicionar novos custom pelo editor é opcional (v1 usa
> os padrão + Empresa). Se `useContactsModule().fields` estiver disponível e você quiser
> oferecê-los no seletor, acrescente-os a `MAP_OPTIONS` como `{ value: 'custom:'+nome, label: nome }`.

- [ ] **Step 2: Aba de formulários**

Create `src/components/sites/forms/forms-tab.tsx`:

```tsx
"use client";

import { useState } from "react";
import { toast } from "sonner";
import { FileText, Plus, Copy, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { useForms, formActions, embedSnippet } from "@/lib/data/repos/db/forms";
import { FormEditor } from "./form-editor";
import type { LeadForm } from "@/lib/data/types";

export function FormsTab() {
  const { forms, ready } = useForms();
  const [editing, setEditing] = useState<LeadForm | null>(null);
  const [creating, setCreating] = useState(false);

  const create = async () => {
    setCreating(true);
    const res = await formActions.create({ name: "Novo formulário" });
    setCreating(false);
    if (res.ok) toast.success("Formulário criado — edite os campos");
    else toast.error(res.error ?? "Falha ao criar");
  };

  const copyEmbed = (slug: string) => {
    void navigator.clipboard.writeText(embedSnippet(slug));
    toast.success("Embed copiado — cole no HTML da sua página");
  };

  if (ready && forms.length === 0) {
    return (
      <div className="space-y-4">
        <EmptyState
          icon={FileText}
          title="Nenhum formulário ainda"
          description="Crie um formulário de captação, cole o embed no seu site e os leads caem no CRM."
          cta={
            <Button size="sm" className="h-8 text-xs" onClick={create} disabled={creating}>
              <Plus className="size-3.5" /> Novo formulário
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-slate-900">Formulários</h1>
        <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={create} disabled={creating}>
          <Plus className="size-3.5" /> Novo formulário
        </Button>
      </div>
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b text-[11px] text-slate-400">
              {["Nome", "Tag / Lista", "Status", "Ações"].map((h) => (
                <th key={h} className="px-4 py-2.5 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {forms.map((f) => (
              <tr key={f.id} className="border-b last:border-0">
                <td className="px-4 py-2.5 font-medium text-slate-800">{f.name}</td>
                <td className="px-4 py-2.5 text-slate-500">{f.tag}</td>
                <td className="px-4 py-2.5">
                  <span className={f.active ? "rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700" : "rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500"}>
                    {f.active ? "Ativo" : "Inativo"}
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2 text-slate-400">
                    <button title="Copiar embed" onClick={() => copyEmbed(f.slug)} className="hover:text-indigo-600"><Copy className="size-4" /></button>
                    <button title="Editar" onClick={() => setEditing(f)} className="hover:text-indigo-600"><Pencil className="size-4" /></button>
                    <button
                      title="Excluir"
                      onClick={async () => { if (await formActions.remove(f.id)) toast.success("Formulário excluído"); }}
                      className="hover:text-rose-600"
                    ><Trash2 className="size-4" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <FormEditor form={editing} open={!!editing} onOpenChange={(v) => !v && setEditing(null)} />}
    </div>
  );
}
```

- [ ] **Step 3: Ligar na página do Sites**

In `src/app/(app)/sites/page.tsx`:
- Add import: `import { FormsTab } from "@/components/sites/forms/forms-tab";`
- Localize o bloco `{tab === "Formulários" && ( ... )}` (o mock que usa a constante `FORMS`) e substitua todo o conteúdo por:
  ```tsx
  {tab === "Formulários" && <FormsTab />}
  ```
- Remova a constante `FORMS` (mock) **se ficar sem uso** (buscar por `FORMS` no arquivo antes de apagar). Remova imports órfãos que sobrarem (ex.: se `FORMS` era o único uso de algo).

- [ ] **Step 4: Verificar build + browser**

Run: `npx tsc --noEmit && npm run build`
Expected: sem erros; sem símbolos não usados.

Browser (workflow do preview): abrir `/sites` → aba "Formulários" → "Novo formulário" cria uma linha; "Editar" abre o dialog (campos + detalhes); "Copiar embed" mostra toast. `read_console_messages` sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/components/sites/forms/ "src/app/(app)/sites/page.tsx"
git commit -m "feat(forms): aba Sites → Formulários (lista + editor + copiar embed)"
```

---

## Task 6: Docs

Documenta o módulo. Deliverable: build limpo; `AGENTS.md` atualizado.

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Doc no AGENTS.md**

In `AGENTS.md`, adicionar uma seção concisa (pt-BR, no tom do arquivo) do módulo Formulários e atualizar a nota de "próxima migração livre" para **0025**. Conteúdo a refletir (bater com o código):
- Sites → Formulários: builder (`components/sites/forms/*`), repo `db/forms.ts`, migração `0024_forms.sql` (`forms` + `form_submissions`).
- Rotas PÚBLICAS (fora do matcher do `proxy.ts`, service role, CORS): `GET /api/forms/[slug]/embed.js` (JS que renderiza o form, sem estilo) e `POST /api/forms/[slug]/submit` (cria/atualiza contato + aplica a tag, honeypot).
- Cada form nasce com uma **Lista Inteligente** (condição `{field:"Tag",operator:"contém",value:tag}`) → leads prontos pra e-mail marketing (campanha mira `tag`/`smart_list`).
- Sem env nova, sem serviço externo.

- [ ] **Step 2: Verificar build**

Run: `npx tsc --noEmit && npm run build`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "docs(forms): seção do módulo Formulários e próxima migração livre 0025"
```

---

## Handoff (Gabriel — fora do código)

1. Rodar `supabase/migrations/0024_forms.sql` no SQL Editor.
2. Merge → deploy (auto).
3. Em `/sites → Formulários`: criar form, editar campos, **Copiar embed** e colar no HTML de uma página do site. Enviar um teste → conferir Contato criado com a tag + na Lista Inteligente do form.

## Self-Review (autor do plano)

- **Cobertura da spec:** builder → Task 5; embed script → Task 4; envio público + contato + tag + honeypot + CORS → Task 3; Lista Inteligente automática → Task 2 (`formActions.create`); dados → Task 1; docs → Task 6. Não-objetivos (estilos, landing pages, pipeline) ficam de fora.
- **Consistência de tipos:** `LeadForm`/`FormField` (Task 1) usados no repo (Task 2), UI (Task 5) e rotas (Tasks 3/4 leem `fields`/`tag`/`success_*` do banco). `formActions.create/update/remove/toggleActive`, `useForms`, `embedSnippet`, `DEFAULT_FIELDS` (Task 2) consumidos exatamente assim na Task 5. Contrato HTTP do `/submit` (Task 3) casa com o fetch do embed (Task 4). Condição da Lista Inteligente (`field:"Tag"`) casa com `matchesConditions`.
- **Sem placeholders:** todo passo de código tem o código real; verificação por tsc/build/curl (projeto sem runner), explicitado no header.
- **Ponto de atenção:** o segmento de rota `embed.js` (pasta literal `embed.js/route.ts`) dá a URL com extensão `.js`; se o Next reclamar do ponto no nome da pasta, cair para `embed/route.ts` e ajustar `embedSnippet` para `/embed` — anotado pro implementador.
