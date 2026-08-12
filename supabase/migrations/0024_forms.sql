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
