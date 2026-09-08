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
update public.departments set devolver_apos_min = 15 where devolver_apos_min = 0;
