-- ============================================================
-- Lito CRM — Email Marketing (schema, RLS e funções)
-- Migração única: rode este arquivo inteiro de uma vez no SQL Editor.
--
-- Padrão de RLS/tenant idêntico à 0001: location_id em tudo, RLS habilitada,
-- revoke de anon, políticas TO authenticated via private.user_locations().
-- Escrita de status/contadores fica com a service role (tick + webhook).
-- ============================================================
set check_function_bodies = off;

-- ---------- Opt-out de marketing (dedicado; não afeta transacionais) ----------
alter table public.contacts
  add column if not exists marketing_opt_out boolean not null default false;

-- ---------- Campanhas ----------
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
create index if not exists email_campaigns_location_idx
  on public.email_campaigns (location_id, created_at desc);
create index if not exists email_campaigns_due_idx
  on public.email_campaigns (status, scheduled_at);

-- ---------- Destinatários (fila materializada) ----------
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

-- ---------- RLS ----------
alter table public.email_campaigns enable row level security;
alter table public.email_campaign_recipients enable row level security;
revoke all on public.email_campaigns, public.email_campaign_recipients from anon;

drop policy if exists "membros gerenciam campanhas" on public.email_campaigns;
create policy "membros gerenciam campanhas" on public.email_campaigns
  for all to authenticated
  using (location_id in (select private.user_locations()))
  with check (location_id in (select private.user_locations()));

drop policy if exists "membros leem destinatarios" on public.email_campaign_recipients;
create policy "membros leem destinatarios" on public.email_campaign_recipients
  for select to authenticated
  using (location_id in (select private.user_locations()));

-- ---------- Materialização (todos / tag) ----------
-- Lista inteligente é avaliada em TypeScript (mesmo matchesConditions da tela de
-- Contatos) e inserida via public.add_campaign_recipients — aqui é no-op.
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

  if aud_type in ('all','tag') then
    insert into public.email_campaign_recipients (campaign_id, location_id, contact_id, email)
    select p_campaign_id, camp.location_id, c.id, c.email
    from public.contacts c
    where c.location_id = camp.location_id
      and c.email is not null and c.email <> ''
      and coalesce(c.marketing_opt_out, false) = false
      and coalesce(c.dnd, false) = false
      and (aud_type = 'all' or (aud_type = 'tag' and aud_value = any (c.tags)))
    on conflict (campaign_id, contact_id) do nothing;
  end if;

  select count(*) into n from public.email_campaign_recipients where campaign_id = p_campaign_id;
  update public.email_campaigns set total = n, updated_at = now() where id = p_campaign_id;
  return n;
end;
$$;
revoke all on function private.materialize_recipients(uuid) from public, anon, authenticated;

-- ---------- Inserir destinatários pré-filtrados (lista inteligente) ----------
create or replace function public.add_campaign_recipients(p_campaign_id uuid, p_ids uuid[])
returns int language plpgsql security definer set search_path = '' as $$
declare
  camp record;
  n int;
begin
  select * into camp from public.email_campaigns where id = p_campaign_id;
  if not found then raise exception 'campanha inexistente'; end if;
  if camp.location_id not in (select private.user_locations()) then
    raise exception 'sem permissão';
  end if;

  insert into public.email_campaign_recipients (campaign_id, location_id, contact_id, email)
  select p_campaign_id, camp.location_id, c.id, c.email
  from public.contacts c
  where c.location_id = camp.location_id
    and c.id = any (p_ids)
    and c.email is not null and c.email <> ''
    and coalesce(c.marketing_opt_out, false) = false
    and coalesce(c.dnd, false) = false
  on conflict (campaign_id, contact_id) do nothing;

  select count(*) into n from public.email_campaign_recipients where campaign_id = p_campaign_id;
  update public.email_campaigns set total = n, updated_at = now() where id = p_campaign_id;
  return n;
end;
$$;
revoke all on function public.add_campaign_recipients(uuid, uuid[]) from anon;
grant execute on function public.add_campaign_recipients(uuid, uuid[]) to authenticated;

-- ---------- Publicar / agendar (checa membership; materializa todos/tag) ----------
create or replace function public.publish_campaign(p_id uuid, p_mode text, p_at timestamptz)
returns public.email_campaigns language plpgsql security definer set search_path = '' as $$
declare
  camp public.email_campaigns;
begin
  select * into camp from public.email_campaigns where id = p_id;
  if not found then raise exception 'campanha inexistente'; end if;
  if camp.location_id not in (select private.user_locations()) then
    raise exception 'sem permissão';
  end if;

  perform private.materialize_recipients(p_id);  -- no-op para smart_list

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

-- ---------- Aplicar evento do Resend (idempotente) ----------
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

-- Wrapper público chamado só pela service role (webhook).
create or replace function public.ingest_email_event(
  p_resend_id text, p_type text, p_at timestamptz
) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.apply_email_event(p_resend_id, p_type, p_at);
end;
$$;
revoke all on function public.ingest_email_event(text, text, timestamptz) from public, anon, authenticated;

-- ---------- Verificação ----------
-- select table_name from information_schema.tables
--   where table_schema='public' and table_name like 'email_campaign%';
-- select column_name from information_schema.columns
--   where table_name='contacts' and column_name='marketing_opt_out';
