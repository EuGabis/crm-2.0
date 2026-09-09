-- ============================================================
-- FASE 2 — aplicar SÓ DEPOIS do merge do código novo.
--
-- Neste projeto o código chega à produção ANTES da migração (deploy automático
-- no merge, migração à mão), então as duas coisas abaixo só são seguras quando
-- o código no ar já é o corrigido:
--
--  1) remover `public.conversas_esperando`, que é a função com a âncora errada
--     e que o código ANTIGO ainda chama;
--  2) religar `departments.devolver_apos_min` — SÓ na Secretaria —, zerado à mão
--     em 2026-09-08 13:19 para estancar o laço de um ciclo por minuto. O
--     comercial NÃO tem devolução por decisão do Gabriel (ver o comentário no
--     próprio `update`).
--
-- ⚠️ Aplicar isto ANTES do merge REINTRODUZ o laço em produção.
--
-- Idempotente.
-- ============================================================

-- 1. A função da âncora errada sai de cena.
--    Ela reportava 688 min para quem esperava 137 e ZERO para quem esperava
--    3.301 — o número dependia de quando se olhava. Substituída por
--    `public.conversas_paradas` (202609081345).
drop function if exists public.conversas_esperando(uuid, integer);

-- 2. Religa a devolução — SÓ na Secretaria.
/*
 * 🔴 **Este `update` dizia `where devolver_apos_min = 0` e religaria TODOS os
 * setores.** Corrigido em 2026-09-09, antes de ser aplicado, a partir do
 * Gabriel: *"aqui em devolver ao rodízio, o comercial não vai ter isso — eles
 * podem mandar uma mensagem e o contato responder, mas não tem tempo para eles
 * retornarem"*.
 *
 * A regra faz sentido e vale a pena entender por quê: a devolução mede a espera
 * do CLIENTE e assume que existe um prazo para responder. No comercial não
 * existe — a conversa de venda vai e volta no ritmo do cliente, e tirar o lead
 * do vendedor que está negociando seria pior que deixá-lo parado.
 *
 * ⚠️ O zero foi posto à mão em 08/09 para estancar o laço, então "está zerado"
 * NÃO distingue "desligado de propósito" de "desligado às pressas". Por isso o
 * filtro é pelo NOME do setor, e não pelo valor: é o único jeito de religar só
 * quem tinha antes.
 *
 * ⚠️ E o Financeiro fica de fora por outro motivo: ele tem `usa_rodizio = false`,
 * então a devolução nem seria alcançada — religar ali só criaria um número
 * enganoso na tela do departamento.
 */
update public.departments
   set devolver_apos_min = 15
 where name = 'Secretaria'
   and devolver_apos_min = 0;
