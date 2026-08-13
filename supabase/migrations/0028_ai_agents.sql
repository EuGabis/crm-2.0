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
