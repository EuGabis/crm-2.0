# Google Ads (Visão geral, somente leitura) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Espelhar a tela "Visão geral" do Google Ads (KPIs Cliques/Conversões/Custo-conv./Custo + gráfico + tabela de campanhas) dentro de Marketing → Gerenciador de anúncios, com dados reais da conta conectada via API oficial, somente leitura.

**Architecture:** OAuth por empresa (refresh_token + customer_id guardados por `location_id`, token inacessível ao cliente). Rotas server autenticadas: `oauth/start` e `oauth/callback` conectam a conta; `overview` roda GAQL (`searchStream`) e devolve KPIs/série/campanhas. UI nova na aba de anúncios consome tudo pelo repo `db/google-ads.ts`.

**Tech Stack:** Next.js (App Router) · TypeScript · Supabase (RLS + service-role) · Google Ads API REST (`googleads.googleapis.com`) + OAuth2 (`oauth2.googleapis.com`) · Recharts · Node `crypto` (state HMAC).

## Global Constraints

- **Spec de referência:** `docs/superpowers/specs/2026-08-12-google-ads-design.md`. Convenções: `AGENTS.md`.
- **Migração livre = `0023`** → arquivo `supabase/migrations/0023_google_ads.sql`. Idempotente (`if not exists` / `drop policy if exists`). ⚠️ O outro Claude (Pagamentos) pode pegar `0023` em paralelo — reconciliar no merge (renumerar como foi feito no WhatsApp: 0020→0022).
- **Migrações são aplicadas pelo Gabriel no SQL Editor** — o worker NÃO aplica nem acessa o banco.
- **Sem runner de testes** no projeto: a verificação de cada tarefa é `npx tsc --noEmit` **e** `npm run build` limpos, mais checagens manuais indicadas (curl / leitura estática). Não invente pytest/jest.
- **Segredos nunca `NEXT_PUBLIC_`.** Novas envs: `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_ADS_API_VERSION` (default `v18`). Entram em `.env.local`, `.env.example` e Vercel (valores reais colados pelo Gabriel — o worker só referencia `process.env.*`).
- **Somente leitura.** Nada de mutação na conta Google (sem create/edit/pause). Escopo OAuth `https://www.googleapis.com/auth/adwords`.
- **refresh_token nunca vai ao cliente:** coluna com `revoke select` + leitura só por rotas server com a service-role (`createAdminClient()`).
- **Base UI, não Radix:** triggers com `render={<.../>}`, nunca `asChild`. `SelectValue` recebe children explícito.
- **UI só importa de `src/lib/data/repos/`** — a aba de anúncios fala com as rotas `/api/google-ads/*` **através** do repo `db/google-ads.ts`, nunca `fetch` direto no componente.
- **Multi-tenant:** tabela nova com `location_id`; policies `location_id in (select private.user_locations())` + `revoke ... from anon`.
- **Texto de UI em pt-BR.** Commits em português, `feat(google-ads): ...`. Branch → PR → squash na `main`.
- **Área do Claude B (Marketing/UI).** Não tocar em `src/lib/integrations/guru*`, `db/payment*`, migrações de Pagamentos.
- **As rotas `/api/google-ads/*` ficam no matcher normal do `proxy.ts`** (têm sessão do usuário). NÃO alterar `proxy.ts`.

---

## File Structure

**Criar:**
- `supabase/migrations/0023_google_ads.sql` — tabela `google_ads_connections` + RLS + revoke do token.
- `src/lib/google-ads/client.ts` — cliente REST da Google Ads API + OAuth token exchange/refresh. Server-only.
- `src/lib/google-ads/state.ts` — assinar/validar o `state` do OAuth (HMAC). Server-only.
- `src/app/api/google-ads/oauth/start/route.ts` — monta a URL de consentimento.
- `src/app/api/google-ads/oauth/callback/route.ts` — troca code→tokens, salva a conexão.
- `src/app/api/google-ads/overview/route.ts` — GAQL → `{ kpis, series, campaigns }`.
- `src/lib/data/repos/db/google-ads.ts` — repo (status da conexão + overview + disconnect).
- `src/components/marketing/ads-manager-tab.tsx` — UI (conectar / dashboard).

**Modificar:**
- `src/app/(app)/marketing/page.tsx` — trocar o bloco mock de "Gerenciador de anúncios" por `<AdsManagerTab />` (remover `AD_CAMPAIGNS`, `MiniTable`/`StatusBadge` se ficarem sem uso após a troca — conferir; `MiniTable`/`StatusBadge` são locais desse arquivo).
- `.env.example` — documentar as 4 envs.
- `AGENTS.md` — seção do módulo + próxima migração livre.

---

## Task 1: Migração 0023 (google_ads_connections)

Cria a tabela de conexão por empresa, com RLS membership e proteção do refresh_token. Deliverable: arquivo SQL pronto pro Gabriel aplicar; `tsc`/`build` seguem limpos (sem código novo).

**Files:**
- Create: `supabase/migrations/0023_google_ads.sql`

**Interfaces:**
- Produces: tabela `public.google_ads_connections(id, location_id unique, customer_id, login_customer_id, refresh_token, connected_email, currency_code, connected_at, active, created_at, updated_at)`; coluna `refresh_token` sem `select` para anon/authenticated.

- [ ] **Step 1: Escrever a migração**

Create `supabase/migrations/0023_google_ads.sql`:

```sql
-- ============================================================
-- Lito CRM — Google Ads (Visão geral, somente leitura)
--
-- Conexão OAuth por empresa: guarda refresh_token + customer_id para ler a conta
-- via API. O refresh_token é SEGREDO: coluna com `revoke select` de anon/authenticated;
-- só as rotas server (service-role) leem. Demais colunas (status) os membros leem.
-- Padrão multi-tenant: RLS membership, revoke do anon. Idempotente.
-- ============================================================
set check_function_bodies = off;

create table if not exists public.google_ads_connections (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations (id) on delete cascade,
  customer_id text not null,               -- id da conta Google Ads (sem hífens)
  login_customer_id text,                  -- id da MCC quando aplicável (nulo p/ conta direta)
  refresh_token text not null,             -- SEGREDO (coluna revogada abaixo)
  connected_email text not null default '',
  currency_code text not null default 'BRL',
  connected_at timestamptz not null default now(),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (location_id)
);

alter table public.google_ads_connections enable row level security;
revoke all on public.google_ads_connections from anon;

drop policy if exists "membros leem conexao google ads" on public.google_ads_connections;
create policy "membros leem conexao google ads" on public.google_ads_connections
  for select to authenticated
  using (location_id in (select private.user_locations()));

drop policy if exists "membros criam conexao google ads" on public.google_ads_connections;
create policy "membros criam conexao google ads" on public.google_ads_connections
  for insert to authenticated
  with check (location_id in (select private.user_locations()));

drop policy if exists "membros atualizam conexao google ads" on public.google_ads_connections;
create policy "membros atualizam conexao google ads" on public.google_ads_connections
  for update to authenticated
  using (location_id in (select private.user_locations()))
  with check (location_id in (select private.user_locations()));

drop policy if exists "membros excluem conexao google ads" on public.google_ads_connections;
create policy "membros excluem conexao google ads" on public.google_ads_connections
  for delete to authenticated
  using (location_id in (select private.user_locations()));

-- Segredo: membros NÃO podem ler o refresh_token (só as rotas server com service-role).
revoke select (refresh_token) on public.google_ads_connections from anon, authenticated;

drop trigger if exists google_ads_connections_updated_at on public.google_ads_connections;
create trigger google_ads_connections_updated_at
  before update on public.google_ads_connections
  for each row execute function private.set_updated_at();
```

- [ ] **Step 2: Aplicação (Gabriel)**

Pedir ao Gabriel para rodar `supabase/migrations/0023_google_ads.sql` no SQL Editor. (O worker não aplica.)

- [ ] **Step 3: Verificar build**

Run: `npx tsc --noEmit && npm run build`
Expected: sem erros (nenhum código novo ainda; só confirma que nada quebrou).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0023_google_ads.sql
git commit -m "feat(google-ads): migração 0023 (google_ads_connections + RLS + segredo protegido)"
```

---

## Task 2: Cliente Google Ads + OAuth token exchange

Módulo server-only que fala com o Google (REST da Ads API + endpoints OAuth de token). Deliverable: compila; assinaturas batem com o que as rotas consomem.

**Files:**
- Create: `src/lib/google-ads/client.ts`

**Interfaces:**
- Produces:
  - `exchangeCode(code: string, redirectUri: string): Promise<{ refreshToken: string; accessToken: string }>`
  - `refreshAccessToken(refreshToken: string): Promise<string>`
  - `listAccessibleCustomers(accessToken: string): Promise<string[]>` (ids sem hífens)
  - `getCustomerInfo(customerId: string, loginCustomerId: string | null, accessToken: string): Promise<{ name: string; currencyCode: string }>`
  - `search(customerId: string, loginCustomerId: string | null, accessToken: string, gaql: string): Promise<any[]>`

- [ ] **Step 1: Escrever o cliente**

Create `src/lib/google-ads/client.ts`:

```ts
/**
 * Cliente da Google Ads API + troca/refresh de token OAuth. SERVER-ONLY:
 * usa GOOGLE_ADS_DEVELOPER_TOKEN / GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET,
 * que nunca podem ir ao cliente. Somente leitura (escopo adwords).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

const API_VERSION = process.env.GOOGLE_ADS_API_VERSION || "v18";
const ADS_BASE = `https://googleads.googleapis.com/${API_VERSION}`;
const TOKEN_URL = "https://oauth2.googleapis.com/token";

function oauthCreds() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("OAuth do Google não configurado no servidor");
  return { clientId, clientSecret };
}

function devToken(): string {
  const t = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!t) throw new Error("GOOGLE_ADS_DEVELOPER_TOKEN ausente no servidor");
  return t;
}

export async function exchangeCode(
  code: string,
  redirectUri: string,
): Promise<{ refreshToken: string; accessToken: string }> {
  const { clientId, clientSecret } = oauthCreds();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error_description || json?.error || `OAuth ${res.status}`);
  if (!json.refresh_token) {
    throw new Error("O Google não retornou refresh_token (revogue o acesso e reconecte com prompt=consent)");
  }
  return { refreshToken: json.refresh_token, accessToken: json.access_token };
}

export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const { clientId, clientSecret } = oauthCreds();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    throw new Error(json?.error_description || json?.error || `Falha ao renovar token (${res.status})`);
  }
  return json.access_token;
}

function adsHeaders(accessToken: string, loginCustomerId: string | null): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "developer-token": devToken(),
    "Content-Type": "application/json",
  };
  if (loginCustomerId) h["login-customer-id"] = loginCustomerId;
  return h;
}

export async function listAccessibleCustomers(accessToken: string): Promise<string[]> {
  const res = await fetch(`${ADS_BASE}/customers:listAccessibleCustomers`, {
    method: "GET",
    headers: adsHeaders(accessToken, null),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message || `Google Ads ${res.status}`);
  // resourceNames: ["customers/1234567890", ...] → ["1234567890", ...]
  return (json.resourceNames ?? []).map((r: string) => r.split("/")[1]).filter(Boolean);
}

export async function search(
  customerId: string,
  loginCustomerId: string | null,
  accessToken: string,
  gaql: string,
): Promise<any[]> {
  const res = await fetch(`${ADS_BASE}/customers/${customerId}/googleAds:searchStream`, {
    method: "POST",
    headers: adsHeaders(accessToken, loginCustomerId),
    body: JSON.stringify({ query: gaql }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = Array.isArray(json) ? json[0]?.error?.message : json?.error?.message;
    throw new Error(msg || `Google Ads ${res.status}`);
  }
  // searchStream devolve um array de batches, cada um com { results: [...] }
  const batches: any[] = Array.isArray(json) ? json : [json];
  return batches.flatMap((b) => b.results ?? []);
}

export async function getCustomerInfo(
  customerId: string,
  loginCustomerId: string | null,
  accessToken: string,
): Promise<{ name: string; currencyCode: string }> {
  const rows = await search(
    customerId,
    loginCustomerId,
    accessToken,
    "SELECT customer.descriptive_name, customer.currency_code FROM customer LIMIT 1",
  );
  const c = rows[0]?.customer ?? {};
  return { name: c.descriptiveName ?? "", currencyCode: c.currencyCode ?? "BRL" };
}
```

- [ ] **Step 2: Verificar build**

Run: `npx tsc --noEmit && npm run build`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add src/lib/google-ads/client.ts
git commit -m "feat(google-ads): cliente da Ads API + troca/refresh de token OAuth"
```

---

## Task 3: OAuth (start + callback) + assinatura do state

Conecta a conta: `start` manda pro consentimento; `callback` troca o code, pega a primeira conta e salva a conexão. Deliverable: build limpo; `start` sem sessão → 401 (ou redirect ao login pelo proxy).

**Files:**
- Create: `src/lib/google-ads/state.ts`
- Create: `src/app/api/google-ads/oauth/start/route.ts`
- Create: `src/app/api/google-ads/oauth/callback/route.ts`

**Interfaces:**
- Consumes: `exchangeCode`, `listAccessibleCustomers`, `getCustomerInfo` (Task 2); `createClient` de `@/lib/supabase/server`; `createAdminClient` de `@/lib/supabase/admin`.
- Produces: efeito no banco (upsert em `google_ads_connections`); redireciona para `/marketing?tab=ads&connected=1` (ou `&error=`).

- [ ] **Step 1: Helper de state (HMAC)**

Create `src/lib/google-ads/state.ts`:

```ts
import crypto from "crypto";

/** Assina/valida o `state` do OAuth (anti-CSRF). HMAC com o client secret do OAuth. */
function secret(): string {
  const s = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!s) throw new Error("GOOGLE_OAUTH_CLIENT_SECRET ausente no servidor");
  return s;
}

const MAX_AGE_MS = 10 * 60 * 1000;

export function signState(): string {
  const payload = `${crypto.randomBytes(8).toString("hex")}.${Date.now()}`;
  const sig = crypto.createHmac("sha256", secret()).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

export function verifyState(state: string | null): boolean {
  if (!state) return false;
  const i = state.lastIndexOf(".");
  if (i < 0) return false;
  const payload = state.slice(0, i);
  const sig = state.slice(i + 1);
  const expected = crypto.createHmac("sha256", secret()).update(payload).digest("hex");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  const ts = Number(payload.split(".")[1]);
  return Number.isFinite(ts) && Date.now() - ts < MAX_AGE_MS;
}

export function redirectUri(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/api/google-ads/oauth/callback`;
}
```

- [ ] **Step 2: Rota start**

Create `src/app/api/google-ads/oauth/start/route.ts`:

```ts
import { createClient } from "@/lib/supabase/server";
import { redirectUri, signState } from "@/lib/google-ads/state";

export const dynamic = "force-dynamic";

/** Monta a URL de consentimento do Google e redireciona o usuário. Autenticada. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Não autenticado" }, { status: 401 });

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) return Response.json({ error: "OAuth do Google não configurado" }, { status: 503 });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: "https://www.googleapis.com/auth/adwords",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: signState(),
  });
  return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, 302);
}
```

- [ ] **Step 3: Rota callback**

Create `src/app/api/google-ads/oauth/callback/route.ts`:

```ts
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { exchangeCode, getCustomerInfo, listAccessibleCustomers } from "@/lib/google-ads/client";
import { redirectUri, verifyState } from "@/lib/google-ads/state";

/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = "force-dynamic";

function back(base: string, params: string) {
  return Response.redirect(`${base.replace(/\/$/, "")}/marketing?tab=ads&${params}`, 302);
}

/** Recebe o code do Google, troca por tokens, pega a 1ª conta e salva a conexão. */
export async function GET(request: Request) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) return back(appUrl, `error=${encodeURIComponent(oauthError)}`);
  if (!verifyState(state)) return back(appUrl, "error=state_invalido");
  if (!code) return back(appUrl, "error=sem_code");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return back(appUrl, "error=nao_autenticado");

  // location da sessão (mesma consulta usada nos repos: membership)
  const { data: membership } = await supabase
    .from("location_members")
    .select("location_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  const locationId = (membership as any)?.location_id;
  if (!locationId) return back(appUrl, "error=sem_empresa");

  try {
    const { refreshToken, accessToken } = await exchangeCode(code, redirectUri());
    const customers = await listAccessibleCustomers(accessToken);
    if (customers.length === 0) return back(appUrl, "error=nenhuma_conta");
    const customerId = customers[0]; // decisão: primeira conta acessível
    const info = await getCustomerInfo(customerId, null, accessToken);

    const admin = createAdminClient();
    const { error } = await admin.from("google_ads_connections").upsert(
      {
        location_id: locationId,
        customer_id: customerId,
        login_customer_id: null,
        refresh_token: refreshToken,
        connected_email: user.email ?? "",
        currency_code: info.currencyCode || "BRL",
        connected_at: new Date().toISOString(),
        active: true,
      },
      { onConflict: "location_id" },
    );
    if (error) return back(appUrl, `error=${encodeURIComponent(error.message)}`);
    return back(appUrl, "connected=1");
  } catch (e) {
    return back(appUrl, `error=${encodeURIComponent(e instanceof Error ? e.message : "falha")}`);
  }
}
```

> Nota: o repo `db/contacts.ts` já resolve `location_id` da sessão; aqui usamos a
> consulta direta a `location_members` para não acoplar a rota ao store client.
> Se o projeto tiver um helper server para isso, use-o em vez da consulta inline
> (conferir `src/lib/supabase/` e como outras rotas server obtêm a location).

- [ ] **Step 4: Verificar build + auth gate**

Run: `npx tsc --noEmit && npm run build`
Expected: sem erros; rotas `/api/google-ads/oauth/start` e `/callback` aparecem no manifesto.

Estático: sem sessão, `start` retorna 401 (ou o proxy redireciona ao login antes — ambos aceitáveis). Não é possível testar o fluxo Google completo sem credenciais (fica pra Task 7/handoff com a conta de teste).

- [ ] **Step 5: Commit**

```bash
git add src/lib/google-ads/state.ts "src/app/api/google-ads/oauth/start/route.ts" "src/app/api/google-ads/oauth/callback/route.ts"
git commit -m "feat(google-ads): OAuth (start + callback) com state assinado e conexão por empresa"
```

---

## Task 4: Rota de overview (GAQL → KPIs/série/campanhas)

Lê a conta conectada e devolve os dados da Visão geral. Deliverable: build limpo; sem sessão → 401; sem conexão → `{ connected:false }`.

**Files:**
- Create: `src/app/api/google-ads/overview/route.ts`

**Interfaces:**
- Consumes: `refreshAccessToken`, `search` (Task 2); `createClient` (sessão), `createAdminClient` (ler refresh_token).
- Produces (contrato HTTP consumido pelo repo na Task 5): `GET /api/google-ads/overview?from=YYYY-MM-DD&to=YYYY-MM-DD` →
  `200 { connected:false }` (sem conexão) |
  `200 { connected:true, currency, kpis:{clicks,conversions,cost,costPerConv}, series:[{date,clicks,conversions,cost}], campaigns:[{name,status,clicks,conversions,cost,costPerConv}] }` |
  `401` (sem sessão) | `502 { error }` (falha na Ads API).

- [ ] **Step 1: Escrever a rota**

Create `src/app/api/google-ads/overview/route.ts`:

```ts
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { refreshAccessToken, search } from "@/lib/google-ads/client";

/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = "force-dynamic";

const MICROS = 1_000_000;

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
// GAQL usa datas 'YYYY-MM-DD'; sanitiza para evitar injeção no BETWEEN.
function safeDate(v: string | null, fallback: string): string {
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : fallback;
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Não autenticado" }, { status: 401 });

  // status (colunas não-secretas) via RLS
  const { data: conn } = await supabase
    .from("google_ads_connections")
    .select("customer_id, login_customer_id, currency_code, active")
    .maybeSingle();
  if (!conn || !conn.active) return Response.json({ connected: false });

  // refresh_token só via service-role (coluna revogada para o cliente)
  const admin = createAdminClient();
  const { data: secretRow } = await admin
    .from("google_ads_connections")
    .select("refresh_token, location_id")
    .eq("customer_id", conn.customer_id)
    .maybeSingle();
  if (!secretRow?.refresh_token) return Response.json({ connected: false });

  const url = new URL(request.url);
  const from = safeDate(url.searchParams.get("from"), isoDaysAgo(30));
  const to = safeDate(url.searchParams.get("to"), todayIso());

  try {
    const accessToken = await refreshAccessToken(secretRow.refresh_token);
    const login = conn.login_customer_id ?? null;

    const seriesRows = await search(
      conn.customer_id,
      login,
      accessToken,
      `SELECT segments.date, metrics.clicks, metrics.conversions, metrics.cost_micros
       FROM customer WHERE segments.date BETWEEN '${from}' AND '${to}' ORDER BY segments.date`,
    );
    const series = seriesRows.map((r: any) => ({
      date: r.segments?.date,
      clicks: Number(r.metrics?.clicks ?? 0),
      conversions: Number(r.metrics?.conversions ?? 0),
      cost: Number(r.metrics?.costMicros ?? 0) / MICROS,
    }));
    const kpisAgg = series.reduce(
      (a, s) => ({ clicks: a.clicks + s.clicks, conversions: a.conversions + s.conversions, cost: a.cost + s.cost }),
      { clicks: 0, conversions: 0, cost: 0 },
    );
    const kpis = {
      ...kpisAgg,
      costPerConv: kpisAgg.conversions > 0 ? kpisAgg.cost / kpisAgg.conversions : 0,
    };

    const campRows = await search(
      conn.customer_id,
      login,
      accessToken,
      `SELECT campaign.name, campaign.status, metrics.clicks, metrics.conversions, metrics.cost_micros
       FROM campaign WHERE segments.date BETWEEN '${from}' AND '${to}' ORDER BY metrics.cost_micros DESC`,
    );
    const campaigns = campRows.map((r: any) => {
      const cost = Number(r.metrics?.costMicros ?? 0) / MICROS;
      const conversions = Number(r.metrics?.conversions ?? 0);
      return {
        name: r.campaign?.name ?? "",
        status: r.campaign?.status ?? "",
        clicks: Number(r.metrics?.clicks ?? 0),
        conversions,
        cost,
        costPerConv: conversions > 0 ? cost / conversions : 0,
      };
    });

    return Response.json({ connected: true, currency: conn.currency_code || "BRL", kpis, series, campaigns });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Falha na Google Ads API" },
      { status: 502 },
    );
  }
}
```

- [ ] **Step 2: Verificar build + auth gate**

Run: `npx tsc --noEmit && npm run build`
Expected: sem erros.

Com `npm run dev` (sem login): `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/google-ads/overview` → 401 (ou redirect do proxy). Não gaste mais de uma tentativa subindo o dev server; o gate obrigatório é tsc + build.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/google-ads/overview/route.ts"
git commit -m "feat(google-ads): rota de overview (GAQL: KPIs, série diária, campanhas)"
```

---

## Task 5: Repo `db/google-ads.ts`

Fronteira que a UI usa: status da conexão (Supabase RLS) + overview/disconnect (rotas). Deliverable: build limpo; exports batendo com a UI da Task 6.

**Files:**
- Create: `src/lib/data/repos/db/google-ads.ts`

**Interfaces:**
- Consumes: `createClient` de `@/lib/supabase/client`; `useDbStore` de `./contacts` (guard de load/locationId); contrato HTTP da Task 4.
- Produces:
  - type `GoogleAdsConnection = { customerId: string; connectedEmail: string; currencyCode: string; connectedAt: string; active: boolean }`
  - type `OverviewData = { currency: string; kpis: { clicks: number; conversions: number; cost: number; costPerConv: number }; series: { date: string; clicks: number; conversions: number; cost: number }[]; campaigns: { name: string; status: string; clicks: number; conversions: number; cost: number; costPerConv: number }[] }`
  - `useGoogleAdsConnection(): { connection: GoogleAdsConnection | null; ready: boolean }`
  - `googleAdsActions.overview(from: string, to: string): Promise<{ connected: boolean; data?: OverviewData; error?: string }>`
  - `googleAdsActions.disconnect(): Promise<boolean>`
  - `googleAdsActions.startConnectPath(): string` (retorna `"/api/google-ads/oauth/start"`)

- [ ] **Step 1: Escrever o repo**

Create `src/lib/data/repos/db/google-ads.ts`:

```ts
"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { createClient } from "@/lib/supabase/client";
import { useDbStore } from "./contacts";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface GoogleAdsConnection {
  customerId: string;
  connectedEmail: string;
  currencyCode: string;
  connectedAt: string;
  active: boolean;
}

export interface OverviewData {
  currency: string;
  kpis: { clicks: number; conversions: number; cost: number; costPerConv: number };
  series: { date: string; clicks: number; conversions: number; cost: number }[];
  campaigns: {
    name: string;
    status: string;
    clicks: number;
    conversions: number;
    cost: number;
    costPerConv: number;
  }[];
}

interface ConnState {
  loaded: boolean;
  loading: boolean;
  connection: GoogleAdsConnection | null;
  load: () => Promise<void>;
  set: (connection: GoogleAdsConnection | null) => void;
}

const useConnStore = create<ConnState>((setState, get) => ({
  loaded: false,
  loading: false,
  connection: null,
  set: (connection) => setState({ connection }),
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
      .from("google_ads_connections")
      .select("customer_id, connected_email, currency_code, connected_at, active")
      .eq("location_id", locationId)
      .maybeSingle();
    setState({
      loaded: true,
      loading: false,
      connection: data
        ? {
            customerId: (data as any).customer_id,
            connectedEmail: (data as any).connected_email ?? "",
            currencyCode: (data as any).currency_code ?? "BRL",
            connectedAt: (data as any).connected_at,
            active: (data as any).active,
          }
        : null,
    });
  },
}));

export function useGoogleAdsConnection() {
  const { connection, loaded, loading, load } = useConnStore();
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { connection, ready: loaded && !loading };
}

export const googleAdsActions = {
  startConnectPath(): string {
    return "/api/google-ads/oauth/start";
  },

  async overview(
    from: string,
    to: string,
  ): Promise<{ connected: boolean; data?: OverviewData; error?: string }> {
    const res = await fetch(
      `/api/google-ads/overview?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    );
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { connected: false, error: json?.error ?? "Falha ao carregar" };
    if (!json.connected) return { connected: false };
    return { connected: true, data: json as OverviewData };
  },

  async disconnect(): Promise<boolean> {
    const locationId = useDbStore.getState().locationId;
    if (!locationId) return false;
    const supabase = createClient();
    const { error } = await supabase
      .from("google_ads_connections")
      .delete()
      .eq("location_id", locationId);
    if (error) return false;
    useConnStore.getState().set(null);
    return true;
  },
};
```

- [ ] **Step 2: Verificar build**

Run: `npx tsc --noEmit && npm run build`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add src/lib/data/repos/db/google-ads.ts
git commit -m "feat(google-ads): repo db (status da conexão + overview + disconnect)"
```

---

## Task 6: UI — aba Gerenciador de anúncios (Google Ads)

Troca o mock pela tela real: conectar / dashboard (KPIs + gráfico + tabela). Deliverable: build limpo; renderiza o estado "conectar" e, mockando a resposta, o dashboard.

**Files:**
- Create: `src/components/marketing/ads-manager-tab.tsx`
- Modify: `src/app/(app)/marketing/page.tsx`

**Interfaces:**
- Consumes: `useGoogleAdsConnection`, `googleAdsActions`, `OverviewData` de `@/lib/data/repos/db/google-ads`; `KpiCard` de `@/components/shared/kpi-card` (props `{ label, value: string, hint? }`); Recharts (seguir o padrão de `src/components/dashboard/opportunity-widgets.tsx`); `formatBRL` de `@/lib/data/repos/opportunities`.

- [ ] **Step 1: Componente da aba**

Create `src/components/marketing/ads-manager-tab.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/shared/kpi-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import {
  googleAdsActions,
  useGoogleAdsConnection,
  type OverviewData,
} from "@/lib/data/repos/db/google-ads";
import { Megaphone } from "lucide-react";

const PERIODS: { label: string; days: number }[] = [
  { label: "7 dias", days: 7 },
  { label: "30 dias", days: 30 },
  { label: "90 dias", days: 90 },
];

function isoDaysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
function fmtMoney(v: number, currency: string) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: currency || "BRL" }).format(v);
}
function fmtNum(v: number) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(v);
}

export function AdsManagerTab() {
  const { connection, ready } = useGoogleAdsConnection();
  const [days, setDays] = useState(30);
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(false);

  // toast de retorno do OAuth (?connected=1 / ?error=)
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get("connected") === "1") toast.success("Google Ads conectado");
    const err = p.get("error");
    if (err) toast.error(`Falha ao conectar: ${decodeURIComponent(err)}`);
  }, []);

  const fetchOverview = useCallback(async () => {
    setLoading(true);
    const res = await googleAdsActions.overview(isoDaysAgo(days), todayIso());
    setLoading(false);
    if (res.connected && res.data) setData(res.data);
    else if (res.error) toast.error(res.error);
  }, [days]);

  useEffect(() => {
    if (connection) void fetchOverview();
  }, [connection, fetchOverview]);

  if (!ready) return <p className="text-xs text-slate-400">Carregando…</p>;

  if (!connection) {
    return (
      <EmptyState
        icon={Megaphone}
        title="Conecte sua conta do Google Ads"
        description="Veja Cliques, Conversões, Custo e suas campanhas direto no CRM (somente leitura)."
        cta={
          <Button
            size="sm"
            className="h-8 text-xs"
            onClick={() => {
              window.location.href = googleAdsActions.startConnectPath();
            }}
          >
            Conectar Google Ads
          </Button>
        }
      />
    );
  }

  const currency = data?.currency ?? connection.currencyCode ?? "BRL";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Gerenciador de anúncios</h1>
          <p className="text-xs text-slate-500">
            Google Ads · {connection.connectedEmail || connection.customerId}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {PERIODS.map((p) => (
            <button
              key={p.days}
              onClick={() => setDays(p.days)}
              className={
                p.days === days
                  ? "rounded-md bg-indigo-100 px-2.5 py-1 text-[11px] font-semibold text-indigo-700"
                  : "rounded-md px-2.5 py-1 text-[11px] text-slate-500 hover:bg-slate-100"
              }
            >
              {p.label}
            </button>
          ))}
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={async () => {
              if (await googleAdsActions.disconnect()) toast.success("Google Ads desconectado");
            }}
          >
            Desconectar
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <KpiCard label="Cliques" value={data ? fmtNum(data.kpis.clicks) : "—"} />
        <KpiCard label="Conversões" value={data ? fmtNum(data.kpis.conversions) : "—"} />
        <KpiCard label="Custo / conv." value={data ? fmtMoney(data.kpis.costPerConv, currency) : "—"} />
        <KpiCard label="Custo" value={data ? fmtMoney(data.kpis.cost, currency) : "—"} />
      </div>

      <div className="rounded-xl border bg-white p-4">
        <p className="mb-2 text-xs font-semibold text-slate-700">Cliques × Conversões</p>
        <div className="h-64">
          {data && data.series.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.series} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Line type="monotone" dataKey="clicks" name="Cliques" stroke="#6366f1" dot={false} />
                <Line type="monotone" dataKey="conversions" name="Conversões" stroke="#ef4444" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-slate-400">
              {loading ? "Carregando…" : "Sem dados no período"}
            </div>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b text-[11px] text-slate-400">
              {["Campanha", "Status", "Cliques", "Conversões", "Custo", "Custo/conv."].map((h) => (
                <th key={h} className="whitespace-nowrap px-4 py-2.5 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(data?.campaigns ?? []).map((c, i) => (
              <tr key={i} className="border-b last:border-0">
                <td className="px-4 py-2.5 font-medium text-slate-800">{c.name}</td>
                <td className="px-4 py-2.5">
                  <Badge variant="secondary" className={c.status === "ENABLED" ? "bg-emerald-100 text-emerald-700" : ""}>
                    {c.status}
                  </Badge>
                </td>
                <td className="px-4 py-2.5 text-slate-500">{fmtNum(c.clicks)}</td>
                <td className="px-4 py-2.5 text-slate-500">{fmtNum(c.conversions)}</td>
                <td className="px-4 py-2.5 text-slate-500">{fmtMoney(c.cost, currency)}</td>
                <td className="px-4 py-2.5 text-slate-500">{fmtMoney(c.costPerConv, currency)}</td>
              </tr>
            ))}
            {data && data.campaigns.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                  Nenhuma campanha no período
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Ligar na página do Marketing**

In `src/app/(app)/marketing/page.tsx`:
- Add import: `import { AdsManagerTab } from "@/components/marketing/ads-manager-tab";`
- Replace the whole `{tab === "Gerenciador de anúncios" && ( ... )}` block (the `<>...</>` with the mock `<div>` header + KpiCards + `MiniTable`) with:
  ```tsx
  {tab === "Gerenciador de anúncios" && <AdsManagerTab />}
  ```
- Remove the now-unused mock constants/helpers in this file **only if they became unused**: `AD_CAMPAIGNS`, `GOOD_STATUSES`, `StatusBadge`, `MiniTable`, and the `Plus`/`toast`/`KpiCard`/`Badge`/`formatBRL` imports **iff** no other tab uses them. Verify by search before deleting; if any is still referenced, leave it. (The goal is no unused-symbol lint/type errors.)

- [ ] **Step 3: Verificar build + browser**

Run: `npx tsc --noEmit && npm run build`
Expected: sem erros; sem símbolos não usados.

Browser (workflow do preview): abrir `/marketing` → aba "Gerenciador de anúncios" → sem conexão deve mostrar o empty state "Conectar Google Ads". (O fluxo OAuth real depende das envs/conta de teste — Task 7/handoff.) Conferir `read_console_messages` sem erros.

- [ ] **Step 4: Commit**

```bash
git add src/components/marketing/ads-manager-tab.tsx "src/app/(app)/marketing/page.tsx"
git commit -m "feat(google-ads): aba Gerenciador de anúncios real (conectar + KPIs + gráfico + campanhas)"
```

---

## Task 7: Envs + docs

Documenta as envs e o módulo. Deliverable: build limpo; `.env.example` + `AGENTS.md` atualizados. (Passos operacionais — GCP, developer token, deploy — ficam no handoff, não aqui.)

**Files:**
- Modify: `.env.example`
- Modify: `AGENTS.md`

- [ ] **Step 1: Envs de exemplo**

In `.env.example`, acrescentar (sem valores):
```
# Google Ads (API oficial — Gerenciador de anúncios)
GOOGLE_ADS_DEVELOPER_TOKEN=
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_ADS_API_VERSION=v18
```

- [ ] **Step 2: Doc do módulo no AGENTS.md**

In `AGENTS.md`, adicionar uma seção concisa (pt-BR, no tom do arquivo) do módulo Google Ads e atualizar a nota de "próxima migração livre" para **0024**. Conteúdo a refletir (bater com o código):
- Arquitetura: OAuth por empresa (`/api/google-ads/oauth/start|callback`), overview em `/api/google-ads/overview` (GAQL `searchStream`, somente leitura); token guardado por `location_id`, **inacessível ao cliente** (coluna `refresh_token` revogada; só service-role lê).
- Dados: migração `0023_google_ads.sql` (`google_ads_connections`).
- Cliente `src/lib/google-ads/client.ts`, repo `src/lib/data/repos/db/google-ads.ts`, UI `src/components/marketing/ads-manager-tab.tsx` (aba Gerenciador de anúncios).
- Envs (nunca `NEXT_PUBLIC_`): `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_ADS_API_VERSION`.
- Passos manuais (Gabriel): GCP (ativar Google Ads API + tela de consentimento + OAuth client Web com os redirects); developer token na MCC (test account imediato, Basic access p/ produção); envs na Vercel.

- [ ] **Step 3: Verificar build**

Run: `npx tsc --noEmit && npm run build`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add .env.example AGENTS.md
git commit -m "docs(google-ads): envs, seção do módulo e próxima migração livre 0024"
```

---

## Handoff operacional (Gabriel — fora do código)

1. **Google Cloud:** criar projeto → ativar **Google Ads API** → **tela de consentimento OAuth** (External; escopo `.../auth/adwords`; adicionar seu e-mail como test user enquanto não verificado) → **OAuth client (Web)** com redirects `http://localhost:3000/api/google-ads/oauth/callback` e `https://lito-crm.vercel.app/api/google-ads/oauth/callback` → copiar Client ID/Secret.
2. **Developer token:** conta administradora (MCC) → API Center → gerar token (acesso a **conta de teste** imediato; solicitar **Basic access** p/ produção).
3. **Conta de teste** (para validar agora): test manager + test client account.
4. **Envs** nas 3 (`.env.local` + Vercel) e **deploy**.
5. Conectar via `/marketing` → Gerenciador de anúncios → **Conectar Google Ads**; validar KPIs/gráfico/campanhas com a conta de teste. Quando o Basic access sair, reconectar apontando pra conta real (sem mudança de código).

## Self-Review (autor do plano)

- **Cobertura da spec:** OAuth por empresa + token protegido → Tasks 1,3; cliente Ads/OAuth → Task 2; overview GAQL (KPIs/série/campanhas, micros→moeda) → Task 4; repo → Task 5; UI (conectar/KPIs/gráfico/tabela/período) → Task 6; envs/docs/manual → Task 7 + handoff; segurança (revoke do token, state assinado, getUser+RLS) → Tasks 1,3,4; "primeira conta" → Task 3; build contra conta de teste → handoff. Não-objetivos (escrita, seleção MCC, outras abas) ficam de fora.
- **Consistência de tipos:** `OverviewData` definido na Task 5 espelha o JSON da Task 4 (`kpis/series/campaigns`, `costMicros`→`cost`); a UI (Task 6) consome `OverviewData` e `googleAdsActions.overview/disconnect/startConnectPath` exatamente como a Task 5 exporta. `google_ads_connections` (colunas snake_case) igual entre migração (Task 1), callback (Task 3), overview (Task 4) e repo (Task 5). `refresh_token` revogado (Task 1) e lido só via service-role (Tasks 3,4).
- **Sem placeholders:** todas as etapas de código têm o código real; verificação por tsc/build/curl (projeto sem runner), explicitado no header.
- **Ponto de atenção deixado explícito:** na Task 3, resolver a `location_id` da sessão (consulta a `location_members`) — se houver helper server no projeto, preferi-lo; instrução dada ao implementador para conferir.
