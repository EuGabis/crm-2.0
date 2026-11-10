-- Relatório comercial (pedido da diretoria, 10/11/2026).
-- Os vendedores são PJ e recebem também por taxa de conversão: a diretoria
-- precisa, por vendedor e por período, do que ele RECEBEU, do que está com ele
-- AGORA, do que ele PERDEU e do que ele VENDEU.
--
-- Uma linha por membro da empresa. Definições:
--   recebidos      leads DISTINTOS atribuídos a ele no período (evento
--                  "Atribuída a <nome>" do fio, gravado pelo gatilho da
--                  202608281530 em TODO caminho de atribuição). Um lead
--                  devolvido e reentregue conta UMA vez.
--   quentes/frios  desses, a nota da triagem do bot (pontos × limiar).
--   perdidos_espera vezes em que a conversa saiu DELE pela devolução por
--                  espera ("cliente esperava N min") no período.
--   com_ele_agora  conversas abertas com ele AGORA (estado atual).
--   sem_resposta   dessas, as em que a última mensagem é do CLIENTE.
--   pendentes      dessas, as recebidas offline ainda não abertas.
--   ganhos/perdidos_funil  cards dele com status won/lost, atualizados no
--                  período (o schema não guarda a data do ganho; updated_at
--                  é a aproximação, e a tela diz isso).
--   vendas_guru    vendas NOVAS (view payment_new_sales) com data na Guru no
--                  período, cujo comprador casa com um contato do CRM
--                  (CPF → telefone → e-mail), creditadas a quem estava com a
--                  conversa do contato no momento da venda: a ÚLTIMA
--                  atribuição antes da venda. Regra da diretoria: "entra como
--                  convertido se o vendedor vender para ele".
--
-- ⚠️ security definer com checagem de ADMIN na primeira linha (relatório de
-- remuneração não é assunto de todo atendente) e o par revoke/grant.
-- ⚠️ O nome no evento é casado pelo nome do perfil; quando um nome é prefixo de
-- outro ("Paulo" × "Paulo Lopes"), vence o mais longo.

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
  if not private.is_admin(p_location) then
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
    select e.id, e.conversation_id, e.created_at, e.body
      from public.messages e
      join public.conversations c on c.id = e.conversation_id
     where c.location_id = p_location
       and e.type = 'event'
       and e.created_at >= v_de - interval '60 days'
       and e.created_at < v_ate
       and (e.body like 'Atribuída a %' or e.body like 'Devolvida à fila%')
  ),
  atrib as (
    select distinct on (ev.id) ev.id, ev.conversation_id, ev.created_at, mb.user_id
      from ev
      join membros mb on ev.body like 'Atribuída a ' || mb.nome || ' %'
                      or ev.body = 'Atribuída a ' || mb.nome
     order by ev.id, length(mb.nome) desc
  ),
  -- O dono "antes" de uma devolução é a última atribuição anterior a ela.
  seq2 as (
    select s.*,
           (select a2.user_id from atrib a2
             where a2.conversation_id = s.conversation_id and a2.created_at < s.created_at
             order by a2.created_at desc limit 1) as ultimo_dono
      from ev s
     where s.body like 'Devolvida à fila%' and s.body like '%cliente esperava%'
       and s.created_at >= v_de
  ),
  perd as (
    select ultimo_dono as user_id, count(*)::int as n from seq2
     where ultimo_dono is not null group by 1
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
         where m.conversation_id = a.id
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
    select vc.id, vc.amount,
           (select a.user_id from atrib a
              join public.conversations c on c.id = a.conversation_id
             where c.contact_id = vc.contact_id and a.created_at <= vc.guru_created_at
             order by a.created_at desc limit 1) as user_id
      from venda_contato vc
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
grant execute on function public.relatorio_comercial(uuid, date, date) to authenticated;

notify pgrst, 'reload schema';
