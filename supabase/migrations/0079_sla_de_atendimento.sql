-- Lito CRM — SLA de atendimento (primeira resposta em minutos ÚTEIS)
--
-- A aba Relatórios → Agentes mostrava "tempo médio de resposta" e o número era
-- ficção em três camadas. Medido neste banco, 30 dias:
--
--  1. **Descartava tudo acima de 24h** (`MAX_RESPONSE_MIN` em
--     `lib/reports/snapshot.ts`), ou seja, escondia exatamente as piores
--     respostas — 25 conversas.
--  2. **Média, não mediana**: a média da primeira resposta era 675 min (11h) e a
--     MEDIANA, 14 min. O "1h 59min" que aparecia para um atendente era o
--     resultado de dois ou três casos extremos, não do atendimento dele.
--  3. **Não contava quem nunca foi respondido**: 56 das 245 conversas com
--     mensagem de cliente (23%) não tiveram UMA resposta humana, e não apareciam
--     em métrica nenhuma — o pior caso de atendimento era invisível.
--
-- Além disso o cálculo por agente usava `messages.created_by`, e 86% das saídas
-- estão com autor nulo — por isso 8 dos 10 atendentes liam "sem dados". Aqui a
-- conversa é atribuída ao seu RESPONSÁVEL (`conversations.assigned_to`), que
-- existe independentemente de quem digitou, e as conversas sem responsável
-- aparecem agrupadas como tal (são 224 de 359 — informação de gestão, não erro).

-- ---------- 1. Minutos dentro do expediente ----------
-- Decisão do Gabriel: seg–sex, 8h–19h (America/Sao_Paulo).
--
-- ⚠️ Sem isto a tela acusaria a equipe de violar SLA por não trabalhar no fim de
-- semana: dos 25 casos que passavam de 24h, 21 são de sexta ou sábado
-- respondidos na segunda. O relógio do SLA CONGELA fora do expediente — uma
-- mensagem de sábado 10h começa a contar segunda às 8h.
create or replace function private.business_minutes(t0 timestamptz, t1 timestamptz)
returns numeric
language plpgsql
stable
set search_path = ''
as $$
declare
  l0 timestamp;
  l1 timestamp;
  d date;
  total numeric := 0;
  voltas int := 0;
begin
  if t0 is null or t1 is null or t1 <= t0 then return 0; end if;
  -- A conta é feita no horário LOCAL: a janela de expediente é 8h–19h no
  -- relógio de quem atende, e o horário de verão (se voltar) muda o UTC
  -- correspondente sem mudar o expediente.
  l0 := t0 at time zone 'America/Sao_Paulo';
  l1 := t1 at time zone 'America/Sao_Paulo';
  d := l0::date;
  while d <= l1::date loop
    -- Teto de segurança: uma conversa esquecida há anos não pode virar um laço
    -- de dez mil voltas dentro de uma consulta de tela.
    voltas := voltas + 1;
    exit when voltas > 400;
    if extract(isodow from d) <= 5 then
      total := total + greatest(
        0,
        extract(epoch from (
          least(l1, (d + time '19:00')) - greatest(l0, (d + time '08:00'))
        )) / 60
      );
    end if;
    d := d + 1;
  end loop;
  return round(total, 2);
end;
$$;

-- ---------- 2. Uma linha por conversa, com o SLA já resolvido ----------
-- security definer + checagem de empresa NA PRIMEIRA LINHA (padrão da 0049):
-- `business_minutes` não é leakproof, então sob RLS o filtro sairia de baixo dos
-- índices. ⚠️ Ao mexer, mantenha o guard no topo — sem ele, `security definer`
-- significa "qualquer autenticado lê a conversa de qualquer empresa".
create or replace function public.sla_conversations(
  p_location uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_target_min int default 15
)
returns table (
  conversation_id uuid,
  contact_id uuid,
  contato text,
  canal text,
  assigned_to uuid,
  primeira_entrada timestamptz,
  primeira_resposta timestamptz,
  espera_util_min numeric,
  espera_corrida_min numeric,
  respondida boolean,
  dentro_da_meta boolean,
  fechada boolean,
  respondida_por_bot boolean
)
language plpgsql
security definer
stable
set search_path = public, private
as $$
begin
  if p_location is null or p_location not in (select private.user_locations()) then
    return;
  end if;

  return query
  with msgs as (
    select m.conversation_id, m.direction, m.created_at, coalesce(m.automated, false) as automated
    from public.messages m
    where m.location_id = p_location
      and m.created_at >= p_from
      and m.created_at < p_to
      -- Nota interna não é atendimento e mensagem de sistema não é resposta.
      and coalesce(m.internal, false) = false
      and coalesce(m.type, '') <> 'event'
  ),
  entrada as (
    select m.conversation_id, min(m.created_at) as t_in
    from msgs m
    where m.direction = 'in'
    group by m.conversation_id
  ),
  -- Primeira resposta HUMANA depois da primeira entrada. A automática é
  -- registrada à parte de propósito: o auto-responder responde em segundos e,
  -- contando como resposta, o SLA ficaria perfeito sem ninguém ter atendido.
  resposta_humana as (
    select m.conversation_id, min(m.created_at) as t_out
    from msgs m
    join entrada e on e.conversation_id = m.conversation_id
    where m.direction = 'out' and m.automated = false and m.created_at >= e.t_in
    group by m.conversation_id
  ),
  resposta_bot as (
    select m.conversation_id, min(m.created_at) as t_bot
    from msgs m
    join entrada e on e.conversation_id = m.conversation_id
    where m.direction = 'out' and m.automated and m.created_at >= e.t_in
    group by m.conversation_id
  )
  select
    e.conversation_id,
    c.contact_id,
    coalesce(nullif(btrim(ct.first_name || ' ' || ct.last_name), ''), 'Contato') as contato,
    coalesce(c.channel, 'whatsapp') as canal,
    c.assigned_to,
    e.t_in,
    r.t_out,
    -- Sem resposta ainda: a espera é contada até AGORA. Uma conversa aberta há
    -- três dias sem resposta não pode aparecer com espera zero.
    private.business_minutes(e.t_in, coalesce(r.t_out, now())) as espera_util_min,
    round(extract(epoch from (coalesce(r.t_out, now()) - e.t_in)) / 60, 2) as espera_corrida_min,
    r.t_out is not null as respondida,
    -- Nunca respondida NÃO é "dentro da meta", mesmo que a espera útil ainda
    -- esteja abaixo dela: por isso o `and`.
    (r.t_out is not null
      and private.business_minutes(e.t_in, r.t_out) <= p_target_min) as dentro_da_meta,
    c.closed_at is not null as fechada,
    b.t_bot is not null as respondida_por_bot
  from entrada e
  join public.conversations c on c.id = e.conversation_id
  left join public.contacts ct on ct.id = c.contact_id
  left join resposta_humana r on r.conversation_id = e.conversation_id
  left join resposta_bot b on b.conversation_id = e.conversation_id
  order by e.t_in desc;
end;
$$;

revoke all on function public.sla_conversations(uuid, timestamptz, timestamptz, int)
  from public, anon;
grant execute on function public.sla_conversations(uuid, timestamptz, timestamptz, int)
  to authenticated, service_role;

-- Índice do recorte por período: a função varre as mensagens da empresa numa
-- janela de datas, e sem isto é Seq Scan na tabela inteira.
create index if not exists messages_location_created_idx
  on public.messages (location_id, created_at desc);
