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
