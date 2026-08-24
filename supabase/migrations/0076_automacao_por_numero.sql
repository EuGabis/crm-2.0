-- ============================================================
-- Lito CRM — Automação escolhe em qual NÚMERO (canal) opera
--
-- Pedido: o fluxo deve poder rodar só para as mensagens de um número específico
-- de WhatsApp (e não de todos). A escolha fica em `workflows.trigger_config`
-- como `{"channelId": "<uuid do whatsapp_channel>"}` (vazio/ausente = todos os
-- números).
--
-- Duas mudanças, ambas sem alterar assinaturas (não mexe nos outros triggers):
--   1) on_message_in passa também o `channel_id` da conversa no payload.
--   2) enqueue_automation, ao varrer os workflows publicados, PULA o workflow que
--      escolheu um channelId diferente do canal do evento. Sem channelId no
--      workflow, ou sem channel_id no payload (gatilhos que não são de mensagem),
--      nada é filtrado — comportamento antigo preservado.
-- Idempotente (create or replace).
-- ============================================================
set check_function_bodies = off;

create or replace function private.enqueue_automation(
  p_trigger_key text,
  p_location_id uuid,
  p_contact_id uuid,
  p_opportunity_id uuid,
  p_payload jsonb,
  p_event_key text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  wf record;
  ev_channel text := coalesce(p_payload->>'channel_id', '');
begin
  if p_location_id is null then
    return;
  end if;

  for wf in
    select id, trigger_config
    from public.workflows
    where location_id = p_location_id
      and status = 'published'
      and trigger_key = p_trigger_key
  loop
    -- Filtro de número: se o workflow escolheu um channelId e o evento tem um
    -- channel_id diferente, ignora este workflow.
    if coalesce(wf.trigger_config->>'channelId', '') <> ''
       and ev_channel <> ''
       and wf.trigger_config->>'channelId' <> ev_channel then
      continue;
    end if;

    if exists (
      select 1 from public.automation_runs r
      where r.workflow_id = wf.id
        and r.contact_id is not distinct from p_contact_id
        and r.created_at > now() - interval '5 minutes'
    ) then
      continue;
    end if;

    insert into public.automation_runs
      (location_id, workflow_id, contact_id, opportunity_id, payload, event_key)
    values
      (p_location_id, wf.id, p_contact_id, p_opportunity_id, coalesce(p_payload, '{}'::jsonb),
       p_event_key || ':' || wf.id::text)
    on conflict (event_key) do nothing;
  end loop;
end;
$$;

-- on_message_in: inclui o channel_id da conversa no payload (para o filtro acima).
create or replace function private.on_message_in()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c uuid;
  ch uuid;
begin
  if new.direction <> 'in' then
    return new;
  end if;

  select contact_id, channel_id into c, ch
  from public.conversations where id = new.conversation_id;

  perform private.enqueue_automation(
    'cliente-respondeu', new.location_id, c, null,
    jsonb_build_object('channel', new.channel, 'channel_id', ch, 'body', new.body),
    'resp:' || new.id::text
  );
  return new;
end;
$$;
