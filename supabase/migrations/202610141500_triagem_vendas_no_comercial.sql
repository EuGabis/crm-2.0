-- Lito CRM — a Triagem Vendas cria o card no funil COMERCIAL (2026-10-14).
--
-- Relato do Gabriel: "na pipe, o bot não está criando os leads e enviando para
-- as colunas" — "pipe que deve ir os leads: Comercial".
--
-- A causa: a Triagem Vendas (202610131500) é cópia da Triagem Comercial, e os
-- nós de card dela apontavam para o funil "Controle de Leads". Regra nova:
--   lead chegou → Comercial / Entrada
--   quente      → Comercial / Qualificado
--   frio        → Comercial / Perdido Frio
--
-- Só o fluxo `triagem-vendas` muda. A Triagem Comercial (`triagem`) e a da
-- Secretaria continuam no Controle de Leads.
--
-- ⚠️ ABORTA se o funil Comercial ou uma das três colunas não existir com esse
-- nome: gravar o fluxo apontando para coluna inexistente faria o card cair na
-- primeira coluna sem ninguém perceber — o defeito que se veio consertar.
--
-- ⚠️ O card de leads que JÁ passaram pelo bot continua no Controle de Leads; a
-- regra vale para os próximos.

do $$
declare
  r        record;
  nodes    jsonb;
  k        text;
  n        jsonb;
  quente   text;
  frio     text;
  pid      uuid;
  falta    text;
  alterados int := 0;
begin
  for r in select location_id, definition from public.bot_flows where key = 'triagem-vendas' loop
    select p.id into pid from public.pipelines p
     where p.location_id = r.location_id and lower(btrim(p.name)) = 'comercial'
     limit 1;
    if pid is null then
      raise exception 'Empresa %: funil "Comercial" não encontrado — nada foi gravado', r.location_id;
    end if;
    select string_agg(nome, ', ') into falta
      from unnest(array['entrada', 'qualificado', 'perdido frio']) as nome
     where not exists (
       select 1 from public.stages s where s.pipeline_id = pid and lower(btrim(s.name)) = nome
     );
    if falta is not null then
      raise exception 'Empresa %: funil Comercial sem a(s) coluna(s) % — nada foi gravado', r.location_id, falta;
    end if;

    nodes := r.definition -> 'nodes';

    -- As chaves do stageMap são o hotValue/coldValue do nó de score (normalizados).
    select lower(value ->> 'hotValue'), lower(value ->> 'coldValue') into quente, frio
      from jsonb_each(nodes) where value ->> 'type' = 'score' limit 1;
    quente := coalesce(nullif(quente, ''), 'quente');
    frio   := coalesce(nullif(frio, ''), 'frio');

    for k, n in select key, value from jsonb_each(nodes) loop
      if n ->> 'type' = 'ensure_card' then
        nodes := jsonb_set(nodes, array[k], n || jsonb_build_object('pipeline', 'Comercial', 'stage', 'Entrada'));
      elsif n ->> 'type' = 'sync_card' then
        nodes := jsonb_set(nodes, array[k], n || jsonb_build_object(
          'pipeline', 'Comercial',
          'stageMap', jsonb_build_object(quente, 'Qualificado', frio, 'Perdido Frio')));
      elsif n ->> 'type' = 'distribute' then
        nodes := jsonb_set(nodes, array[k], n || jsonb_build_object('pipeline', 'Comercial'));
      end if;
    end loop;

    update public.bot_flows
       set definition = jsonb_set(definition, '{nodes}', nodes), updated_at = now()
     where location_id = r.location_id and key = 'triagem-vendas';
    alterados := alterados + 1;
  end loop;

  raise notice 'Triagem Vendas apontada para o Comercial em % empresa(s)', alterados;
  if alterados = 0 then
    raise warning 'Nenhum fluxo triagem-vendas encontrado — nada foi alterado';
  end if;
end $$;

-- Para conferir:
--   select key, value ->> 'type' as tipo, value ->> 'pipeline' as funil,
--          value ->> 'stage' as coluna, value -> 'stageMap' as mapa
--     from public.bot_flows, jsonb_each(definition -> 'nodes')
--    where key = 'triagem-vendas' and value ->> 'type' in ('ensure_card','sync_card','distribute');
