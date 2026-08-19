-- ============================================================
-- Lito CRM — Transferir a conversa leva o CARD do funil junto
--
-- Ao transferir a conversa (transfer_conversation, 0070), o card/oportunidade do
-- contato ficava com o dono antigo — o lead "quebrava" (conversa com um, card com
-- outro). Agora a mesma função move o(s) card(s) do contato para o novo atendente
-- (owner_id = to_user), então o lead inteiro migra junto. to_user = null devolve
-- ao grupo (card sem dono).
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

  update public.conversations set assigned_to = to_user where id = conv_id;

  -- O lead inteiro migra: o(s) card(s) do contato vão para o novo atendente.
  update public.opportunities set owner_id = to_user where contact_id = cid;

  return true;
end;
$$;
revoke all on function public.transfer_conversation(uuid, uuid) from anon;
grant execute on function public.transfer_conversation(uuid, uuid) to authenticated;
