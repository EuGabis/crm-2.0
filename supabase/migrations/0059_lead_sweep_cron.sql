-- ============================================================
-- Lito CRM — Varredura horária de distribuição de leads (pg_cron)
-- Migração única: rode este arquivo inteiro de uma vez no SQL Editor.
--
-- PRÉ-REQUISITOS:
--   1. Rota /api/leads/sweep publicada em PRODUÇÃO na Vercel.
--   2. SUPABASE_SERVICE_ROLE_KEY e AUTOMATION_SECRET setados na Vercel.
--   3. A config `private.automation_config` já existe e tem o secret correto
--      (criada na migração 0009 das automações). Esta varredura REUSA essa
--      mesma URL base e secret — deriva a URL da varredura trocando o caminho.
--      Se você ainda não aplicou a 0009, aplique-a primeiro (ou crie a linha de
--      config com o secret real).
--
-- pg_cron e pg_net já estão habilitados no projeto.
-- ============================================================
set check_function_bodies = off;

-- Garante a tabela (idempotente; mesma forma da 0009). NÃO sobrescreve o secret.
create table if not exists private.automation_config (
  id boolean primary key default true check (id),
  tick_url text not null,
  secret text not null
);
revoke all on private.automation_config from anon, authenticated;

-- Função que chama a rota da varredura reaproveitando URL base + secret da 0009.
create or replace function private.lead_sweep_tick()
returns void
language plpgsql security definer set search_path = '' as $$
declare
  cfg record;
begin
  select * into cfg from private.automation_config where id;
  if not found then
    return; -- sem config (aplique a 0009 e defina o secret) → não faz nada
  end if;

  perform net.http_post(
    url     := replace(cfg.tick_url, '/api/automations/tick', '/api/leads/sweep'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-automation-secret', cfg.secret
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 15000
  );
end;
$$;

revoke all on function private.lead_sweep_tick() from public, anon, authenticated;

-- Agenda no minuto 0 de cada hora.
select cron.unschedule('lito-lead-sweep')
where exists (select 1 from cron.job where jobname = 'lito-lead-sweep');

select cron.schedule('lito-lead-sweep', '0 * * * *', $$select private.lead_sweep_tick()$$);

-- ---------- Verificação (rode depois de aplicar) ----------
-- select jobname, schedule, active from cron.job where jobname = 'lito-lead-sweep';
-- select status_code, count(*) from net._http_response
--   where created > now() - interval '65 minutes' group by status_code;  -> 200
