-- ============================================================
-- Lito CRM — Atendente assume ("reivindica") uma conversa SEM dono ao abrir
--
-- Com conversas privadas, um atendente (only_assigned) não vê conversa que não é
-- dele. Mas se a conversa está SEM dono (assigned_to null), ele deve poder abri-la
-- e assumir — só não pode pegar a de OUTRO atendente. Esta função atribui a
-- conversa ao usuário atual APENAS se ela estiver sem dono e ele for da empresa.
-- (Reatribuir uma conversa que já tem dono continua sendo coisa de admin, na UI.)
-- Idempotente.
-- ============================================================
set check_function_bodies = off;

create or replace function public.claim_conversation(conv_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, private
as $$
begin
  update public.conversations c
     set assigned_to = (select auth.uid())
   where c.id = conv_id
     and c.assigned_to is null
     and c.location_id in (select private.user_locations());
  return found;
end;
$$;
revoke all on function public.claim_conversation(uuid) from anon;
grant execute on function public.claim_conversation(uuid) to authenticated;
