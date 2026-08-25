-- ============================================================
-- Lito CRM — Registrar evento da conversa por função (log de transferência)
--
-- Os "logs" (pílulas cinza: "Fulano assumiu a conversa de Ciclano") são mensagens
-- type='event' gravadas pelo cliente. Depois que a RLS da 0074 restringiu o INSERT
-- em messages (só na conversa própria ou na fila), quem TRANSFERE para outro perde
-- a posse ANTES de gravar o log — e o insert direto passou a ser barrado. Os logs
-- de transferência sumiram.
--
-- Solução: gravar o evento por uma função SECURITY DEFINER (mesmo padrão do
-- transfer_conversation), validando só que o chamador é membro da empresa da
-- conversa. Devolve a linha inserida para a UI mostrar na hora. Idempotente.
-- ============================================================
set check_function_bodies = off;

create or replace function public.log_conversation_event(conv_id uuid, p_body text)
returns public.messages
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_loc  uuid;
  v_chan text;
  v_row  public.messages;
begin
  select location_id, channel into v_loc, v_chan
  from public.conversations
  where id = conv_id;

  -- Só membro da empresa da conversa pode registrar evento nela.
  if v_loc is null or v_loc not in (select private.user_locations()) then
    return null;
  end if;

  insert into public.messages (location_id, conversation_id, direction, type, channel, body)
  values (v_loc, conv_id, 'out', 'event', coalesce(v_chan, 'whatsapp'), p_body)
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.log_conversation_event(uuid, text) from anon;
grant execute on function public.log_conversation_event(uuid, text) to authenticated;
