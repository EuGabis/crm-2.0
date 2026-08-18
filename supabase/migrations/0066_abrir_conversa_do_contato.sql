-- ============================================================
-- Lito CRM — Abrir a conversa de um contato sem quebrar (contatos universais)
--
-- Com contatos universais (0065) mas conversas privadas, ao clicar "abrir
-- conversa" num contato que NÃO é seu, o cliente: (1) a busca RLS não achava a
-- conversa (oculta), (2) criava uma duplicada sem assigned_to, (3) não conseguia
-- ler de volta (RLS) → erro. Esta função acha a conversa do contato IGNORANDO a
-- RLS, para o app saber se ela já existe (e de quem é) antes de criar/abrir.
-- Idempotente.
-- ============================================================
set check_function_bodies = off;

create or replace function public.contact_conversation(cid uuid, chan text default 'whatsapp')
returns table(conv_id uuid, assigned_to uuid)
language sql
security definer
stable
set search_path = public
as $$
  select c.id, c.assigned_to
  from public.conversations c
  where c.contact_id = cid and c.channel = chan
  order by c.last_message_at desc nulls last
  limit 1;
$$;
revoke all on function public.contact_conversation(uuid, text) from anon;
grant execute on function public.contact_conversation(uuid, text) to authenticated;
