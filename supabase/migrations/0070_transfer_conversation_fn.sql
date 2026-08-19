-- ============================================================
-- Lito CRM — Transferência de conversa via função (à prova de RLS)
--
-- Reatribuir a conversa pelo UPDATE direto esbarrava no WITH CHECK da RLS (a
-- linha nova, com outro dono, era recusada — 42501). Em vez de brigar com o
-- WITH CHECK, a transferência passa por uma função SECURITY DEFINER que valida
-- no código quem pode transferir e faz o update por fora da RLS:
--   - só o DONO atual, um ADMIN, ou quem vê tudo (sees_all) pode transferir;
--   - o alvo (se houver) tem que ser membro da mesma empresa;
--   - to_user = null devolve a conversa para a caixa do grupo.
-- Idempotente.
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
begin
  select location_id, assigned_to into loc, cur
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
  return true;
end;
$$;
revoke all on function public.transfer_conversation(uuid, uuid) from anon;
grant execute on function public.transfer_conversation(uuid, uuid) to authenticated;
