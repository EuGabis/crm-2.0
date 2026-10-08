-- ============================================================
-- FUP de perdido quente: o card de ENTRADA vai junto (retroativo)
-- ============================================================
-- Pedido (2026-10-08): quando o FUP move o lead para Comercial → Perdido Quente,
-- o card do bot em "Controle de Leads → Qualificado" também deve sair. O código
-- novo faz isso daqui para frente; esta migração trata os que já ficaram para
-- trás (43 medidos).
--
-- Critério ESTREITO — as três condições juntas:
--   1. a rotina do FUP moveu este contato (evento "Lead movido para Comercial →
--      Perdido Quente" no fio);
--   2. o card dele no Comercial CONTINUA em Perdido Quente / lost — se um
--      vendedor o tirou de lá (cliente voltou), o lead está vivo e não se mexe;
--   3. o card de entrada está em Qualificado e ABERTO.
-- Destino: "Perdido" do próprio Controle de Leads (no Comercial já existe o
-- card do contato; levar este também duplicaria a pessoa em Perdido Quente).
--
-- Idempotente: na segunda execução não sobra card Qualificado aberto a mover.
-- ============================================================

do $$
declare
  n integer;
begin
  with movidos as (
    select distinct c.contact_id, c.location_id
      from public.messages m
      join public.conversations c on c.id = m.conversation_id
     where m.type = 'event'
       and m.body like 'Lead movido para Comercial → Perdido Quente%'
  ),
  ainda_perdidos as (
    select mv.contact_id
      from movidos mv
      join public.opportunities o on o.contact_id = mv.contact_id
      join public.pipelines p on p.id = o.pipeline_id and p.name = 'Comercial'
      join public.stages s on s.id = o.stage_id and s.name = 'Perdido Quente'
     where o.status = 'lost'
  ),
  alvo as (
    select o.id, perd.id as perdido_id
      from public.opportunities o
      join public.pipelines p on p.id = o.pipeline_id and p.name = 'Controle de Leads'
      join public.stages q on q.id = o.stage_id and q.name = 'Qualificado'
      join public.stages perd on perd.pipeline_id = p.id and perd.name = 'Perdido'
     where o.status = 'open'
       and o.contact_id in (select contact_id from ainda_perdidos)
  )
  update public.opportunities o
     set stage_id = alvo.perdido_id, status = 'lost'
    from alvo
   where o.id = alvo.id;

  get diagnostics n = row_count;
  -- ⚠️ Confira: o esperado é perto de 43. Zero = nome de funil/fase diferente
  -- do previsto neste banco, e nada foi movido (o lado seguro).
  raise notice 'cards de Controle de Leads movidos para Perdido: %', n;
end;
$$;
