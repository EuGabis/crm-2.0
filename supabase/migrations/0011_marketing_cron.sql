-- ============================================================
-- Lito CRM — Email Marketing: agendamento pelo pg_cron
-- Migração única: rode este arquivo inteiro de uma vez no SQL Editor.
--
-- PRÉ-REQUISITOS (antes de aplicar):
--   1. Migração 0010 aplicada.
--   2. Rota /api/marketing/tick publicada em PRODUÇÃO na Vercel.
--   3. SUPABASE_SERVICE_ROLE_KEY e AUTOMATION_SECRET setados na Vercel (production).
--   4. Substitua 'COLE_O_AUTOMATION_SECRET_AQUI' pelo MESMO valor de AUTOMATION_SECRET
--      (o mesmo do motor de automações — é o segredo máquina-a-máquina compartilhado).
--
-- pg_cron e pg_net já estão habilitados no projeto.
-- ============================================================
set check_function_bodies = off;

-- ---------- Config do tick de marketing (schema private, fora da API) ----------
create table if not exists private.marketing_config (
  id boolean primary key default true check (id),
  tick_url text not null,
  secret text not null
);
revoke all on private.marketing_config from anon, authenticated;

insert into private.marketing_config (id, tick_url, secret)
values (
  true,
  'https://lito-crm.vercel.app/api/marketing/tick',
  'COLE_O_AUTOMATION_SECRET_AQUI'
)
on conflict (id) do update
  set tick_url = excluded.tick_url,
      secret   = excluded.secret;

-- ---------- Função que chama a rota do envio ----------
create or replace function private.marketing_tick()
returns void
language plpgsql security definer set search_path = '' as $$
declare
  cfg record;
begin
  select * into cfg from private.marketing_config where id;
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

revoke all on function private.marketing_tick() from public, anon, authenticated;

-- ---------- Agendar a cada minuto ----------
select cron.unschedule('lito-marketing-tick')
where exists (select 1 from cron.job where jobname = 'lito-marketing-tick');

select cron.schedule('lito-marketing-tick', '* * * * *', $$select private.marketing_tick()$$);

-- ---------- Verificação (rode depois de aplicar) ----------
-- select jobname, schedule, active from cron.job where jobname = 'lito-marketing-tick';
-- select status_code, count(*) from net._http_response
--   where created > now() - interval '5 minutes' group by status_code;  -- esperado: 200
