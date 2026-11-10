-- 42702 "column reference conversation_id is ambiguous" ao abrir a lista de
-- leads (10/11/2026): em plpgsql, as colunas do `returns table`
-- (conversation_id, contact_id...) viram variáveis e colidem com as colunas de
-- mesmo nome sem prefixo nas CTEs. `#variable_conflict use_column` resolve a
-- favor da coluna. Mesmo corpo da 202611101700, só com a diretiva.

drop function if exists public.relatorio_comercial_leads(uuid, date, date, uuid, text);
create function public.relatorio_comercial_leads(
  p_location uuid, p_de date, p_ate date, p_usuario uuid, p_metrica text
)
returns table (
  ref text,
  conversation_id uuid,
  contact_id uuid,
  contato text,
  telefone text,
  email text,
  quando timestamptz,
  detalhe text,
  chave text,
  valor numeric
)
language plpgsql
security definer
set search_path = public, private
stable
as $$
#variable_conflict use_column
declare
  v_de timestamptz := (p_de::timestamp) at time zone 'America/Sao_Paulo';
  v_ate timestamptz := ((p_ate + 1)::timestamp) at time zone 'America/Sao_Paulo';
  v_nome text;
begin
  -- A rota confere admin e chama com a service role (sem o limite de 8 s do
  -- `authenticated`); pela sessão, continua exigindo admin.
  if coalesce(auth.role(), '') <> 'service_role' and not private.is_admin(p_location) then
    return;
  end if;
  select coalesce(nullif(btrim(p.name), ''), 'Sem nome') into v_nome
    from public.location_members m join public.profiles p on p.id = m.user_id
   where m.location_id = p_location and m.user_id = p_usuario;
  if v_nome is null then
    return;
  end if;

  -- Estado atual: carteira, sem resposta, pendentes.
  if p_metrica in ('com_ele_agora', 'sem_resposta', 'pendentes') then
    return query
    select c.id::text, c.id, c.contact_id,
           btrim(coalesce(ct.first_name, '') || ' ' || coalesce(ct.last_name, ''))::text,
           ct.phone::text, ct.email::text,
           coalesce(ult.created_at, c.last_message_at),
           (case when ult.direction = 'in' then 'última mensagem do cliente'
                 when ult.direction is null then 'sem mensagens'
                 else 'última mensagem da equipe' end
            || case when coalesce(c.assigned_offline, false) then ' · pendente (recebido offline)' else '' end)::text,
           null::text, null::numeric
      from public.conversations c
      left join public.contacts ct on ct.id = c.contact_id
      left join lateral (
        select m.direction, m.created_at from public.messages m
         where m.conversation_id = c.id and m.deleted_at is null
           and m.type <> 'event' and not coalesce(m.internal, false)
         order by m.created_at desc limit 1
      ) ult on true
     where c.location_id = p_location and c.assigned_to = p_usuario
       and c.closed_at is null and c.archived_at is null
       and (p_metrica = 'com_ele_agora'
            or (p_metrica = 'sem_resposta' and ult.direction = 'in')
            or (p_metrica = 'pendentes' and coalesce(c.assigned_offline, false)));
    return;
  end if;

  -- Funil: cards ganhos/perdidos atualizados no período.
  if p_metrica in ('ganhos_funil', 'perdidos_funil') then
    return query
    select o.id::text, null::uuid, o.contact_id,
           btrim(coalesce(ct.first_name, '') || ' ' || coalesce(ct.last_name, ''))::text,
           ct.phone::text, ct.email::text, o.updated_at,
           (coalesce(pl.name, '') || ' → ' || coalesce(st.name, '')
            || coalesce(' · ' || o.course, '') || ' · card "' || coalesce(o.name, '') || '"')::text,
           null::text, o.value::numeric
      from public.opportunities o
      left join public.contacts ct on ct.id = o.contact_id
      left join public.pipelines pl on pl.id = o.pipeline_id
      left join public.stages st on st.id = o.stage_id
     where o.location_id = p_location and o.owner_id = p_usuario
       and o.status = case when p_metrica = 'ganhos_funil' then 'won' else 'lost' end
       and o.updated_at >= v_de and o.updated_at < v_ate;
    return;
  end if;

  -- Vendas da Guru creditadas a ele.
  if p_metrica = 'vendas_guru' then
    return query
    with vendas as (
      select s.id, s.amount, s.guru_created_at, s.product_name, s.contact_name, s.contact_email, e.raw
        from public.payment_new_sales s
        join public.payment_events e on e.id = s.id
       where s.location_id = p_location
         and s.guru_created_at >= v_de and s.guru_created_at < v_ate
    ),
    casada as (
      select v.*, x.contact_id, x.chave
        from vendas v
        cross join lateral (
          select ct.id as contact_id, 'CPF/CNPJ'::text as chave, 1 as ordem from public.contacts ct
           where ct.location_id = p_location
             and private.doc_key(v.raw->'contact'->>'doc') <> ''
             and private.doc_key(ct.doc) = private.doc_key(v.raw->'contact'->>'doc')
          union all
          select ct.id, 'telefone', 2 from public.contacts ct
           where ct.location_id = p_location
             and coalesce(private.phone_key(v.raw->'contact'->>'phone_number'), '') <> ''
             and private.phone_key(ct.phone) = private.phone_key(v.raw->'contact'->>'phone_number')
          union all
          select ct.id, 'e-mail', 3 from public.contacts ct
           where ct.location_id = p_location
             and coalesce(btrim(v.contact_email), '') <> ''
             and lower(btrim(ct.email)) = lower(btrim(v.contact_email))
          order by 3 limit 1
        ) x
    ),
    com_dono as (
      select cs.*, at.conversation_id as conv, at.created_at as atribuida_em
        from casada cs
        cross join lateral (
          select ev.conversation_id, ev.created_at,
                 regexp_replace(substring(ev.body from 13), '( \(estava offline\))?( · .*)?$', '') as alvo
            from public.messages ev
            join public.conversations c on c.id = ev.conversation_id
           where c.contact_id = cs.contact_id and ev.type = 'event'
             and ev.body like 'Atribuída a %' and ev.created_at <= cs.guru_created_at
           order by ev.created_at desc limit 1
        ) at
       where at.alvo = v_nome
    )
    select d.id::text, d.conv, d.contact_id,
           btrim(coalesce(ct.first_name, '') || ' ' || coalesce(ct.last_name, ''))::text,
           ct.phone::text, ct.email::text, d.guru_created_at,
           (coalesce(d.product_name, 'produto não informado')
            || ' · comprador na Guru: ' || coalesce(d.contact_name, '—')
            || ' · com ele desde ' || to_char(d.atribuida_em at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI'))::text,
           d.chave, d.amount::numeric
      from com_dono d
      left join public.contacts ct on ct.id = d.contact_id;
    return;
  end if;

  -- Período, a partir dos eventos de atribuição.
  return query
  with ev as (
    select e.id, e.conversation_id, e.created_at, e.body,
           case when e.body like 'Atribuída a %' then regexp_replace(substring(e.body from 13), '( \(estava offline\))?( · .*)?$', '') end as alvo
      from public.messages e
     where e.location_id = p_location and e.type = 'event'
       and e.created_at >= v_de - interval '7 days' and e.created_at < v_ate
       and (e.body like 'Atribuída a %' or e.body like 'Devolvida à fila%')
  ),
  membros as (
    select m.user_id, coalesce(nullif(btrim(p.name), ''), 'Sem nome') as nome
      from public.location_members m join public.profiles p on p.id = m.user_id
     where m.location_id = p_location
  ),
  atrib as (
    select ev.id, ev.conversation_id, ev.created_at, mb.user_id
      from ev join membros mb on mb.nome = ev.alvo
  ),
  seqd as (
    select ev.id, ev.conversation_id, ev.created_at, ev.body, mb.user_id,
           count(ev.alvo) over (partition by ev.conversation_id order by ev.created_at, ev.id) as g
      from ev left join membros mb on mb.nome = ev.alvo
  ),
  seq2 as (
    select s.*, (max(s.user_id::text) over (partition by s.conversation_id, s.g))::uuid as ultimo_dono
      from seqd s
  ),
  base as (
    -- recebidos / quentes / frios: conversa atribuída a ele no período
    select a.conversation_id, min(a.created_at) as quando, null::text as extra
      from atrib a
     where p_metrica in ('recebidos', 'quentes', 'frios')
       and a.user_id = p_usuario and a.created_at >= v_de
     group by a.conversation_id
    union all
    -- perdidos por espera: devolução cuja atribuição anterior era dele
    select s.conversation_id, s.created_at, s.body
      from seq2 s
     where p_metrica = 'perdidos_espera'
       and s.body like 'Devolvida à fila%' and s.body like '%cliente esperava%'
       and s.created_at >= v_de
       and s.ultimo_dono = p_usuario
  ),
  nota as (
    select distinct on (b.conversation_id) b.conversation_id, b.pontos, b.limiar, b.rotulo, b.resultado
      from public.bot_desfechos b
     where b.location_id = p_location and b.conversation_id in (select conversation_id from base)
     order by b.conversation_id, b.created_at desc
  )
  select (bs.conversation_id::text || '|' || bs.quando::text), bs.conversation_id, c.contact_id,
         btrim(coalesce(ct.first_name, '') || ' ' || coalesce(ct.last_name, ''))::text,
         ct.phone::text, ct.email::text, bs.quando,
         (case
            when n.pontos is not null and n.limiar is not null
              then (case when n.pontos >= n.limiar then 'quente' else 'frio' end)
                   || ' · ' || n.pontos || ' de ' || n.limiar || ' pontos'
            when n.conversation_id is not null then coalesce(n.rotulo, n.resultado, 'triado pelo bot')
            else 'sem nota do bot'
          end
          || case when c.closed_at is not null then ' · finalizada'
                  when c.assigned_to = p_usuario then ' · ainda com ele'
                  when c.assigned_to is null then ' · na fila'
                  else ' · hoje com outra pessoa' end
          || coalesce(' · ' || nullif(split_part(bs.extra, ' · ', 3), ''), ''))::text,
         null::text, null::numeric
    from base bs
    join public.conversations c on c.id = bs.conversation_id
    left join public.contacts ct on ct.id = c.contact_id
    left join nota n on n.conversation_id = bs.conversation_id
   where p_metrica not in ('quentes', 'frios')
      or (n.pontos is not null and n.limiar is not null
          and ((p_metrica = 'quentes' and n.pontos >= n.limiar)
            or (p_metrica = 'frios' and n.pontos < n.limiar)));
end;
$$;

revoke execute on function public.relatorio_comercial_leads(uuid, date, date, uuid, text) from public, anon;
grant execute on function public.relatorio_comercial_leads(uuid, date, date, uuid, text) to authenticated, service_role;

notify pgrst, 'reload schema';

notify pgrst, 'reload schema';
