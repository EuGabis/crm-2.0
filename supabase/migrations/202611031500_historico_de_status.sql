-- Histórico de status dos usuários + estimativa de atividade nos dias "sem medida".
--
-- Pedido do Gabriel (03/11): gravar TODA troca — quando ficou online, quando foi
-- para ausente e quando ficou offline. Até aqui o banco guardava só a ÚLTIMA troca
-- (ausente_desde / online_desde), e reconstruir um dia exigia deduzir pelas
-- mensagens enviadas.
--
-- Como cada evento nasce:
--   online / ausente — quando touch_presence abre uma sessão nova: voltar de
--     offline, trocar de status (o ping seguinte, até 1 min depois) ou login.
--   offline — duas origens:
--     · 'logout': saída pelo botão ou pelo logout por inatividade (registrar_offline);
--     · 'inatividade': fechou o navegador / ficou parado sem deslogar. Ninguém avisa
--       nesse caso, então o evento é gravado no PRÓXIMO sinal da pessoa, com o
--       horário do ÚLTIMO sinal anterior (fim da última sessão). Até ela voltar,
--       o offline em curso não aparece na tabela — é inferido pela tela.
--
-- Aplicar DEPOIS da 202611031200 (usa presence_sessions.tipo). Aditiva.

create table if not exists public.status_eventos (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null,
  user_id uuid not null,
  status text not null check (status in ('online', 'ausente', 'offline')),
  em timestamptz not null default now(),
  origem text not null default 'sistema'
);

create index if not exists status_eventos_lookup
  on public.status_eventos (location_id, user_id, em desc);

alter table public.status_eventos enable row level security;

drop policy if exists "membros leem status" on public.status_eventos;
create policy "membros leem status" on public.status_eventos
  for select to authenticated
  using (location_id in (select private.user_locations()));

-- Sem policy de escrita: só as funções definer gravam.
revoke all on public.status_eventos from anon;
grant select on public.status_eventos to authenticated;

-- ---------------------------------------------------------------------------
-- touch_presence: igual à 202611031200, mais os eventos
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
  v_ultimo_status text;
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

  if v_sessao is not null
     and v_tipo_sessao = v_tipo
     and v_fim >= now() - private.presenca_janela() then
    update public.presence_sessions set fim = now() where id = v_sessao;
    return;
  end if;

  -- Sessão nova. Se a anterior morreu por falta de sinal, registra o offline no
  -- horário do último sinal — a não ser que um logout já tenha gravado.
  if v_sessao is not null and v_fim < now() - private.presenca_janela() then
    select e.status into v_ultimo_status
      from public.status_eventos e
     where e.user_id = v_user
     order by e.em desc
     limit 1;
    if v_ultimo_status is distinct from 'offline' then
      insert into public.status_eventos (location_id, user_id, status, em, origem)
      values (v_loc, v_user, 'offline', v_fim, 'inatividade');
    end if;
  end if;

  insert into public.presence_sessions (location_id, user_id, inicio, fim, tipo)
  values (v_loc, v_user, now(), now(), v_tipo);

  insert into public.status_eventos (location_id, user_id, status, em, origem)
  values (v_loc, v_user, v_tipo, now(), 'sistema');
end;
$fn$;

revoke execute on function public.touch_presence() from public, anon, authenticated;
grant execute on function public.touch_presence() to authenticated;

-- ---------------------------------------------------------------------------
-- registrar_offline: chamada no logout (botão e inatividade), ANTES do signOut
-- ---------------------------------------------------------------------------
create or replace function public.registrar_offline(p_origem text default 'logout')
returns void
language plpgsql
security definer
set search_path to 'public', 'private'
as $fn$
declare
  v_user uuid := auth.uid();
  v_loc uuid;
begin
  if v_user is null then
    return;
  end if;

  select m.location_id into v_loc
    from public.location_members m
   where m.user_id = v_user
   limit 1;
  if v_loc is null then
    return;
  end if;

  insert into public.status_eventos (location_id, user_id, status, em, origem)
  values (v_loc, v_user, 'offline', now(),
          case when p_origem in ('logout', 'inatividade') then p_origem else 'logout' end);

  -- Encerra a sessão em curso agora: o próximo login abre outra.
  update public.presence_sessions s
     set fim = now()
   where s.id = (select s2.id from public.presence_sessions s2
                  where s2.user_id = v_user order by s2.inicio desc limit 1)
     and s.fim >= now() - private.presenca_janela();
end;
$fn$;

revoke execute on function public.registrar_offline(text) from public, anon, authenticated;
grant execute on function public.registrar_offline(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Dias "sem medida": acrescenta a estimativa pela atividade (mensagens enviadas)
-- ---------------------------------------------------------------------------
-- drop + create porque o tipo de retorno muda (create or replace daria 42P13).
drop function if exists public.dias_sem_medida_presenca(uuid, date, date);

create function public.dias_sem_medida_presenca(p_location uuid, p_de date, p_ate date)
returns table (usuario uuid, dia date, primeira_msg timestamptz, ultima_msg timestamptz, mensagens integer)
language plpgsql
stable
security definer
set search_path to 'public', 'private'
as $fn$
begin
  if p_location not in (select private.user_locations()) then
    return;
  end if;

  return query
  with limites as (
    select g.d::date as d,
           (g.d::date::timestamp at time zone 'America/Sao_Paulo') as ini,
           ((g.d::date + 1)::timestamp at time zone 'America/Sao_Paulo') as fim
      from generate_series(p_de, p_ate, interval '1 day') as g(d)
  ),
  afetados as (
    select distinct x.user_id, l.d, l.ini, l.fim
      from private.presence_sessions_descartadas x
      join limites l on x.inicio < l.fim and x.fim > l.ini
     where x.location_id = p_location
  )
  select a.user_id, a.d, min(m.created_at), max(m.created_at), count(m.id)::integer
    from afetados a
    left join public.messages m
      on m.created_by = a.user_id
     and m.direction = 'out'
     and m.type <> 'event'
     and coalesce(m.automated, false) = false
     and m.created_at >= a.ini and m.created_at < a.fim
   group by a.user_id, a.d;
end;
$fn$;

revoke execute on function public.dias_sem_medida_presenca(uuid, date, date) from public, anon, authenticated;
grant execute on function public.dias_sem_medida_presenca(uuid, date, date) to authenticated;
