-- ============================================================
-- Lito CRM — Parametrizar por departamento: rodízio e logout por inatividade
--
-- Pedido do Gabriel:
--   1. Nem todo departamento distribui leads por rodízio — poder ligar/desligar.
--   2. Escolher quais departamentos têm a regra do "logout em 10 min" (o auto-
--      logout por inatividade que hoje vale para todo papel "user").
--
-- Duas flags no departamento. Default TRUE nas duas para NÃO mudar o comportamento
-- atual ao aplicar — o admin desliga onde não quiser. Idempotente.
-- ============================================================
alter table public.departments
  add column if not exists usa_rodizio boolean not null default true;

alter table public.departments
  add column if not exists logout_inatividade boolean not null default true;
