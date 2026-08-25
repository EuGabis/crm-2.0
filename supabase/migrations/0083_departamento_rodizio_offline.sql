-- ============================================================
-- Lito CRM — Rodízio distribui mesmo para quem está offline (por departamento)
--
-- Pedido do Gabriel: na Secretaria o rodízio deve distribuir para todos do pool
-- mesmo que estejam offline (hoje, se alguém está online, só os online recebem;
-- offline só entra quando TODOS estão offline).
--
-- Flag por departamento. Default FALSE = comportamento atual (online primeiro).
-- Idempotente.
-- ============================================================
alter table public.departments
  add column if not exists rodizio_offline boolean not null default false;
