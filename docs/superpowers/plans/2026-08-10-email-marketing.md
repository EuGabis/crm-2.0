# Email Marketing (real) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar a aba **Marketing → E-mails** real — campanhas que disparam de verdade via Resend em escala, com métricas de abertura/clique e descadastro em conformidade.

**Architecture:** Espelha o motor de Automações. A campanha materializa uma fila de destinatários no Postgres; o `pg_cron` chama `/api/marketing/tick` a cada minuto; a rota envia em lotes de 100 via Resend Batch com a service role e grava status. Um webhook do Resend (verificado por Svix) atualiza métricas; um link assinado faz o unsubscribe.

**Tech Stack:** Supabase (Postgres, RLS, pg_cron, pg_net) · Next.js 16 Route Handlers · @supabase/supabase-js (service role) · Resend (Batch API + webhooks) · svix · @tiptap/react · Zustand/shadcn (Base UI).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-10-email-marketing-design.md`. Convenções: `AGENTS.md`.
- Texto de UI em **pt-BR**; marca só via `brand` (`src/lib/config/brand.ts`); moeda `formatBRL`.
- Base UI (shadcn): sem `asChild`; `PopoverTrigger`/`DropdownMenuTrigger` usam `render={<Button/>}`; `SelectValue` com children; `onValueChange` recebe `string | null`; `Accordion` sem `type`.
- Zustand: **nunca** filtrar/mapear dentro do selector — selecionar cru e derivar com `useMemo`.
- Páginas são client components (`"use client"`); não passar ícone Lucide de Server→Client.
- Toda tabela nova: `location_id` + RLS habilitada + `revoke ... from anon` + políticas `TO authenticated` via `private.user_locations()`. Funções em `private` são `security definer set search_path = ''` (referências schema-qualificadas).
- Segredos (`RESEND_WEBHOOK_SECRET`) **nunca** com prefixo `NEXT_PUBLIC_`; adicionar em `.env.local`, `.env.example` e Vercel. Reuso de `AUTOMATION_SECRET` para o tick de marketing e para assinar unsubscribe.
- Remetente padrão: `Lito CRM <nao-responder@news.litoaviation.com>` (env `EMAIL_FROM`).
- Migrações: arquivo novo em `supabase/migrations/00NN_nome.sql`, aplicado pelo usuário no SQL Editor.
- Cada tarefa termina com `npm run build` limpo + commit em português (`feat(marketing): ...`).
- Estilo: h1 `text-lg font-bold text-slate-900`; cards `rounded-xl border bg-white`; tabelas `text-xs`; botões `h-8 text-xs`; badge sucesso `bg-emerald-100 text-emerald-700`; primário indigo.

## File Structure

- `supabase/migrations/0010_email_marketing.sql` — tabelas, coluna, RLS, funções DB.
- `supabase/migrations/0011_marketing_cron.sql` — pg_cron do tick de marketing.
- `src/lib/email/marketing-template.ts` — shell HTML da marca p/ campanha + rodapé/unsubscribe.
- `src/lib/marketing/unsubscribe.ts` — assinar/verificar HMAC do link de unsubscribe.
- `src/lib/marketing/types.ts` — tipos compartilhados (Campaign, Recipient, Audience).
- `src/lib/marketing/engine.ts` — `processDueCampaigns()` (envio em lote via Resend Batch).
- `src/app/api/marketing/tick/route.ts` — tick protegido.
- `src/app/api/marketing/campaigns/[id]/send/route.ts` — publicar/agendar (autenticada).
- `src/app/api/marketing/campaigns/[id]/test/route.ts` — enviar teste pro próprio usuário.
- `src/app/api/marketing/resend-webhook/route.ts` — webhook Resend (Svix).
- `src/app/api/marketing/unsubscribe/route.ts` — descadastro (HMAC) + página de confirmação.
- `src/lib/data/repos/db/campaigns.ts` — repo Zustand (campanhas + destinatários).
- `src/components/marketing/campaigns-tab.tsx` — lista (substitui o mock da aba E-mails).
- `src/components/marketing/campaign-composer.tsx` — composer Tiptap + público + prévia.
- `src/components/marketing/rich-text-editor.tsx` — wrapper do Tiptap.
- `src/components/marketing/campaign-templates.ts` — 3–4 modelos prontos.
- `src/components/marketing/campaign-detail.tsx` — KPIs + tabela de destinatários.
- Modify: `src/proxy.ts` (matcher), `src/app/(app)/marketing/page.tsx` (aba E-mails real), `.env.example`, `AGENTS.md`.

**Verificação:** este repo não tem test runner. Cada tarefa verifica com `npm run build` limpo, aplicação no SQL Editor (migrações), `curl` local (rotas) e conferência na UI (dev server na porta atual). Sem inventar framework de teste.

---

### Task 1: Migração 0010 — schema do email marketing

**Files:**
- Create: `supabase/migrations/0010_email_marketing.sql`

**Interfaces:**
- Produces: tabelas `public.email_campaigns`, `public.email_campaign_recipients`; coluna `public.contacts.marketing_opt_out`; funções `private.materialize_recipients(uuid)`, `private.apply_email_event(text, text, timestamptz)`.

- [ ] **Step 1: Escrever a migração** seguindo o padrão da `0007`/`0001`.

```sql
-- ============================================================
-- Lito CRM — Email Marketing (schema)
-- Rode este arquivo inteiro de uma vez no SQL Editor.
-- ============================================================
set check_function_bodies = off;

alter table public.contacts
  add column if not exists marketing_opt_out boolean not null default false;

create table if not exists public.email_campaigns (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations (id) on delete cascade,
  name text not null,
  subject text not null default '',
  from_email text not null default 'Lito CRM <nao-responder@news.litoaviation.com>',
  reply_to text,
  body_html text not null default '',
  body_text text not null default '',
  audience jsonb not null default '{"type":"all","value":null}',
  status text not null default 'draft'
    check (status in ('draft','scheduled','sending','sent','paused','failed')),
  scheduled_at timestamptz,
  total int not null default 0,
  sent int not null default 0,
  delivered int not null default 0,
  opened int not null default 0,
  clicked int not null default 0,
  bounced int not null default 0,
  failed int not null default 0,
  unsubscribed int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.email_campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.email_campaigns (id) on delete cascade,
  location_id uuid not null references public.locations (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  email text not null,
  status text not null default 'pending'
    check (status in ('pending','sent','delivered','opened','clicked','bounced','failed','skipped')),
  resend_id text,
  error text,
  sent_at timestamptz,
  delivered_at timestamptz,
  opened_at timestamptz,
  clicked_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists ecr_campaign_contact_uniq
  on public.email_campaign_recipients (campaign_id, contact_id);
create index if not exists ecr_campaign_status_idx
  on public.email_campaign_recipients (campaign_id, status);
create index if not exists ecr_resend_idx
  on public.email_campaign_recipients (resend_id) where resend_id is not null;

alter table public.email_campaigns enable row level security;
alter table public.email_campaign_recipients enable row level security;
revoke all on public.email_campaigns, public.email_campaign_recipients from anon;

create policy "membros gerenciam campanhas" on public.email_campaigns
  for all to authenticated
  using (location_id in (select private.user_locations()))
  with check (location_id in (select private.user_locations()));

create policy "membros leem destinatarios" on public.email_campaign_recipients
  for select to authenticated
  using (location_id in (select private.user_locations()));

-- Materializa a fila a partir do audience (só contatos elegíveis).
create or replace function private.materialize_recipients(p_campaign_id uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare
  camp record;
  aud_type text;
  aud_value text;
  n int;
begin
  select * into camp from public.email_campaigns where id = p_campaign_id;
  if not found then return 0; end if;
  aud_type := camp.audience ->> 'type';
  aud_value := camp.audience ->> 'value';

  insert into public.email_campaign_recipients (campaign_id, location_id, contact_id, email)
  select p_campaign_id, camp.location_id, c.id, c.email
  from public.contacts c
  where c.location_id = camp.location_id
    and c.email is not null and c.email <> ''
    and coalesce(c.marketing_opt_out, false) = false
    and coalesce(c.dnd, false) = false
    and (
      aud_type = 'all'
      or (aud_type = 'tag' and aud_value = any (c.tags))
    )
  on conflict (campaign_id, contact_id) do nothing;
  -- NB: 'smart_list' é no-op aqui — avaliado em TS (matchesConditions) e inserido
  -- via public.add_campaign_recipients. Ver o arquivo real 0010 (add_campaign_recipients,
  -- publish_campaign) — a versão aplicada tem só os branches all/tag.
  select count(*) into n from public.email_campaign_recipients where campaign_id = p_campaign_id;
  update public.email_campaigns set total = n, updated_at = now() where id = p_campaign_id;
  return n;
end;
$$;
revoke all on function private.materialize_recipients(uuid) from public, anon, authenticated;

-- Aplica um evento do Resend (idempotente: nunca regride status nem conta 2x).
create or replace function private.apply_email_event(
  p_resend_id text, p_type text, p_at timestamptz
) returns void language plpgsql security definer set search_path = '' as $$
declare
  r record;
  rank_old int; rank_new int;
  ranks jsonb := '{"sent":1,"delivered":2,"opened":3,"clicked":4}';
begin
  select * into r from public.email_campaign_recipients where resend_id = p_resend_id limit 1;
  if not found then return; end if;

  if p_type in ('delivered','opened','clicked') then
    rank_old := coalesce((ranks ->> r.status)::int, 0);
    rank_new := coalesce((ranks ->> p_type)::int, 0);
    if rank_new > rank_old then
      update public.email_campaign_recipients
        set status = p_type,
            delivered_at = case when p_type='delivered' then p_at else delivered_at end,
            opened_at    = case when p_type='opened'    then p_at else opened_at end,
            clicked_at   = case when p_type='clicked'   then p_at else clicked_at end
        where id = r.id;
      update public.email_campaigns
        set delivered = delivered + (case when p_type='delivered' then 1 else 0 end),
            opened    = opened    + (case when p_type='opened'    then 1 else 0 end),
            clicked   = clicked   + (case when p_type='clicked'   then 1 else 0 end),
            updated_at = now()
        where id = r.campaign_id;
    end if;
  elsif p_type in ('bounced','complained') then
    if r.status <> 'bounced' then
      update public.email_campaign_recipients set status = 'bounced' where id = r.id;
      update public.email_campaigns set bounced = bounced + 1, updated_at = now()
        where id = r.campaign_id;
      update public.contacts set marketing_opt_out = true where id = r.contact_id;
    end if;
  end if;
end;
$$;
revoke all on function private.apply_email_event(text, text, timestamptz) from public, anon, authenticated;

-- Wrapper PÚBLICO chamado pela UI autenticada (checa membership); materializa + publica.
create or replace function public.publish_campaign(
  p_id uuid, p_mode text, p_at timestamptz
) returns public.email_campaigns language plpgsql security definer set search_path = '' as $$
declare
  camp public.email_campaigns;
begin
  select * into camp from public.email_campaigns where id = p_id;
  if not found then raise exception 'campanha inexistente'; end if;
  if camp.location_id not in (select private.user_locations()) then
    raise exception 'sem permissão';
  end if;
  perform private.materialize_recipients(p_id);
  update public.email_campaigns
    set status = case when p_mode = 'scheduled' then 'scheduled' else 'sending' end,
        scheduled_at = case when p_mode = 'scheduled' then p_at else null end,
        updated_at = now()
    where id = p_id
    returning * into camp;
  return camp;
end;
$$;
revoke all on function public.publish_campaign(uuid, text, timestamptz) from anon;
grant execute on function public.publish_campaign(uuid, text, timestamptz) to authenticated;

-- Wrapper PÚBLICO usado só pela service role (webhook) — aplica evento do Resend.
create or replace function public.ingest_email_event(
  p_resend_id text, p_type text, p_at timestamptz
) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.apply_email_event(p_resend_id, p_type, p_at);
end;
$$;
revoke all on function public.ingest_email_event(text, text, timestamptz) from public, anon, authenticated;
```

- [ ] **Step 2: Confirmar nomes de colunas reais** de `contacts` (`dnd`, `tags`, `email`) e `smart_lists` na `0001`/`0002` antes de aplicar. Ajustar se divergir.

Run: `grep -nE "create table public.contacts|dnd|tags|smart_lists" supabase/migrations/0001_initial_schema.sql supabase/migrations/0002_contacts_module.sql`

- [ ] **Step 3: Pedir ao usuário para aplicar no SQL Editor** e verificar.

```sql
select table_name from information_schema.tables
where table_schema='public' and table_name like 'email_campaign%';
-- esperado: email_campaigns, email_campaign_recipients
select column_name from information_schema.columns
where table_name='contacts' and column_name='marketing_opt_out';
```

- [ ] **Step 4: Build + commit**

```bash
npm run build
git add supabase/migrations/0010_email_marketing.sql
git commit -m "feat(marketing): schema de campanhas de e-mail (0010)"
```

---

### Task 2: Template de campanha + assinatura de unsubscribe

**Files:**
- Create: `src/lib/email/marketing-template.ts`, `src/lib/marketing/unsubscribe.ts`
- Reference: `src/lib/email/invite-template.ts` (estilo inline da marca), `src/lib/automations/actions.ts` (`renderTemplate`)

**Interfaces:**
- Produces:
```ts
// unsubscribe.ts
export function signUnsubscribe(contactId: string): string;                 // hmac hex
export function verifyUnsubscribe(contactId: string, sig: string): boolean;
export function unsubscribeUrl(contactId: string, campaignId?: string): string; // usa NEXT_PUBLIC_APP_URL
// marketing-template.ts
export function renderCampaignEmail(opts: {
  subject: string; bodyHtml: string; unsubscribeUrl: string;
}): { html: string; text: string };
```

- [ ] **Step 1: `unsubscribe.ts`** — HMAC com `AUTOMATION_SECRET` (crypto do Node).

```ts
import { createHmac } from "crypto";

const secret = () => process.env.AUTOMATION_SECRET ?? "";

export function signUnsubscribe(contactId: string): string {
  return createHmac("sha256", secret()).update(contactId).digest("hex");
}
export function verifyUnsubscribe(contactId: string, sig: string): boolean {
  if (!sig) return false;
  const expected = signUnsubscribe(contactId);
  return expected.length === sig.length &&
    createHmac("sha256", secret()).update(sig).digest("hex") ===
    createHmac("sha256", secret()).update(expected).digest("hex");
}
export function unsubscribeUrl(contactId: string, campaignId?: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const c = encodeURIComponent(contactId);
  const s = signUnsubscribe(contactId);
  const q = campaignId ? `&campaign=${encodeURIComponent(campaignId)}` : "";
  return `${base}/api/marketing/unsubscribe?c=${c}&s=${s}${q}`;
}
```

- [ ] **Step 2: `marketing-template.ts`** — envolve `bodyHtml` no shell da marca (tabela, inline styles, cor indigo) + rodapé com link de unsubscribe. Espelhar o cabeçalho/estilo do `invite-template.ts`. Versão texto = strip de tags + linha "Para descadastrar: <url>".

- [ ] **Step 3: Build + commit**

```bash
npm run build
git add src/lib/email/marketing-template.ts src/lib/marketing/unsubscribe.ts
git commit -m "feat(marketing): template de campanha e assinatura de unsubscribe"
```

---

### Task 3: Tipos + motor de envio (Resend Batch)

**Files:**
- Create: `src/lib/marketing/types.ts`, `src/lib/marketing/engine.ts`
- Reference: `src/lib/supabase/admin.ts` (`createAdminClient`), `src/lib/automations/actions.ts` (`renderTemplate`)

**Interfaces:**
- Consumes: `createAdminClient()`, `renderTemplate(text, vars)`, `renderCampaignEmail(...)`, `unsubscribeUrl(...)`.
- Produces:
```ts
// types.ts
export type CampaignStatus = "draft"|"scheduled"|"sending"|"sent"|"paused"|"failed";
export type Audience = { type: "all"|"tag"|"smart_list"; value: string|null };
// engine.ts
export async function processDueCampaigns(limit?: number): Promise<{ processed: number; sent: number; errors: number }>;
```

- [ ] **Step 1: `types.ts`** com os tipos acima.

- [ ] **Step 2: `engine.ts` → `processDueCampaigns()`** com a service role:
  1. Promove `scheduled` vencidas (`scheduled_at <= now()`) para `sending`.
  2. Seleciona campanhas `sending` (limite pequeno, ex. 5).
  3. Para cada: pega até **100** recipients `pending` (join com `contacts` p/ montar `vars` = nome/email/custom_fields).
  4. Monta cada e-mail com `renderTemplate(body_html, vars)` → `renderCampaignEmail({subject, bodyHtml, unsubscribeUrl(contactId, campaignId)})`; `tags: [{name:'campaign_id',value}, {name:'recipient_id',value}]`; headers `List-Unsubscribe`.
  5. `resend.batch.send(payloads)`; casa retorno por índice → grava `resend_id` + `status='sent'` + `sent_at`, e `email_campaigns.sent += k`. Falha → `status='failed'` + `error`, `failed += 1`.
  6. Se a campanha não tem mais `pending` → `status='sent'`.
- Respeitar `status='paused'` (não processa). Erros por campanha não derrubam as outras.

- [ ] **Step 3: Build + commit**

```bash
npm run build
git add src/lib/marketing/types.ts src/lib/marketing/engine.ts
git commit -m "feat(marketing): motor de envio em lote via Resend Batch"
```

---

### Task 4: Rota do tick + proxy

**Files:**
- Create: `src/app/api/marketing/tick/route.ts`
- Modify: `src/proxy.ts` (excluir `api/marketing` do matcher, como já é feito com `api/automations`)

**Interfaces:**
- Consumes: `processDueCampaigns()`.

- [ ] **Step 1: Rota** protegida por `x-automation-secret`.

```ts
import { processDueCampaigns } from "@/lib/marketing/engine";
export async function POST(request: Request) {
  const secret = request.headers.get("x-automation-secret");
  if (!secret || secret !== process.env.AUTOMATION_SECRET) {
    return Response.json({ error: "não autorizado" }, { status: 401 });
  }
  return Response.json(await processDueCampaigns());
}
```

- [ ] **Step 2: Ajustar `src/proxy.ts`** — conferir como `api/automations` foi excluído e replicar para `api/marketing`.

Run: `grep -n "automations\|matcher\|api/" src/proxy.ts`

- [ ] **Step 3: Verificar local** (dev server na porta atual — checar com `curl http://localhost:3000/` ou 3001).

```bash
curl -s -X POST http://localhost:3000/api/marketing/tick -w "\n%{http_code}\n"          # 401
curl -s -X POST http://localhost:3000/api/marketing/tick -H "x-automation-secret: $AUTOMATION_SECRET" -w "\n%{http_code}\n"  # 200 {"processed":0,...}
```

- [ ] **Step 4: Build + commit**

```bash
npm run build
git add src/app/api/marketing/tick/route.ts src/proxy.ts
git commit -m "feat(marketing): rota /api/marketing/tick protegida + proxy"
```

---

### Task 5: Rotas de publicação e teste

**Files:**
- Create: `src/app/api/marketing/campaigns/[id]/send/route.ts`, `src/app/api/marketing/campaigns/[id]/test/route.ts`
- Reference: `src/app/api/team/invite/route.ts` (padrão de `getUser()` + membership + Resend)

**Interfaces:**
- `/send`: body `{ mode: "now"|"scheduled"; scheduledAt?: string }`. Valida sessão + que a campanha é da location do usuário; chama `private.materialize_recipients` (via rpc com service role) e seta `status`.
- `/test`: envia UMA cópia da campanha renderizada para o e-mail do próprio usuário logado (não materializa fila).

- [ ] **Step 1: `/send`** — `getUser()`; carregar a campanha (client autenticado).
  - Se `audience.type === 'smart_list'`: buscar os contatos da location, filtrar com `matchesConditions(contact, conditions)` (extrair `matchesConditions` de `src/components/contacts/module-tabs.tsx` para um módulo **não-client** reusável, ex. `src/lib/data/smart-list.ts`, e importar dos dois lados), pegar os `contact_ids` e chamar `rpc('add_campaign_recipients', { p_campaign_id, p_ids })`.
  - Em seguida (todos os tipos): `rpc('publish_campaign', { p_id, p_mode: mode, p_at: scheduledAt ?? null })` — checa membership, materializa all/tag (no-op p/ smart_list) e seta status. Retornar a campanha atualizada.
- [ ] **Step 2: `/test`** — carrega a campanha (client autenticado), renderiza com `vars` do próprio usuário (nome/email do profile), `resend.emails.send(...)` único. Retorna `{ ok: true }`.
- [ ] **Step 3: Verificar** criando uma campanha rascunho no banco (SQL) e chamando `/test` logado; conferir recebimento.
- [ ] **Step 4: Build + commit**

```bash
npm run build
git add src/app/api/marketing/campaigns .
git commit -m "feat(marketing): publicar/agendar e enviar teste de campanha"
```

---

### Task 6: Webhook do Resend (métricas)

**Files:**
- Create: `src/app/api/marketing/resend-webhook/route.ts`
- Install: `svix`

**Interfaces:**
- Consumes: `public.ingest_email_event(text, text, timestamptz)` (wrapper criado na 0010, revoke de anon/authenticated) via `rpc` com `createAdminClient()`.

- [ ] **Step 1: Instalar svix** — `npm i svix`.
- [ ] **Step 2: Rota** — lê o corpo cru, verifica com `new Webhook(process.env.RESEND_WEBHOOK_SECRET).verify(payload, headers)`; extrai `type` (`email.opened`→`opened` etc.) e `data.email_id`; com `createAdminClient()` chama `rpc('ingest_email_event', { p_resend_id, p_type, p_at })`. Sempre responde 200 (mesmo em no-op) exceto assinatura inválida → 400.
- [ ] **Step 3: Verificar** com o "Send test event" do Resend apontando pra rota local via túnel, ou adiar p/ produção (Task 12). Registrar no plano que a verificação real é em produção.
- [ ] **Step 4: Build + commit**

```bash
npm run build
git add src/app/api/marketing/resend-webhook package.json package-lock.json
git commit -m "feat(marketing): webhook do Resend com verificação Svix"
```

---

### Task 7: Rota de descadastro

**Files:**
- Create: `src/app/api/marketing/unsubscribe/route.ts`
- Consumes: `verifyUnsubscribe`, `createAdminClient()`.

- [ ] **Step 1: `GET`** — lê `c`, `s`, `campaign`. `verifyUnsubscribe(c, s)` falso → página "link inválido". Válido → `createAdminClient()`: `update contacts set marketing_opt_out=true where id=c`; se `campaign`, `update email_campaigns set unsubscribed = unsubscribed + 1 where id=campaign`. Responde HTML simples pt-BR de confirmação (sem depender de sessão).
- [ ] **Step 2: Verificar local** — gerar link com `unsubscribeUrl` (node -e) e abrir; conferir `marketing_opt_out=true`.
- [ ] **Step 3: Build + commit**

```bash
npm run build
git add src/app/api/marketing/unsubscribe
git commit -m "feat(marketing): descadastro assinado (unsubscribe)"
```

---

### Task 8: Repo db/campaigns.ts

**Files:**
- Create: `src/lib/data/repos/db/campaigns.ts`
- Reference: `src/lib/data/repos/db/contacts.ts` e `pipeline.ts` (padrão store + ações otimistas)

**Interfaces:**
- Produces:
```ts
export function useDbCampaigns(): { campaigns: Campaign[]; loading: boolean };
export function useDbCampaign(id: string): Campaign | undefined;
export function useCampaignRecipients(campaignId: string): Recipient[];
export function useAudienceCount(audience: Audience): number; // contagem elegível ao vivo
export const campaignActions: {
  create(input): Promise<string>;   // retorna id
  update(id, patch): Promise<void>;
  remove(id): Promise<void>;
  pause(id): Promise<void>;
};
```

- [ ] **Step 1:** store Zustand carregando `email_campaigns` da location (client com sessão), CRUD otimista, e `useAudienceCount` (query `head:true, count:'exact'` em `contacts` com os mesmos filtros de elegibilidade da `materialize_recipients`). Recipients carregados sob demanda por campanha.
- [ ] **Step 2: Build + commit**

```bash
npm run build
git add src/lib/data/repos/db/campaigns.ts
git commit -m "feat(marketing): repo real de campanhas (Supabase + Zustand)"
```

---

### Task 9: UI — lista de campanhas (aba E-mails real)

**Files:**
- Create: `src/components/marketing/campaigns-tab.tsx`
- Modify: `src/app/(app)/marketing/page.tsx` (trocar o bloco mock `tab === "E-mails"` por `<CampaignsTab />`)

- [ ] **Step 1:** `CampaignsTab` usa `useDbCampaigns()`: tabela real (nome, status badge, destinatários=`total`, `% abertura`=`opened/sent`, `% clique`=`clicked/sent`, data). Botão "Nova campanha" abre o composer (Task 10). Estados de loading/empty.
- [ ] **Step 2:** remover o array mock `EMAIL_CAMPAIGNS` do `page.tsx`.
- [ ] **Step 3: Verificar** na UI (dev server): aba E-mails lista do banco (vazia inicialmente).
- [ ] **Step 4: Build + commit**

```bash
npm run build
git add src/components/marketing/campaigns-tab.tsx "src/app/(app)/marketing/page.tsx"
git commit -m "feat(marketing): lista real de campanhas na aba E-mails"
```

---

### Task 10: UI — composer (Tiptap) + público + prévia

**Files:**
- Create: `src/components/marketing/rich-text-editor.tsx`, `src/components/marketing/campaign-composer.tsx`, `src/components/marketing/campaign-templates.ts`
- Install: `@tiptap/react @tiptap/pm @tiptap/starter-kit @tiptap/extension-link @tiptap/extension-image`

- [ ] **Step 1: Instalar Tiptap** — `npm i @tiptap/react @tiptap/pm @tiptap/starter-kit @tiptap/extension-link @tiptap/extension-image`.
- [ ] **Step 2: `rich-text-editor.tsx`** — `useEditor` (StarterKit + Link + Image), toolbar (negrito, itálico, lista, link, imagem por URL, limpar), `onUpdate` → `editor.getHTML()`. Client component.
- [ ] **Step 3: `campaign-templates.ts`** — 3–4 modelos (`{ id, name, subject, html }`): boas-vindas, newsletter, oferta, reengajamento, com o shell da marca.
- [ ] **Step 4: `campaign-composer.tsx`** — form: nome, assunto, reply-to; editor; botões "Inserir variável" ({{nome}}/{{email}}/campos) e "Inserir trecho" (snippets via repo existente); seletor de público (Todos/Tag/Lista) com `useAudienceCount` ao vivo; **prévia** (renderiza `renderCampaignEmail` num iframe/`dangerouslySetInnerHTML`); botões: Salvar rascunho (`campaignActions.create/update`), **Enviar teste** (`/api/marketing/campaigns/[id]/test`), **Agendar** (date-time → `/send` mode scheduled), **Enviar agora** (`/send` mode now). Confirmar antes de enviar agora.
- [ ] **Step 5: Verificar** na UI: criar rascunho, ver prévia, enviar teste pro próprio e-mail.
- [ ] **Step 6: Build + commit**

```bash
npm run build
git add src/components/marketing package.json package-lock.json
git commit -m "feat(marketing): composer de campanha com editor rico, público e prévia"
```

---

### Task 11: UI — detalhe da campanha (métricas)

**Files:**
- Create: `src/components/marketing/campaign-detail.tsx`
- Modify: `campaigns-tab.tsx` (clicar numa campanha abre o detalhe)

- [ ] **Step 1:** `CampaignDetail` com `useDbCampaign(id)` + `useCampaignRecipients(id)`: KPIs (`KpiCard`) enviados/entregues/% abertura/% clique/bounces/descadastros; tabela de destinatários (e-mail, status badge, aberto/clicado em); botão **Pausar** (`campaignActions.pause`) quando `sending`.
- [ ] **Step 2: Verificar** na UI abrindo uma campanha.
- [ ] **Step 3: Build + commit**

```bash
npm run build
git add src/components/marketing/campaign-detail.tsx src/components/marketing/campaigns-tab.tsx
git commit -m "feat(marketing): detalhe da campanha com métricas e destinatários"
```

---

### Task 12: pg_cron, env de produção e verificação e2e

**Files:**
- Create: `supabase/migrations/0011_marketing_cron.sql`
- Modify: `.env.example`, `AGENTS.md`

- [ ] **Step 1: Migração 0011** (espelha a `0009`): tabela `private.marketing_config` (tick_url + secret), função `private.marketing_tick()` (`net.http_post`), job `lito-marketing-tick` (`* * * * *`) com guard de `unschedule`. Secret placeholder `COLE_O_AUTOMATION_SECRET_AQUI`.
- [ ] **Step 2: `.env.example`** — adicionar `RESEND_WEBHOOK_SECRET="<secret do webhook do Resend>"`.
- [ ] **Step 3: Passos manuais (usuário)** documentados: (a) `RESEND_WEBHOOK_SECRET` no `.env.local` + Vercel; (b) redeploy de produção; (c) criar webhook no Resend → `/api/marketing/resend-webhook` + ativar tracking; (d) aplicar 0010 (se ainda não) e 0011 no SQL Editor trocando o placeholder.
- [ ] **Step 4: Verificação e2e** (produção): criar campanha p/ uma tag de teste (1–2 contatos), enviar agora, conferir recipients `sent` + recebimento, abrir o e-mail e ver `opened` subir, clicar e ver `clicked`, testar unsubscribe.
- [ ] **Step 5: Atualizar `AGENTS.md`** — marcar Email Marketing como concluído (o que ficou real) e mover pendências manuais.
- [ ] **Step 6: Build + commit**

```bash
npm run build
git add supabase/migrations/0011_marketing_cron.sql .env.example AGENTS.md
git commit -m "feat(marketing): pg_cron do envio + env e verificação de produção"
```

---

## Notas de auto-revisão (aplicadas)

- **Materialização/eventos são funções `private`** — não acessíveis pelo PostgREST. Os wrappers `public.publish_campaign(...)` (execute p/ authenticated, checa membership) e `public.ingest_email_event(...)` (só service role) já entram na **migração 0010** (Task 1). Tasks 5 e 6 só os chamam via `rpc`.
- **Nomes de colunas de `contacts`** (`dnd`, `tags`, `email`, `custom_fields`) e a tabela `smart_lists` devem ser confirmados na 0001/0002 no Step 2 da Task 1 antes de aplicar.
- **Verificação sem test runner**: build + SQL Editor + curl + UI, seguindo o padrão do plano de automações.
```
