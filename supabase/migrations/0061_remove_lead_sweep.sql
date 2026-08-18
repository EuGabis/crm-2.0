-- ============================================================
-- Lito CRM — Remove a varredura horária de distribuição de leads
--
-- Com a nova regra (online → só online; todos offline → rodízio igualitário entre
-- todos do pool, migração 0060), os leads nunca ficam mais "parados" esperando
-- alguém online. A varredura horária (0058/0059) virou desnecessária: removemos o
-- job do pg_cron, a função e as colunas de config no departamento.
-- Idempotente.
-- ============================================================
set check_function_bodies = off;

-- Desagenda o job horário (se existir).
select cron.unschedule('lito-lead-sweep')
where exists (select 1 from cron.job where jobname = 'lito-lead-sweep');

-- Remove a função da varredura.
drop function if exists private.lead_sweep_tick();

-- Remove a config de varredura do departamento (não é mais usada).
alter table public.departments
  drop column if exists sweep_enabled,
  drop column if exists sweep_pct;
