-- ============================================================
-- Lito CRM — Marketing: Brand Boards e Contadores regressivos
-- Migração única: rode este arquivo inteiro de uma vez no SQL Editor.
-- (Trechos já usam a tabela public.snippets da migração 0003.)
-- ============================================================
set check_function_bodies = off;

-- ---------- Brand Boards ----------
create table if not exists public.brand_boards (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations (id) on delete cascade,
  name text not null,
  palette text[] not null default '{}',      -- cores em hex (#RRGGBB)
  font text not null default 'Inter',
  created_at timestamptz not null default now()
);
create index if not exists brand_boards_location_idx
  on public.brand_boards (location_id, created_at desc);

-- ---------- Contadores regressivos ----------
create table if not exists public.countdowns (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations (id) on delete cascade,
  name text not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists countdowns_location_idx
  on public.countdowns (location_id, created_at desc);

-- ---------- RLS (mesmo padrão de membership das outras tabelas) ----------
alter table public.brand_boards enable row level security;
alter table public.countdowns enable row level security;
revoke all on public.brand_boards, public.countdowns from anon;

drop policy if exists "membros gerenciam brand_boards" on public.brand_boards;
create policy "membros gerenciam brand_boards" on public.brand_boards
  for all to authenticated
  using (location_id in (select private.user_locations()))
  with check (location_id in (select private.user_locations()));

drop policy if exists "membros gerenciam countdowns" on public.countdowns;
create policy "membros gerenciam countdowns" on public.countdowns
  for all to authenticated
  using (location_id in (select private.user_locations()))
  with check (location_id in (select private.user_locations()));

-- ---------- Verificação ----------
-- select table_name from information_schema.tables
--   where table_schema='public' and table_name in ('brand_boards','countdowns');
