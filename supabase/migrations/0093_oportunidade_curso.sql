-- ============================================================
-- Lito CRM — Curso da oportunidade (card do funil)
--
-- O card do funil passa a ter um seletor de CURSO (lista de formações da Lito
-- Aviation Academy). Guardado direto na oportunidade — é um atributo do lead
-- naquele funil, não do contato. As policies de opportunities (RLS 0039) já
-- cobrem SELECT/UPDATE; nada de política nova.
-- Idempotente.
-- ============================================================
alter table public.opportunities
  add column if not exists course text;
