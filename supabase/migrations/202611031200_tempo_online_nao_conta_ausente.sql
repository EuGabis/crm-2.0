-- Tempo online sem o período AUSENTE, e o tempo ausente medido à parte.
--
-- 1. Defeito: enquanto ausente, touch_presence não gravava sessão mas atualizava
--    last_seen_at. Ao voltar para online, v_frio (que olha last_seen_at) dava
--    false e o código esticava a ÚLTIMA sessão até now() — engolindo o
--    intervalo ausente inteiro (ex.: Karina 24h num dia). Agora a continuidade
--    é decidida pelo FIM da própria sessão.
-- 2. Pedido do Gabriel (03/11): uma coluna com o tempo AUSENTE. As sessões
--    ganham `tipo` ('online' | 'ausente'); trocar de status fecha uma e abre a
--    outra.
--
-- online_desde (usado pelo SLA) não muda de regra.
-- Aditiva: pode ser aplicada antes ou depois do merge.
-- ⚠️ Não corrige sessões já gravadas: o intervalo ausente dentro delas não foi
-- registrado em lugar nenhum. O tempo ausente começa a contar daqui.

alter table public.presence_sessions
  add column if not exists tipo text not null default 'online';

alter table public.presence_sessions
  drop constraint if exists presence_sessions_tipo_check;
alter table public.presence_sessions
  add constraint presence_sessions_tipo_check check (tipo in ('online', 'ausente'));

-- ---------------------------------------------------------------------------
-- touch_presence
-- ---------------------------------------------------------------------------
create or replace function public.touch_presence()
returns void
language plpgsql
security definer
set search_path to 'public', 'private'
as $fn$
declare
  v_user uuid := auth.uid();
  v_loc uuid;
  v_frio boolean;
  v_ausente boolean;
  v_tipo text;
  v_sessao uuid;
  v_fim timestamptz;
  v_tipo_sessao text;
begin
  if v_user is null then
    return;
  end if;

  select m.location_id,
         (m.online_desde is null
          or m.last_seen_at is null
          or m.last_seen_at < now() - private.presenca_janela()),
         coalesce(m.disponibilidade, 'online') = 'ausente'
    into v_loc, v_frio, v_ausente
    from public.location_members m
   where m.user_id = v_user
   limit 1;

  if v_loc is null then
    return;
  end if;

  update public.location_members
     set last_seen_at = now(),
         online_desde = case
           when v_ausente then online_desde
           when v_frio then now()
           else online_desde
         end
   where user_id = v_user;

  v_tipo := case when v_ausente then 'ausente' else 'online' end;

  select s.id, s.fim, s.tipo into v_sessao, v_fim, v_tipo_sessao
    from public.presence_sessions s
   where s.user_id = v_user
   order by s.inicio desc
   limit 1;

  -- Continua a sessão só se é do MESMO tipo e o último ping dela está dentro da
  -- janela. Trocar de status, ou ficar fora mais que a janela, abre sessão nova.
  if v_sessao is not null
     and v_tipo_sessao = v_tipo
     and v_fim >= now() - private.presenca_janela() then
    update public.presence_sessions set fim = now() where id = v_sessao;
  else
    insert into public.presence_sessions (location_id, user_id, inicio, fim, tipo)
    values (v_loc, v_user, now(), now(), v_tipo);
  end if;
end;
$fn$;

revoke execute on function public.touch_presence() from public, anon, authenticated;
grant execute on function public.touch_presence() to authenticated;

-- ---------------------------------------------------------------------------
-- Partição por dia, uma vez só, para online e ausente
-- ---------------------------------------------------------------------------
create or replace function private.presenca_por_dia(
  p_location uuid, p_de date, p_ate date, p_tipo text
)
returns table (usuario uuid, dia date, minutos numeric)
language sql
stable
security definer
set search_path to 'public', 'private'
as $fn$
  with dias as (
    select generate_series(p_de, p_ate, interval '1 day')::date as d
  ),
  limites as (
    select d.d,
           (d.d::timestamp at time zone 'America/Sao_Paulo') as ini,
           ((d.d + 1)::timestamp at time zone 'America/Sao_Paulo') as fim
      from dias d
  )
  select s.user_id,
         l.d,
         round(sum(extract(epoch from (least(s.fim, l.fim, now()) - greatest(s.inicio, l.ini)))) / 60.0)::numeric
    from public.presence_sessions s
    join limites l on s.inicio < l.fim and s.fim > l.ini
   where s.location_id = p_location
     and s.tipo = p_tipo
   group by s.user_id, l.d
  having sum(extract(epoch from (least(s.fim, l.fim, now()) - greatest(s.inicio, l.ini)))) > 0;
$fn$;

revoke execute on function private.presenca_por_dia(uuid, date, date, text) from public, anon, authenticated;

create or replace function public.tempo_online_por_dia(p_location uuid, p_de date, p_ate date)
returns table (usuario uuid, dia date, minutos numeric)
language plpgsql
stable
security definer
set search_path to 'public', 'private'
as $fn$
begin
  if p_location not in (select private.user_locations()) then
    return;
  end if;
  return query select * from private.presenca_por_dia(p_location, p_de, p_ate, 'online');
end;
$fn$;

revoke execute on function public.tempo_online_por_dia(uuid, date, date) from public, anon;
grant execute on function public.tempo_online_por_dia(uuid, date, date) to authenticated;

create or replace function public.tempo_ausente_por_dia(p_location uuid, p_de date, p_ate date)
returns table (usuario uuid, dia date, minutos numeric)
language plpgsql
stable
security definer
set search_path to 'public', 'private'
as $fn$
begin
  if p_location not in (select private.user_locations()) then
    return;
  end if;
  return query select * from private.presenca_por_dia(p_location, p_de, p_ate, 'ausente');
end;
$fn$;

revoke execute on function public.tempo_ausente_por_dia(uuid, date, date) from public, anon, authenticated;
grant execute on function public.tempo_ausente_por_dia(uuid, date, date) to authenticated;

-- tempo_online (total por dias): só sessões online.
create or replace function public.tempo_online(p_location uuid, p_dias integer)
returns table (usuario uuid, minutos numeric, desde timestamptz)
language plpgsql
stable
security definer
set search_path to 'public', 'private'
as $fn$
declare
  v_de timestamptz := now() - make_interval(days => greatest(p_dias, 1));
begin
  if p_location not in (select private.user_locations()) then
    return;
  end if;

  return query
  select s.user_id,
         round(sum(extract(epoch from (least(s.fim, now()) - greatest(s.inicio, v_de)))) / 60.0)::numeric,
         min(s.inicio)
    from public.presence_sessions s
   where s.location_id = p_location
     and s.fim > v_de
     and s.tipo = 'online'
   group by s.user_id;
end;
$fn$;

revoke execute on function public.tempo_online(uuid, integer) from public, anon;
grant execute on function public.tempo_online(uuid, integer) to authenticated;
