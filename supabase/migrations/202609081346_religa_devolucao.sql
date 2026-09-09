-- ============================================================
-- FASE 2 — aplicar SÓ DEPOIS do merge do código novo.
--
-- Neste projeto o código chega à produção ANTES da migração (deploy automático
-- no merge, migração à mão), então as duas coisas abaixo só são seguras quando
-- o código no ar já é o corrigido:
--
--  1) remover `public.conversas_esperando`, que é a função com a âncora errada
--     e que o código ANTIGO ainda chama;
--  2) religar `departments.devolver_apos_min`, zerado à mão em 2026-09-08 13:19
--     para estancar o laço de um ciclo por minuto.
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

-- 2. Religa a devolução com a régua acordada: 15 minutos ÚTEIS, a mesma da meta
--    de SLA (0079). Duas réguas para a mesma coisa só gerariam discussão sobre
--    qual vale.
--
-- 🔴 **CORRIGIDO em 2026-09-09, antes de ser aplicada.** A versão anterior era
-- `where devolver_apos_min = 0`, ou seja religava em TODOS os departamentos —
-- e o zero de todos eles não significava a mesma coisa: era o estancamento de
-- emergência do laço, aplicado em bloco às 13:19 de 08/09. Filtrar por ele
-- trataria "desligado às pressas" e "desligado de propósito" como a mesma
-- coisa.
--
-- ⚠️ E teria feito o OPOSTO de uma regra do Gabriel (09/09):
-- *"no comercial, uma vez que cair para ele, não é pra devolver ao rodízio —
-- eles podem mandar uma mensagem e o contato responder, mas não têm tempo para
-- retornar."* A devolução existe para a fila de espera da SECRETARIA, que foi
-- a queixa que a criou.
--
-- ⚠️ **Igualdade exata, nunca `ilike '%secretaria%'`:** "Secretaria Backup" é
-- justamente o departamento do time comercial (Alberto, Paulo, Rogério), e um
-- casamento por trecho ligaria a devolução exatamente onde ela não pode existir.
update public.departments set devolver_apos_min = 15 where name = 'Secretaria';

-- Desligado EXPLÍCITO onde a regra é não devolver. Hoje já estão em 0 — mas
-- "Vendas" nasceu com 15 na 202609021519, e sem esta linha ele voltaria a
-- devolver no dia em que o número novo for vinculado, sem ninguém relacionar as
-- duas coisas.
update public.departments
   set devolver_apos_min = 0
 where name in ('Vendas', 'Comercial', 'Secretaria Backup');

/*
 * ⚠️ CONFIRA AS LINHAS AFETADAS pelo primeiro update. Se ele disser 0 linhas, o
 * departamento não se chama exatamente "Secretaria" neste banco e a devolução
 * continua DESLIGADA — o que é seguro, mas não é o que esta migração pretende.
 * O estado final, por departamento:
 *
 *   select name, devolver_apos_min, usa_rodizio, intervalo_fila_min
 *     from public.departments order by name;
 *
 * Qualquer departamento fora das duas listas acima fica como está: 0 = desligado.
 */
