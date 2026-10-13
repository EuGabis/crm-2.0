-- Lito CRM — bot "Triagem Vendas": CÓPIA da Triagem Comercial com a nova
-- qualificação (2026-10-13).
--
-- Pedido do Gabriel: "crie um bot novo e não substitua o atual" e "use o bot
-- Triagem Comercial como exemplo e só vamos mudar as perguntas de
-- qualificação".
--
-- ⚠️ **A cópia é feita do BANCO, não do código.** O fluxo que roda em produção é
-- `bot_flows.definition` (key `triagem`), editado pela tela ao longo de semanas;
-- o fluxo embutido em `flows/triagem.ts` é outro (a triagem por assunto). Copiar
-- do código traria funil, etapas e textos diferentes dos que estão no ar.
--
-- O que muda (e NADA mais):
--   pergunta com var `conhece_lito` → "Quando você pretende começar o curso?"
--                                    (var `inicio`)
--   pergunta com var `objetivo`     → "Se você gostar das condições, como
--                                    pretende fazer o investimento?" (var
--                                    `investimento`)
--   nó `score`                      → pesos de `inicio` + `investimento`,
--                                    limiar 10
-- O `id` e o `next` de cada nó são PRESERVADOS: a ordem do fluxo, o funil, as
-- etapas do card e o que acontece com quente/frio continuam os da Triagem
-- Comercial.
--
-- ⚠️ Os nós são achados pela VARIÁVEL (e pelo tipo, no score), não pelo id: o id
-- pode ter mudado no editor. Se algum dos três não for encontrado, a migração
-- ABORTA em vez de gravar um bot pela metade.
--
-- ⚠️ Os pesos são casados pelo `value` normalizado (minúsculo, sem acento) — é
-- o que `normalize()` faz em `lib/bot/types.ts`.
--
-- A Triagem Comercial (`triagem`) não é alterada. Reexecutar sobrescreve só a
-- cópia (`triagem-vendas`), refeita a partir do original.

do $$
declare
  r           record;
  def         jsonb;
  nodes       jsonb;
  k_conhece   text;
  k_objetivo  text;
  k_score     text;
  n           jsonb;
  copias      int := 0;
begin
  for r in select location_id, definition from public.bot_flows where key = 'triagem' loop
    def := r.definition;
    nodes := def -> 'nodes';
    k_conhece := null; k_objetivo := null; k_score := null;

    select key into k_conhece  from jsonb_each(nodes) where value ->> 'var' = 'conhece_lito' and value ->> 'type' = 'ask' limit 1;
    select key into k_objetivo from jsonb_each(nodes) where value ->> 'var' = 'objetivo'     and value ->> 'type' = 'ask' limit 1;
    select key into k_score    from jsonb_each(nodes) where value ->> 'type' = 'score' limit 1;

    if k_conhece is null or k_objetivo is null or k_score is null then
      raise exception 'Triagem Comercial da empresa % sem os nós esperados (conhece_lito=%, objetivo=%, score=%) — nada foi gravado',
        r.location_id, k_conhece, k_objetivo, k_score;
    end if;

    -- 3) Quando começa
    n := nodes -> k_conhece;
    nodes := jsonb_set(nodes, array[k_conhece], n || jsonb_build_object(
      'text', '{{first_name}}, quando você pretende começar o curso?',
      'var', 'inicio',
      'listButton', 'Responder',
      'options', jsonb_build_array(
        jsonb_build_object('id','ini_agora','title','Quero começar agora','value','Quero começar agora'),
        jsonb_build_object('id','ini_2a3','title','Em 2 ou 3 meses','description','Nos próximos 2 ou 3 meses','value','Nos próximos 2 ou 3 meses'),
        jsonb_build_object('id','ini_12','title','Nos próximos 12 meses','value','Nos próximos 12 meses'),
        jsonb_build_object('id','ini_pesquisando','title','Só pesquisando','description','Só estou pesquisando por enquanto','value','Só estou pesquisando por enquanto')
      )
    ));

    -- 4) Como investe
    n := nodes -> k_objetivo;
    nodes := jsonb_set(nodes, array[k_objetivo], n || jsonb_build_object(
      'text', '{{first_name}}, se você gostar das condições, como pretende fazer o investimento?',
      'var', 'investimento',
      'listButton', 'Responder',
      'options', jsonb_build_array(
        jsonb_build_object('id','inv_avista','title','À vista','value','À vista'),
        jsonb_build_object('id','inv_cartao','title','Parcelado no cartão','value','Parcelado no cartão'),
        jsonb_build_object('id','inv_ajuda','title','Preciso de ajuda','description','Preciso de ajuda pra encontrar uma condição que caiba no meu bolso','value','Preciso de ajuda pra encontrar uma condição que caiba no meu bolso'),
        jsonb_build_object('id','inv_nao','title','Não consigo investir','description','No momento não consigo investir','value','No momento não consigo investir')
      )
    ));

    -- Régua: só as perguntas 3 e 4 pontuam, soma >= 10 = quente.
    n := nodes -> k_score;
    nodes := jsonb_set(nodes, array[k_score], n || jsonb_build_object(
      'threshold', 10,
      'weights', jsonb_build_object(
        'inicio', jsonb_build_object(
          'quero comecar agora', 10,
          'nos proximos 2 ou 3 meses', 6,
          'nos proximos 12 meses', 3,
          'so estou pesquisando por enquanto', 0),
        'investimento', jsonb_build_object(
          'a vista', 10,
          'parcelado no cartao', 8,
          'preciso de ajuda pra encontrar uma condicao que caiba no meu bolso', 4,
          'no momento nao consigo investir', 0)
      )
    ));

    def := def || jsonb_build_object(
      'key', 'triagem-vendas',
      'name', 'Triagem Vendas (nova qualificação)',
      'nodes', nodes
    );

    insert into public.bot_flows (location_id, key, name, definition, updated_at)
    values (r.location_id, 'triagem-vendas', 'Triagem Vendas (nova qualificação)', def, now())
    on conflict (location_id, key) do update
      set name = excluded.name, definition = excluded.definition, updated_at = now();

    copias := copias + 1;
  end loop;

  raise notice 'Triagem Vendas criada a partir da Triagem Comercial em % empresa(s)', copias;
  if copias = 0 then
    raise warning 'Nenhuma Triagem Comercial (key = triagem) encontrada — nada foi copiado';
  end if;
end $$;

-- Para conferir (o original não muda; a cópia tem as perguntas novas):
--   select key, name,
--          definition -> 'nodes' -> (select key from jsonb_each(definition->'nodes')
--                                     where value->>'type' = 'score' limit 1) -> 'threshold' as limiar
--     from public.bot_flows where key in ('triagem', 'triagem-vendas');
