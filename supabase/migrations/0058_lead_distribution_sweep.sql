-- ============================================================
-- Lito CRM — Distribuição de leads: varredura automática (Etapa B)
--
-- Além da distribuição em tempo real (quando o lead vira quente) e do botão do
-- admin, uma varredura horária pega os leads QUENTES que ficaram "aguardando
-- distribuição" (ninguém online na hora) e distribui uma fração deles para quem
-- estiver online agora. Config por departamento:
--   - sweep_enabled: liga/desliga a varredura automática.
--   - sweep_pct: fração (%) dos parados distribuída a cada rodada (default 30).
-- A varredura roda via pg_cron chamando /api/leads/sweep (migração 0059).
-- Idempotente.
-- ============================================================
set check_function_bodies = off;

alter table public.departments
  add column if not exists sweep_enabled boolean not null default false,
  add column if not exists sweep_pct int not null default 30;
