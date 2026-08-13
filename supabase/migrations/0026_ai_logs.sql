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
