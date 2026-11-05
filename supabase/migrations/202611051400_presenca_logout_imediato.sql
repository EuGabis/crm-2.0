-- Presença: logout tira do rodízio NA HORA, e a volta é registrada (2026-11-05).
--
-- Medido em Vendas, 3 dias:
--
-- 1) 103 leads entregues nos 15 min DEPOIS de um logout por inatividade. O
--    `registrar_offline` gravava o evento no histórico mas não mexia em
--    `last_seen_at`, e o rodízio e o SLA decidem por ele (janela de 15 min).
--    Agora o logout empurra `last_seen_at` para FORA da janela.
--    ⚠️ NUNCA para NULL: NULL quer dizer "nunca acessou" e some do rodízio —
--    foi o defeito de 09/09 (clear_presence). Um carimbo velho é o valor certo.
--    Se a pessoa tiver outra aba aberta e ativa, o próximo ping (≤ 1 min) a
--    traz de volta — é o comportamento correto: ela está lá.
--
-- 2) ~400 entregas a quem o histórico dizia "offline", todas com sessão ativa:
--    quem voltava em menos de 15 min tinha a sessão antiga ESTENDIDA pelo
--    `touch_presence`, e nenhum "online" era gravado. O histórico de status e o
--    tempo online mentiam. Agora, se o último status é "offline", a volta abre
--    sessão nova e grava "online".
--
-- Mesmas assinaturas: create or replace (grants preservados). Pode ser aplicada
-- antes ou depois do merge — nenhum código muda.

create or replace function public.registrar_offline(p_origem text default 'logout')
returns void
language plpgsql
security definer
set search_path to 'public', 'private'
as $function$
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

  -- Sai do rodízio e para o SLA agora, não 15 min depois. Carimbo velho, nunca NULL.
  update public.location_members
     set last_seen_at = least(coalesce(last_seen_at, now()),
                              now() - private.presenca_janela() - interval '1 second')
   where user_id = v_user;
end;
$function$;

create or replace function public.touch_presence()
returns void
language plpgsql
security definer
set search_path to 'public', 'private'
as $function$
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

  select e.status into v_ultimo_status
    from public.status_eventos e
   where e.user_id = v_user
   order by e.em desc
   limit 1;

  -- Estende a sessão em curso — a não ser que o último status seja "offline"
  -- (logout): aí é uma VOLTA, e a volta precisa ficar no histórico.
  if v_sessao is not null
     and v_tipo_sessao = v_tipo
     and v_fim >= now() - private.presenca_janela()
     and v_ultimo_status is distinct from 'offline' then
    update public.presence_sessions set fim = now() where id = v_sessao;
    return;
  end if;

  -- Sessão nova. Se a anterior morreu por falta de sinal, registra o offline no
  -- horário do último sinal — a não ser que um logout já tenha gravado.
  if v_sessao is not null and v_fim < now() - private.presenca_janela()
     and v_ultimo_status is distinct from 'offline' then
    insert into public.status_eventos (location_id, user_id, status, em, origem)
    values (v_loc, v_user, 'offline', v_fim, 'inatividade');
  end if;

  insert into public.presence_sessions (location_id, user_id, inicio, fim, tipo)
  values (v_loc, v_user, now(), now(), v_tipo);

  insert into public.status_eventos (location_id, user_id, status, em, origem)
  values (v_loc, v_user, v_tipo, now(), 'sistema');
end;
$function$;
