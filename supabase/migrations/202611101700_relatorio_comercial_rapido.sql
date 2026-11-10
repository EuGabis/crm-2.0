-- Relatório comercial estourava o tempo limite (57014, 10/11/2026): LIKE por
-- membro + subconsulta por devolução sobre 60 dias de eventos. Agora: nome
-- extraído do evento e casado por igualdade, dono anterior por janela, 7 dias de
-- eventos e a última mensagem pelo índice de não apagadas. As rotas chamam com a
-- service role (sem o limite de 8 s do `authenticated`) depois de conferir
-- admin; pela sessão continua admin-only. Substitui 202611101500/202611101600.

drop function if exists public.relatorio_comercial(uuid, date, date);
create function public.relatorio_comercial(p_location uuid, p_de date, p_ate date)
returns table (
  usuario uuid,
  nome text,
  departamento text,
  recebidos int,
  quentes int,
  frios int,
  perdidos_espera int,
  com_ele_agora int,
  sem_resposta int,
  pendentes int,
  ganhos_funil int,
  perdidos_funil int,
  vendas_guru int,
  receita_guru numeric
)
language plpgsql
security definer
set search_path = public, private
stable
as $$
declare
  v_de timestamptz := (p_de::timestamp) at time zone 'America/Sao_Paulo';
  v_ate timestamptz := ((p_ate + 1)::timestamp) at time zone 'America/Sao_Paulo';
begin
  -- A rota confere admin e chama com a service role (sem o limite de 8 s do
  -- `authenticated`); pela sessão, continua exigindo admin.
  if coalesce(auth.role(), '') <> 'service_role' and not private.is_admin(p_location) then
    return;
  end if;

  return query
  with membros as (
    select m.user_id, coalesce(nullif(btrim(p.name), ''), 'Sem nome') as nome,
           d.name as depto
      from public.location_members m
      join public.profiles p on p.id = m.user_id
      left join public.departments d on d.id = m.department_id
     where m.location_id = p_location
  ),
  -- Eventos de atribuição/devolução das conversas tocadas no período, com 60
  -- dias para trás para saber de quem a conversa saiu.
  ev as (
    select e.id, e.conversation_id, e.created_at, e.body,
           case when e.body like 'Atribuída a %' then regexp_replace(substring(e.body from 13), '( \(estava offline\))?( · .*)?$', '') end as alvo
      from public.messages e
     where e.location_id = p_location
       and e.type = 'event'
       and e.created_at >= v_de - interval '7 days'
       and e.created_at < v_ate
       and (e.body like 'Atribuída a %' or e.body like 'Devolvida à fila%')
  ),
  -- Nome extraído do evento e casado por IGUALDADE (hash join). O LIKE por
  -- membro + subconsulta por devolução estourava o tempo limite.
  atrib as (
    select ev.id, ev.conversation_id, ev.created_at, mb.user_id
      from ev join membros mb on mb.nome = ev.alvo
  ),
  -- Dono "antes" de uma devolução = última atribuição anterior: g conta as
  -- atribuições até a linha, e o grupo (conversa, g) tem um dono só.
  seqd as (
    select ev.id, ev.conversation_id, ev.created_at, ev.body, mb.user_id,
           count(ev.alvo) over (partition by ev.conversation_id order by ev.created_at, ev.id) as g
      from ev left join membros mb on mb.nome = ev.alvo
  ),
  seq2 as (
    select s.*, (max(s.user_id::text) over (partition by s.conversation_id, s.g))::uuid as ultimo_dono
      from seqd s
  ),
  perd as (
    select ultimo_dono as user_id, count(*)::int as n from seq2
     where ultimo_dono is not null
       and body like 'Devolvida à fila%' and body like '%cliente esperava%'
       and created_at >= v_de
     group by 1
  ),
  rec as (
    select a.user_id, a.conversation_id from atrib a
     where a.created_at >= v_de
     group by 1, 2
  ),
  nota as (
    select distinct on (b.conversation_id) b.conversation_id, b.pontos, b.limiar
      from public.bot_desfechos b
     where b.location_id = p_location
       and b.conversation_id in (select conversation_id from rec)
     order by b.conversation_id, b.created_at desc
  ),
  rec_agg as (
    select r.user_id,
           count(*)::int as recebidos,
           count(*) filter (where n.pontos is not null and n.limiar is not null and n.pontos >= n.limiar)::int as quentes,
           count(*) filter (where n.pontos is not null and n.limiar is not null and n.pontos < n.limiar)::int as frios
      from rec r left join nota n on n.conversation_id = r.conversation_id
     group by 1
  ),
  abertas as (
    select c.assigned_to as user_id, c.id, c.assigned_offline
      from public.conversations c
     where c.location_id = p_location and c.assigned_to is not null
       and c.closed_at is null and c.archived_at is null
  ),
  abertas_agg as (
    select a.user_id,
           count(*)::int as agora,
           count(*) filter (where coalesce(a.assigned_offline, false))::int as pend,
           count(*) filter (where ult.direction = 'in')::int as sem_resp
      from abertas a
      left join lateral (
        select m.direction from public.messages m
         where m.conversation_id = a.id and m.deleted_at is null
           and m.type <> 'event' and not coalesce(m.internal, false)
         order by m.created_at desc limit 1
      ) ult on true
     group by 1
  ),
  funil as (
    select o.owner_id as user_id,
           count(*) filter (where o.status = 'won')::int as ganhos,
           count(*) filter (where o.status = 'lost')::int as perdidos
      from public.opportunities o
     where o.location_id = p_location and o.owner_id is not null
       and o.updated_at >= v_de and o.updated_at < v_ate
     group by 1
  ),
  vendas as (
    select s.id, s.amount, s.guru_created_at, e.raw, s.contact_email
      from public.payment_new_sales s
      join public.payment_events e on e.id = s.id
     where s.location_id = p_location
       and s.guru_created_at >= v_de and s.guru_created_at < v_ate
  ),
  venda_contato as (
    select v.id, v.amount, v.guru_created_at,
           coalesce(
             (select ct.id from public.contacts ct
               where ct.location_id = p_location
                 and private.doc_key(ct.doc) = private.doc_key(v.raw->'contact'->>'doc')
                 and private.doc_key(v.raw->'contact'->>'doc') <> '' limit 1),
             (select ct.id from public.contacts ct
               where ct.location_id = p_location
                 and private.phone_key(ct.phone) = private.phone_key(v.raw->'contact'->>'phone_number')
                 and coalesce(private.phone_key(v.raw->'contact'->>'phone_number'), '') <> '' limit 1),
             (select ct.id from public.contacts ct
               where ct.location_id = p_location
                 and lower(btrim(ct.email)) = lower(btrim(v.contact_email))
                 and coalesce(btrim(v.contact_email), '') <> '' limit 1)
           ) as contact_id
      from vendas v
  ),
  venda_vendedor as (
    select vc.id, vc.amount, mb.user_id
      from venda_contato vc
      left join lateral (
        select regexp_replace(substring(e.body from 13), '( \(estava offline\))?( · .*)?$', '') as alvo
          from public.messages e
          join public.conversations c on c.id = e.conversation_id
         where c.contact_id = vc.contact_id and e.type = 'event'
           and e.body like 'Atribuída a %' and e.created_at <= vc.guru_created_at
         order by e.created_at desc limit 1
      ) ult on true
      left join membros mb on mb.nome = ult.alvo
     where vc.contact_id is not null
  ),
  vendas_agg as (
    select user_id, count(*)::int as n, coalesce(sum(amount), 0)::numeric as total
      from venda_vendedor where user_id is not null group by 1
  )
  select mb.user_id::uuid,
         mb.nome::text,
         mb.depto::text,
         coalesce(ra.recebidos, 0)::int,
         coalesce(ra.quentes, 0)::int,
         coalesce(ra.frios, 0)::int,
         coalesce(pe.n, 0)::int,
         coalesce(aa.agora, 0)::int,
         coalesce(aa.sem_resp, 0)::int,
         coalesce(aa.pend, 0)::int,
         coalesce(fu.ganhos, 0)::int,
         coalesce(fu.perdidos, 0)::int,
         coalesce(va.n, 0)::int,
         coalesce(va.total, 0)::numeric
    from membros mb
    left join rec_agg ra on ra.user_id = mb.user_id
    left join perd pe on pe.user_id = mb.user_id
    left join abertas_agg aa on aa.user_id = mb.user_id
    left join funil fu on fu.user_id = mb.user_id
    left join vendas_agg va on va.user_id = mb.user_id
   order by coalesce(ra.recebidos, 0) desc, mb.nome;
end;
$$;

revoke execute on function public.relatorio_comercial(uuid, date, date) from public, anon;
grant execute on function public.relatorio_comercial(uuid, date, date) to authenticated, service_role;


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
