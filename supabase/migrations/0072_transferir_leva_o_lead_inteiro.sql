-- ============================================================
-- Lito CRM — Transferir a conversa leva o LEAD INTEIRO junto
--
-- Ao transferir a conversa, tudo que está vinculado ao contato deve migrar para
-- o novo atendente — não só o card. Esta função (create or replace) SUBSTITUI a
-- 0071: além da conversa e do(s) card(s), move a agenda, as tarefas e o próprio
-- contato para `to_user`. `to_user = null` devolve tudo ao grupo (sem dono).
--
-- O que migra (tudo filtrado por contact_id do contato da conversa):
--   - conversations.assigned_to  (a própria conversa)
--   - opportunities.owner_id     (cards do funil)
--   - appointments.owner_id      (agenda / compromissos)
--   - tasks.assignee_id          (tarefas)
--   - contacts.owner_id          (o próprio contato — o lead passa a ser dele)
-- Anotações internas são mensagens da conversa (message-scoped) e já acompanham
-- a conversa, sem precisar de update aqui.
--
-- Aplicar SÓ esta migração já basta (ela contém o move do card da 0071).
-- Idempotente (create or replace).
-- ============================================================
set check_function_bodies = off;

create or replace function public.transfer_conversation(conv_id uuid, to_user uuid)
returns boolean
language plpgsql
security definer
set search_path = public, private
as $$
declare
  loc uuid;
  cur uuid;
  cid uuid;
begin
  select location_id, assigned_to, contact_id into loc, cur, cid
  from public.conversations
  where id = conv_id;
  if loc is null then
    return false;
  end if;

  -- Quem pode transferir: o dono atual, admin, ou quem vê tudo do setor.
  if not (
    cur = (select auth.uid())
    or private.is_admin(loc)
    or private.sees_all(loc)
  ) then
    return false;
  end if;

  -- Alvo (se houver) precisa ser membro da mesma empresa.
  if to_user is not null and not exists (
    select 1 from public.location_members m
    where m.user_id = to_user and m.location_id = loc
  ) then
    return false;
  end if;

  -- A conversa vai para o novo atendente.
  update public.conversations set assigned_to = to_user where id = conv_id;

  -- E TUDO que é do contato migra junto — o lead inteiro passa a ser dele.
  if cid is not null then
    update public.opportunities set owner_id    = to_user where contact_id = cid;
    update public.appointments  set owner_id    = to_user where contact_id = cid;
    update public.tasks         set assignee_id = to_user where contact_id = cid;
    update public.contacts      set owner_id    = to_user where id = cid;
  end if;

  return true;
end;
$$;
revoke all on function public.transfer_conversation(uuid, uuid) from anon;
grant execute on function public.transfer_conversation(uuid, uuid) to authenticated;
