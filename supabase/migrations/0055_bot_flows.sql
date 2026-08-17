-- ============================================================
-- Lito CRM — Editor do bot conversacional (bot_flows)
--
-- Guarda a DEFINIÇÃO editável do fluxo (grafo de nós) por empresa. O motor
-- (src/lib/bot/*) carrega daqui por (location_id, key); se não houver linha, usa
-- o fluxo embutido em código (flows/triagem.ts) como padrão. Assim a empresa pode
-- editar textos, opções, pesos e etapas na tela sem mexer no código.
-- Padrão multi-tenant: RLS membership, revoke do anon. Idempotente.
-- ============================================================
set check_function_bodies = off;

create table if not exists public.bot_flows (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations (id) on delete cascade,
  key text not null,                       -- ex.: "triagem"
  name text not null,
  definition jsonb not null,               -- { key, name, start, nodes }
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (location_id, key)
);
create index if not exists bot_flows_location_idx on public.bot_flows (location_id);

alter table public.bot_flows enable row level security;
revoke all on public.bot_flows from anon;

drop policy if exists "membros leem bot_flows" on public.bot_flows;
create policy "membros leem bot_flows" on public.bot_flows
  for select to authenticated using (location_id in (select private.user_locations()));
drop policy if exists "membros criam bot_flows" on public.bot_flows;
create policy "membros criam bot_flows" on public.bot_flows
  for insert to authenticated with check (location_id in (select private.user_locations()));
drop policy if exists "membros editam bot_flows" on public.bot_flows;
create policy "membros editam bot_flows" on public.bot_flows
  for update to authenticated
  using (location_id in (select private.user_locations()))
  with check (location_id in (select private.user_locations()));
drop policy if exists "membros excluem bot_flows" on public.bot_flows;
create policy "membros excluem bot_flows" on public.bot_flows
  for delete to authenticated using (location_id in (select private.user_locations()));

drop trigger if exists bot_flows_updated_at on public.bot_flows;
create trigger bot_flows_updated_at before update on public.bot_flows
  for each row execute function private.set_updated_at();
