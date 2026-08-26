-- ============================================================
-- Lito CRM — Abrir a conversa do contato SEM atribuir
--
-- Pedido do Gabriel: ao "Abrir conversa" (de Contatos/Leads), a conversa NÃO deve
-- ser atribuída a quem abriu — a atribuição só acontece quando um TEMPLATE é
-- enviado (a rota /api/whatsapp/send já faz isso). Antes, o openForContact
-- reivindicava a conversa (assigned_to = quem abriu) para conseguir enxergá-la.
--
-- Esta função devolve a conversa (do contato, que é universal — 0065) para VER,
-- validando só que o chamador é membro da empresa — sem atribuir nem mexer em
-- nada. SECURITY DEFINER, apenas leitura. Idempotente.
-- ============================================================
set check_function_bodies = off;

create or replace function public.get_conversation(conv_id uuid)
returns public.conversations
language sql
stable
security definer
set search_path = public, private
as $$
  select c.*
  from public.conversations c
  where c.id = conv_id
    and c.location_id in (select private.user_locations());
$$;

revoke all on function public.get_conversation(uuid) from anon;
grant execute on function public.get_conversation(uuid) to authenticated;
