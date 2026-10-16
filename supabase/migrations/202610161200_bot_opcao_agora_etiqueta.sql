-- Pedido de 2026-10-16: lead que responde "Quero começar agora" na pergunta
-- "quando você pretende começar o curso?" ganha a etiqueta "Agora".
--
-- O motor passou a aplicar `tag` de QUALQUER opção de lista (antes só a do
-- curso). Esta migração só põe `"tag": "Agora"` nas opções cujo título ou valor
-- contém "começar agora", em todos os fluxos (rascunho = definição gravada).
-- Casar pelo texto e não pelo id: o fluxo é editável e o id pode ter mudado.
-- Idempotente: opção que já tem `tag` não é tocada.
do $$
declare
  r record;
  nodes jsonb;
  k text;
  nd jsonb;
  opts jsonb;
  o jsonb;
  novas jsonb;
  mexeu boolean;
  total int := 0;
begin
  for r in select id, definition from public.bot_flows where definition ? 'nodes' loop
    nodes := r.definition -> 'nodes';
    mexeu := false;
    for k, nd in select key, value from jsonb_each(nodes) loop
      opts := nd -> 'options';
      if opts is null or jsonb_typeof(opts) <> 'array' then continue; end if;
      novas := '[]'::jsonb;
      for o in select value from jsonb_array_elements(opts) loop
        if not (o ? 'tag')
           and translate(lower(coalesce(o->>'title','') || ' ' || coalesce(o->>'value','')), 'çÇ', 'cc') like '%comecar agora%' then
          o := o || jsonb_build_object('tag', 'Agora');
          mexeu := true;
          total := total + 1;
        end if;
        novas := novas || jsonb_build_array(o);
      end loop;
      nodes := jsonb_set(nodes, array[k, 'options'], novas);
    end loop;
    if mexeu then
      update public.bot_flows set definition = jsonb_set(definition, '{nodes}', nodes), updated_at = now()
       where id = r.id;
    end if;
  end loop;
  raise notice 'opções marcadas com a etiqueta Agora: %', total;
end $$;
