-- Devolução: só lead SEM a primeira resposta do vendedor (2026-11-04).
--
-- Relato: leads "em contato" voltando ao rodízio. A 202611041000 passou a
-- contar só resposta humana DEPOIS de `atribuida_em`; quando a atribuição é
-- recarimbada (rodízio/varredura/redistribuição devolvendo ao mesmo vendedor)
-- a conversa que ele já atendia passava a parecer "sem resposta".
-- Agora também conta qualquer resposta do PRÓPRIO dono atual.
-- Mesma assinatura: `create or replace`, aplica antes ou depois do merge.

create or replace function public.conversas_paradas(p_location uuid, p_limite_min integer default 15)
returns table (
  conversation_id uuid,
  contact_id uuid,
  assigned_to uuid,
  assigned_by uuid,
  channel_id uuid,
  devolvida_em timestamptz,
  ultima_do_cliente timestamptz,
  espera_util_min numeric,
  passou_pelo_bot boolean,
  ja_respondida boolean,
  minutos_com_atendente numeric,
  dono_online boolean,
  minutos_de_sla numeric
)
language plpgsql
stable
security definer
set search_path to 'public', 'private'
as $function$
begin
  if p_location is null then
    return;
  end if;
  -- Defesa em profundidade: hoje só a service_role executa (ver os grants no
  -- fim). O ramo existe para o dia em que alguém conceder a `authenticated` sem
  -- reler esta migração.
  if auth.uid() is not null
     and p_location not in (select private.user_locations()) then
    return;
  end if;

  return query
  with abertas as (
    select c.id, c.contact_id, c.assigned_to, c.assigned_by, c.channel_id,
           c.devolvida_em, c.atribuida_em
      from public.conversations c
     where c.location_id = p_location
       and c.closed_at is null
       and c.archived_at is null
       /*
        * 🔴 Só o que a devolução pode tocar: COM dono e com mensagem recente.
        * Sem isto a função varria todas as conversas abertas da empresa (10 s,
        * acima dos 8 s do authenticator) e devolvia 3.130 linhas — o PostgREST
        * corta em 1.000, e como a ordem é da MAIOR espera para a menor, os
        * leads frescos ficavam fora da resposta.
        * 6 dias corridos cobre o teto de um dia útil (660 min) mesmo com
        * fim de semana e feriado no meio.
        */
       and c.assigned_to is not null
       and c.last_message_at > now() - interval '6 days'
  ),
  /*
   * ⚠️ Dois sinais para "passou pelo bot", unidos por OR, e nenhum sozinho
   * basta: `bot_sessions` é apagada quando uma conversa finalizada reabre, e a
   * mensagem `automated` pode ainda não existir numa sessão recém-criada.
   */
  bot as (
    select a.id,
           ( exists (select 1 from public.bot_sessions s where s.conversation_id = a.id)
             or exists (
               select 1 from public.messages m
                where m.conversation_id = a.id
                  and m.direction = 'out'
                  and m.automated is true
             ) ) as passou
      from abertas a
  ),
  ult as (
    select m.conversation_id,
           max(m.created_at) filter (where m.direction = 'in') as t_cliente,
           /*
            * "Humano" exclui o BOT (`automated`) e a NOTA INTERNA: nenhum dos
            * dois é atendimento, e contá-los faria toda conversa parecer
            * respondida em segundos.
            */
           max(m.created_at) filter (
             where m.direction = 'out'
               and coalesce(m.automated, false) = false
               and coalesce(m.internal, false) = false
           ) as t_humano
      from public.messages m
      join abertas a on a.id = m.conversation_id
     where coalesce(m.type, '') <> 'event'
     group by m.conversation_id
  ),
  /* O estado do DONO, no momento da consulta. */
  dono as (
    select lm.user_id,
           ( lm.last_seen_at is not null
             and lm.last_seen_at >= now() - private.presenca_janela()
             and coalesce(lm.disponibilidade, 'online') <> 'ausente' ) as online,
           lm.online_desde
      from public.location_members lm
     where lm.location_id = p_location
  )
  select a.id::uuid, a.contact_id::uuid, a.assigned_to::uuid, a.assigned_by::uuid,
         a.channel_id::uuid, a.devolvida_em::timestamptz, u.t_cliente::timestamptz,
         private.business_minutes(u.t_cliente, now())::numeric,
         b.passou::boolean,
         /*
          * Já respondida = houve PRIMEIRA RESPOSTA deste atendimento:
          * resposta humana depois da atribuição atual, OU qualquer resposta
          * do PRÓPRIO dono atual (lead que ele já trabalhou e voltou a cair
          * com ele, ou atribuição recarimbada). Resposta de OUTRA pessoa antes
          * da atribuição continua não contando (202611041000).
          */
         ( (u.t_humano is not null and a.atribuida_em is not null
            and u.t_humano >= a.atribuida_em)
           or exists (
             select 1 from public.messages m
              where m.conversation_id = a.id
                and m.direction = 'out'
                and m.created_by = a.assigned_to
                and coalesce(m.automated, false) = false
                and coalesce(m.internal, false) = false
                and coalesce(m.type, '') <> 'event'
           ) )::boolean,
         private.business_minutes(a.atribuida_em, now())::numeric,
         coalesce(d.online, false)::boolean,
         /*
          * ⚠️ `greatest` com um lado nulo devolve o outro no Postgres (não é
          * null como em `+`), então dono sem `online_desde` cai em
          * `atribuida_em` — o comportamento de hoje.
          */
         private.business_minutes(
           greatest(a.atribuida_em, d.online_desde), now()
         )::numeric
    from abertas a
    join ult u on u.conversation_id = a.id
    join bot b on b.id = a.id
    left join dono d on d.user_id = a.assigned_to
   where u.t_cliente is not null
     -- A BOLA ESTÁ COM A GENTE: ninguém respondeu depois da última do cliente.
     and (u.t_humano is null or u.t_humano < u.t_cliente)
     and private.business_minutes(u.t_cliente, now()) >= p_limite_min
     /*
      * 🔴 A JANELA DO ATENDENTE (202609101830): quem acabou de receber não pode
      * perder. Continua sendo o filtro da SQL — o SLA que depende da presença é
      * decidido no TypeScript, com a coluna nova.
      */
     and a.atribuida_em is not null
     and private.business_minutes(a.atribuida_em, now()) >= p_limite_min
     -- Teto da devolução (DEVOLVER_TETO_MIN em distribution.ts): além de um dia
     -- útil é backlog, e o TypeScript descarta. Cortar aqui é o que mantém a
     -- resposta abaixo das 1.000 linhas do PostgREST.
     and private.business_minutes(u.t_cliente, now()) <= 660
   order by private.business_minutes(u.t_cliente, now()) desc;
end;
$function$;

revoke execute on function public.conversas_paradas(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.conversas_paradas(uuid, integer) to service_role;
