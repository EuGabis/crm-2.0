-- Lito CRM — "Leads do dia" com Comercial + Vendas UNIFICADO (2026-10-14).
--
-- Relato do Gabriel: "com o bot novo, no relatório de leads perdemos o
-- histórico — deixe unificado, comercial e vendas".
--
-- 🔴 A causa: `triagem_leads` recorta pelo bot ATUAL do número
-- (`whatsapp_channels.bot_flow = p_flow`) e pelo `flow_key` do desfecho. Quando o
-- número passou de `triagem` para `triagem-vendas` (202610131500):
--   - a aba Comercial ficou VAZIA — nenhum número roda mais `triagem`;
--   - a aba Vendas trouxe as conversas antigas do número, mas os desfechos delas
--     são `flow_key = 'triagem'` e não casavam: todo lead antigo aparecia como
--     "não concluiu".
--
-- `p_flow` passa a aceitar VÁRIOS fluxos separados por vírgula
-- ("triagem,triagem-vendas"). Um fluxo só continua funcionando igual, então o
-- código no ar não percebe — pode ser aplicada antes ou depois do merge.
--
-- ⚠️ Mesma assinatura e mesmo retorno → `create or replace` (os grants ficam).
-- O corpo é o da 202609161400, com só as duas comparações trocadas por `any`.

begin;

create or replace function public.triagem_leads(
  p_location uuid,
  p_de date,
  p_ate date,
  p_flow text default null
)
returns table (
  conversa uuid,
  dia date,
  hora smallint,
  resultado text,
  pontos integer,
  atendente uuid,
  finalizada boolean,
  ganha boolean,
  curso text,
  contato_id uuid,
  contato text,
  telefone text
)
language plpgsql
stable
security definer
set search_path to 'public', 'private'
as $fn$
declare
  -- Vários fluxos separados por vírgula: "triagem,triagem-vendas".
  v_flows text[] := string_to_array(replace(coalesce(p_flow, ''), ' ', ''), ',');
begin
  -- Checagem de empresa na PRIMEIRA linha (padrão 0049).
  if p_location not in (select private.user_locations()) then
    return;
  end if;

  return query
  with canais as (
    select ch.id
      from public.whatsapp_channels ch
     where ch.location_id = p_location
       and (p_flow is null or ch.bot_flow = any(v_flows))
  ),
  chegou as (
    /*
     * O universo do relatório: uma linha por conversa que ENTROU no período.
     * Sai de `conversations.created_at` e exige mensagem de ENTRADA — conversa
     * aberta pelo CRM ("Nova conversa") não é lead que chegou.
     */
    select cv.id, cv.created_at, cv.contact_id, cv.assigned_to, cv.closed_at
      from public.conversations cv
     where cv.location_id = p_location
       and cv.channel_id in (select id from canais)
       and (cv.created_at at time zone 'America/Sao_Paulo')::date between p_de and p_ate
       and exists (
         select 1 from public.messages m
          where m.conversation_id = cv.id and m.direction = 'in'
       )
  ),
  primeiro as (
    /*
     * ⚠️ **Uma conversa = um lead = UM desfecho**, e vale o PRIMEIRO. A conversa
     * que reabre passa pelo bot de novo (o webhook zera a sessão) e gera outra
     * linha na tabela, que é append-only de propósito.
     */
    select distinct on (d.conversation_id)
           d.conversation_id, d.resultado, d.pontos
      from public.bot_desfechos d
     where d.location_id = p_location
       and (p_flow is null or d.flow_key = any(v_flows))
       and d.conversation_id is not null
     order by d.conversation_id, d.created_at
  )
  select chegou.id,
         (chegou.created_at at time zone 'America/Sao_Paulo')::date,
         extract(hour from chegou.created_at at time zone 'America/Sao_Paulo')::smallint,
         primeiro.resultado,
         primeiro.pontos,
         chegou.assigned_to,
         (chegou.closed_at is not null),
         coalesce(op.status = 'won', false),
         op.course,
         chegou.contact_id,
         -- ⚠️ O nome vai JUNTO, e não é conveniência: a lista que o quadro abre
         -- precisa dizer de QUEM é cada lead, e resolver contato por contato no
         -- navegador seria uma consulta por linha numa lista de centenas.
         nullif(btrim(coalesce(ct.first_name, '') || ' ' || coalesce(ct.last_name, '')), ''),
         ct.phone
    from chegou
    left join primeiro on primeiro.conversation_id = chegou.id
    left join public.contacts ct on ct.id = chegou.contact_id
    /*
     * ⚠️ `left join lateral ... limit 1` e não um `join` comum: um contato pode
     * ter vários cards, e sem o `limit` o mesmo lead viraria duas linhas —
     * quebrando a soma que faz as fatias do gráfico fecharem com "entraram".
     */
    left join lateral (
      select o.status, o.course
        from public.opportunities o
       where o.location_id = p_location
         and o.contact_id = chegou.contact_id
       order by o.created_at desc
       limit 1
    ) op on true
   -- Ordem ESTÁVEL: é o que torna a paginação da rota correta por construção.
   order by chegou.created_at desc, chegou.id;
end;
$fn$;

revoke execute on function public.triagem_leads(uuid, date, date, text) from public, anon;
grant execute on function public.triagem_leads(uuid, date, date, text) to authenticated;

notify pgrst, 'reload schema';

commit;
