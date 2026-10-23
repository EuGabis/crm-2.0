-- "Como prefere o contato?": o bot chama o cliente de novo e, sem resposta,
-- segue para o consultor (pedido 2026-10-23).
--
-- O nó `pergunta_contato` dos fluxos Triagem Comercial (`triagem`) e Triagem
-- Vendas (`triagem-vendas`) diz "Você vai ser direcionado para nosso consultor"
-- e só distribuía DEPOIS da resposta: 204 leads QUENTES em 30 dias ficaram sem
-- dono e fora da fila porque o cliente não respondeu.
--
-- Com `semRespostaMin`, o tick de minuto (`continuarPerguntasSemResposta`):
--   1. depois de 10 min sem resposta, manda `lembreteSemResposta` + a pergunta
--      de novo (só dentro da janela de 24h — fora dela a Meta recusa);
--   2. depois de mais 10 min sem resposta, segue para o `next` do nó
--      (handoff_consultor → rodízio), sem preferência registrada.
-- O acumulado antigo (parado há dias, fora da janela) segue direto para o
-- consultor, até 30 por minuto.
-- Idempotente: só grava onde o nó existe.
update public.bot_flows
   set definition = jsonb_set(
         jsonb_set(definition, '{nodes,pergunta_contato,semRespostaMin}', '10'::jsonb),
         '{nodes,pergunta_contato,lembreteSemResposta}',
         to_jsonb('{{first_name}}, ainda está por aí? 🙂 Só preciso dessa resposta para te passar ao nosso consultor de carreira:'::text)
       ),
       updated_at = now()
 where key in ('triagem', 'triagem-vendas')
   and definition->'nodes' ? 'pergunta_contato';
