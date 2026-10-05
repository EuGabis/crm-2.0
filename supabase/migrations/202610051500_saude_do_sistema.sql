-- ============================================================
-- Saúde do sistema (Configurações → Saúde, só administrador)
--
-- Um retrato do que roda POR TRÁS da tela: crons, chamadas HTTP do pg_net,
-- filas (automações, agendadas, transcrição, marketing, leads), canais de
-- WhatsApp, Guru, IA e o próprio Postgres (conexões, consultas lentas).
--
-- ⚠️ `security definer` porque `cron.*`, `net._http_response` e
-- `pg_stat_activity` não são legíveis pelo papel `authenticated`. A checagem
-- de ADMIN é a primeira coisa que roda (padrão 0049) — sem ela, qualquer
-- autenticado leria consultas em execução de todo o banco.
--
-- ⚠️ Cada bloco tem o próprio `exception`: este painel existe para o dia em que
-- algo está quebrado, e um bloco falhando (ex.: pg_cron sem permissão) não pode
-- apagar os outros. O erro vira DADO no JSON.
--
-- ⚠️ Todas as contagens em `messages` são em janela de tempo (24h/7d): a
-- tabela tem 140+ mil linhas e o `authenticated` tem statement_timeout de 8 s.
--
-- Idempotente.
-- ============================================================

create or replace function public.saude_sistema(p_location uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  resultado jsonb := '{}'::jsonb;
  bloco jsonb;
begin
  if p_location is null or not private.is_admin(p_location) then
    raise exception 'apenas administradores' using errcode = '42501';
  end if;

  -- ---------- Postgres ----------
  begin
    select jsonb_build_object(
      'conexoes', (select count(*) from pg_stat_activity where datname = current_database()),
      'ativas', (select count(*) from pg_stat_activity
                  where datname = current_database() and state = 'active'
                    and backend_type = 'client backend'),
      'idle_em_transacao', (select count(*) from pg_stat_activity
                  where datname = current_database() and state like 'idle in transaction%'),
      'max_conexoes', current_setting('max_connections')::int,
      'tamanho_mb', round(pg_database_size(current_database()) / 1048576.0),
      'lentas', coalesce((
        select jsonb_agg(x order by x->>'segundos' desc)
          from (
            select jsonb_build_object(
                     'segundos', round(extract(epoch from now() - query_start)),
                     'usuario', usename,
                     'espera', coalesce(wait_event_type, ''),
                     'consulta', left(regexp_replace(query, '\s+', ' ', 'g'), 160)
                   ) as x
              from pg_stat_activity
             where datname = current_database()
               and state = 'active'
               and backend_type = 'client backend'
               and pid <> pg_backend_pid()
               -- a replicação do Realtime fica "ativa" o dia inteiro, por desenho
               and query not ilike 'START_REPLICATION%'
               and now() - query_start > interval '3 seconds'
             order by query_start
             limit 10
          ) t
      ), '[]'::jsonb)
    ) into bloco;
    resultado := resultado || jsonb_build_object('banco', bloco);
  exception when others then
    resultado := resultado || jsonb_build_object('banco', jsonb_build_object('erro', sqlerrm));
  end;

  -- ---------- Crons (pg_cron) ----------
  begin
    select coalesce(jsonb_agg(jsonb_build_object(
             'nome', j.jobname,
             'agenda', j.schedule,
             'ativo', j.active,
             'ultimo_inicio', d.start_time,
             'ultimo_status', d.status,
             'mensagem', left(coalesce(d.return_message, ''), 200)
           ) order by j.jobname), '[]'::jsonb)
      into bloco
      from cron.job j
      left join lateral (
        select r.start_time, r.status, r.return_message
          from cron.job_run_details r
         where r.jobid = j.jobid
         order by r.start_time desc
         limit 1
      ) d on true;
    resultado := resultado || jsonb_build_object('crons', bloco);
  exception when others then
    resultado := resultado || jsonb_build_object('crons', jsonb_build_object('erro', sqlerrm));
  end;

  -- ---------- Chamadas HTTP do pg_net (crons → rotas do CRM), 15 min ----------
  -- NULL = o pg_net desistiu de esperar (timeout de 8 s); a rota segue rodando
  -- na Vercel. É normal nos tiques longos (marketing roda até 45 s).
  begin
    select jsonb_build_object(
      'por_status', coalesce((
        select jsonb_object_agg(coalesce(status_code::text, 'sem resposta'), n)
          from (select status_code, count(*) n from net._http_response
                 where created > now() - interval '15 minutes' group by 1) s
      ), '{}'::jsonb),
      'erros', coalesce((
        select jsonb_agg(jsonb_build_object('quando', created, 'status', status_code,
                                            'erro', left(coalesce(error_msg, content::text, ''), 160)))
          from (select created, status_code, error_msg, content from net._http_response
                 where created > now() - interval '15 minutes'
                   and (status_code is null or status_code >= 400)
                 order by created desc limit 5) e
      ), '[]'::jsonb)
    ) into bloco;
    resultado := resultado || jsonb_build_object('http', bloco);
  exception when others then
    resultado := resultado || jsonb_build_object('http', jsonb_build_object('erro', sqlerrm));
  end;

  -- ---------- Filas ----------
  begin
    select jsonb_build_object(
      'automacoes_atrasadas', (select count(*) from public.automation_runs
                                 where location_id = p_location and status in ('pending', 'waiting')
                                   and next_run_at < now() - interval '5 minutes'),
      'automacoes_falhas_24h', (select count(*) from public.automation_runs
                                  where location_id = p_location and status = 'failed'
                                    and updated_at > now() - interval '24 hours'),
      'automacao_ultimo_erro', (select left(last_error, 200) from public.automation_runs
                                  where location_id = p_location and status = 'failed'
                                    and updated_at > now() - interval '24 hours'
                                  order by updated_at desc limit 1),
      'agendadas_atrasadas', (select count(*) from public.messages m
                                join public.conversations c on c.id = m.conversation_id
                               where c.location_id = p_location
                                 and m.created_at > now() - interval '30 days'
                                 and m.schedule_status = 'pendente'
                                 and m.scheduled_for < now() - interval '5 minutes'),
      'agendadas_falhas_24h', (select count(*) from public.messages m
                                 join public.conversations c on c.id = m.conversation_id
                                where c.location_id = p_location
                                  and m.created_at > now() - interval '7 days'
                                  and m.schedule_status = 'falhou'
                                  and m.scheduled_for > now() - interval '24 hours'),
      'transcricao_pendente', (select count(*) from public.messages m
                                 join public.conversations c on c.id = m.conversation_id
                                where c.location_id = p_location
                                  and m.created_at > now() - interval '7 days'
                                  and m.type = 'audio' and m.transcription_status = 'pendente'),
      'transcricao_falhas_24h', (select count(*) from public.messages m
                                   join public.conversations c on c.id = m.conversation_id
                                  where c.location_id = p_location
                                    and m.created_at > now() - interval '24 hours'
                                    and m.type = 'audio' and m.transcription_status = 'falhou'),
      'leads_na_fila', (select count(*) from public.conversations
                          where location_id = p_location and awaiting_distribution is true
                            and assigned_to is null and closed_at is null and archived_at is null),
      'leads_na_fila_horas', (select round(extract(epoch from now() - min(last_message_at)) / 3600.0, 1)
                                from public.conversations
                               where location_id = p_location and awaiting_distribution is true
                                 and assigned_to is null and closed_at is null and archived_at is null),
      'campanhas_enviando', (select count(*) from public.email_campaigns
                               where location_id = p_location and status = 'sending'),
      'emails_pendentes', (select count(*) from public.email_campaign_recipients r
                             join public.email_campaigns e on e.id = r.campaign_id
                            where e.location_id = p_location and e.status = 'sending'
                              and r.status = 'pending')
    ) into bloco;
    resultado := resultado || jsonb_build_object('filas', bloco);
  exception when others then
    resultado := resultado || jsonb_build_object('filas', jsonb_build_object('erro', sqlerrm));
  end;

  -- ---------- WhatsApp: por canal, últimas 24h ----------
  begin
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', w.id,
             'nome', w.name,
             'telefone', w.phone_e164,
             'phone_number_id', w.phone_number_id,
             'ativo', w.active,
             'ultima_entrada', (select max(m.created_at) from public.messages m
                                  where m.channel_id = w.id and m.direction = 'in'
                                    and m.created_at > now() - interval '7 days'),
             'saidas_24h', (select count(*) from public.messages m
                              where m.channel_id = w.id and m.direction = 'out'
                                and m.created_at > now() - interval '24 hours'
                                and coalesce(m.type, '') <> 'event'),
             'falhas_24h', (select count(*) from public.messages m
                              where m.channel_id = w.id and m.direction = 'out'
                                and m.created_at > now() - interval '24 hours'
                                and m.status = 'failed'),
             'ultimo_erro', (select left(m.error_detail, 200) from public.messages m
                               where m.channel_id = w.id and m.direction = 'out'
                                 and m.created_at > now() - interval '24 hours'
                                 and m.status = 'failed'
                               order by m.created_at desc limit 1)
           ) order by w.name), '[]'::jsonb)
      into bloco
      from public.whatsapp_channels w
     where w.location_id = p_location;
    resultado := resultado || jsonb_build_object('whatsapp', bloco);
  exception when others then
    resultado := resultado || jsonb_build_object('whatsapp', jsonb_build_object('erro', sqlerrm));
  end;

  -- ---------- Guru ----------
  begin
    select jsonb_build_object(
      'conectada', count(*) > 0,
      'ultimo_sync', max(last_synced_at),
      'sync_iniciado', max(sync_started_at),
      'ultima_venda', (select max(received_at) from public.payment_events where location_id = p_location)
    ) into bloco
      from public.payment_credentials
     where location_id = p_location and provider = 'guru';
    resultado := resultado || jsonb_build_object('guru', bloco);
  exception when others then
    resultado := resultado || jsonb_build_object('guru', jsonb_build_object('erro', sqlerrm));
  end;

  -- ---------- IA (ai_logs) ----------
  begin
    select jsonb_build_object(
      'sucesso_24h', count(*) filter (where feature not like '%:erro'),
      'falhas_24h', count(*) filter (where feature like '%:erro'),
      'ultimo_erro', (select left(response, 200) from public.ai_logs
                       where location_id = p_location and feature like '%:erro'
                         and created_at > now() - interval '24 hours'
                       order by created_at desc limit 1)
    ) into bloco
      from public.ai_logs
     where location_id = p_location and created_at > now() - interval '24 hours';
    resultado := resultado || jsonb_build_object('ia', bloco);
  exception when others then
    resultado := resultado || jsonb_build_object('ia', jsonb_build_object('erro', sqlerrm));
  end;

  return resultado || jsonb_build_object('medido_em', now());
end;
$$;

revoke execute on function public.saude_sistema(uuid) from public, anon, authenticated;
grant execute on function public.saude_sistema(uuid) to authenticated;

notify pgrst, 'reload schema';
