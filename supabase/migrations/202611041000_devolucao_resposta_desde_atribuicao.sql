-- Devolução: "já respondida" passa a contar só a resposta humana DEPOIS da
-- atribuição atual (2026-11-04).
--
-- Relato: leads atribuídos pelo rodízio ficavam com o vendedor mesmo depois dos
-- 20 minutos sem resposta. `ja_respondida` era `t_humano is not null` — qualquer
-- resposta humana da HISTÓRIA da conversa. Contato que já tinha falado com
-- alguém antes (outro ciclo, outro vendedor, a Secretaria) chegava ao rodízio
-- "já respondido" e nunca era devolvido.
--
-- Agora: respondida = existe resposta humana em ou depois de `atribuida_em`.
-- A regra de 202609092030 ("uma vez que o vendedor mandou mensagem, fica com
-- ele") continua valendo — só passa a olhar a mensagem DESTE atendimento.
--
-- Mesma assinatura e mesmo retorno: `create or replace`, sem drop. Pode ser
-- aplicada antes ou depois do merge (nenhum código muda).

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
     where m.location_id = p_location
       and coalesce(m.type, '') <> 'event'
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
         (u.t_humano is not null and a.atribuida_em is not null
          and u.t_humano >= a.atribuida_em)::boolean,
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
   order by private.business_minutes(u.t_cliente, now()) desc;
end;
$function$;

revoke execute on function public.conversas_paradas(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.conversas_paradas(uuid, integer) to service_role;
