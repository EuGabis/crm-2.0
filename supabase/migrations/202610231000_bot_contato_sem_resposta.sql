-- "Como prefere o contato?" segue sozinho depois de 10 min sem resposta
-- (pedido 2026-10-23).
--
-- O nó `pergunta_contato` dos fluxos Triagem Comercial (`triagem`) e Triagem
-- Vendas (`triagem-vendas`) diz "Você vai ser direcionado para nosso consultor"
-- e só distribuía DEPOIS da resposta: 204 leads QUENTES em 30 dias ficaram sem
-- dono e fora da fila porque o cliente não respondeu. Com `semRespostaMin`, o
-- tick de minuto (`continuarPerguntasSemResposta`) leva a conversa para o
-- `next` do nó (handoff_consultor → rodízio), sem preferência registrada.
-- Vale também para os que JÁ estão parados ali: na primeira rodada, até 30 por
-- minuto.
-- Idempotente: só grava onde o nó existe.
update public.bot_flows
   set definition = jsonb_set(definition, '{nodes,pergunta_contato,semRespostaMin}', '10'::jsonb),
       updated_at = now()
 where key in ('triagem', 'triagem-vendas')
   and definition->'nodes' ? 'pergunta_contato';
