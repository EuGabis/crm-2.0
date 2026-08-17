-- ============================================================
-- Lito CRM — Mídia: conexões com Google Drive e Canva
--
-- Uma tabela para as duas (e para as próximas do mesmo tipo): o que muda entre
-- elas é o endpoint, não o formato do que guardamos — token de acesso, refresh
-- token, validade e um rótulo da conta.
--
-- ⚠️ TOKEN É SEGREDO. A tabela é ADMIN-ONLY, no mesmo padrão de
-- `payment_credentials` (0008); quem lê o token nas rotas é a service role. E,
-- como já aprendemos ali (duas vezes), telas que só precisam saber SE está
-- conectado leem a VIEW `media_integration_status`, que não expõe token
-- nenhum — sem ela, todo usuário não-admin veria "não conectado".
--
-- A view é SECURITY DEFINER de propósito (sem `security_invoker`): ela precisa
-- contornar a RLS admin-only da tabela base. O isolamento entre empresas mora
-- AQUI DENTRO, no `where` com `private.user_locations()`.
--
-- Idempotente.
-- ============================================================

create table if not exists public.media_connections (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations (id) on delete cascade,
  provider text not null check (provider in ('google_drive', 'canva')),
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  /** E-mail/nome da conta conectada, só para mostrar na tela. */
  account_label text,
  connected_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (location_id, provider)
);

alter table public.media_connections enable row level security;
revoke all on public.media_connections from anon;

-- Só admin toca na tabela com token. As rotas usam a service role.
drop policy if exists "admin le conexoes de midia" on public.media_connections;
create policy "admin le conexoes de midia" on public.media_connections
  for select to authenticated
  using (
    location_id in (select private.user_locations())
    and private.is_admin(location_id)
  );

drop policy if exists "admin escreve conexoes de midia" on public.media_connections;
create policy "admin escreve conexoes de midia" on public.media_connections
  for all to authenticated
  using (
    location_id in (select private.user_locations())
    and private.is_admin(location_id)
  )
  with check (
    location_id in (select private.user_locations())
    and private.is_admin(location_id)
  );

drop trigger if exists media_connections_updated_at on public.media_connections;
create trigger media_connections_updated_at
  before update on public.media_connections
  for each row execute function private.set_updated_at();

-- ---------- Estado da integração, sem token, para qualquer membro ----------
create or replace view public.media_integration_status as
select
  mc.location_id,
  mc.provider,
  mc.account_label,
  mc.created_at as connected_at,
  mc.expires_at
from public.media_connections mc
where mc.location_id in (select private.user_locations());

revoke all on public.media_integration_status from anon;
grant select on public.media_integration_status to authenticated;
