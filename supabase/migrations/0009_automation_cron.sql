-- ============================================================
-- Lito CRM — Automações: agendamento pelo pg_cron
-- Migração única: rode este arquivo inteiro de uma vez no SQL Editor.
--
-- PRÉ-REQUISITOS (antes de aplicar):
--   1. Rota /api/automations/tick publicada em PRODUÇÃO na Vercel.
--   2. SUPABASE_SERVICE_ROLE_KEY e AUTOMATION_SECRET setados na Vercel
--      (production) — senão a rota responde 500/401.
--   3. Substitua 'COLE_O_AUTOMATION_SECRET_AQUI' abaixo pelo MESMO valor
--      de AUTOMATION_SECRET que está no .env.local e na Vercel.
--
-- pg_cron e pg_net já estão habilitados no projeto.
-- ============================================================
set check_function_bodies = off;

-- ---------- Config do tick (fora do alcance da API: schema private) ----------
create table if not exists private.automation_config (
  id boolean primary key default true check (id),
  tick_url text not null,
  secret text not null
);
revoke all on private.automation_config from anon, authenticated;

-- Valores reais preenchidos aqui no SQL Editor (o secret NÃO fica no git).
insert into private.automation_config (id, tick_url, secret)
values (
  true,
  'https://lito-crm.vercel.app/api/automations/tick',
  'COLE_O_AUTOMATION_SECRET_AQUI'
)
on conflict (id) do update
  set tick_url = excluded.tick_url,
      secret   = excluded.secret;

-- ---------- Função que chama a rota do motor ----------
create or replace function private.automation_tick()
returns void
language plpgsql security definer set search_path = '' as $$
declare
  cfg record;
begin
  select * into cfg from private.automation_config where id;
  if not found then
    return;
  end if;

  perform net.http_post(
    url     := cfg.tick_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-automation-secret', cfg.secret
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 8000
  );
end;
$$;

revoke all on function private.automation_tick() from public, anon, authenticated;

-- ---------- Agendar a cada minuto ----------
select cron.unschedule('lito-automation-tick')
where exists (select 1 from cron.job where jobname = 'lito-automation-tick');

select cron.schedule('lito-automation-tick', '* * * * *', $$select private.automation_tick()$$);

-- ---------- Verificação (rode depois de aplicar) ----------
-- select jobname, schedule, active from cron.job where jobname = 'lito-automation-tick';
-- select status_code, count(*) from net._http_response
--   where created > now() - interval '5 minutes' group by status_code;
--   -> esperado: 200
