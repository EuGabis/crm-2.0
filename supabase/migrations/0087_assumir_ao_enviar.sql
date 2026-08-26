-- ============================================================
-- Lito CRM — Assumir a conversa ao ENVIAR (fim do "conversa não encontrada")
--
-- Com "abrir sem atribuir" (0086), a conversa aberta por contato fica sem dono e
-- pode estar ainda com o bot. A rota /api/whatsapp/send busca/grava pela RLS, que
-- esconde conversa no bot / de outro setor para não-admin — dava 404 e o insert
-- seria barrado.
--
-- Esta função ATRIBUI a conversa a quem está enviando (auth.uid()) e pausa o bot,
-- por fora da RLS, se a conversa estiver SEM dono, já for minha, ou eu for admin
-- (não rouba a de outro atendente). A rota chama antes de gravar. Idempotente.
-- ============================================================
set check_function_bodies = off;

create or replace function public.assign_conversation_to_self(conv_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_loc   uuid;
  v_owner uuid;
  v_uid   uuid := (select auth.uid());
begin
  select location_id, assigned_to into v_loc, v_owner
  from public.conversations
  where id = conv_id;

  if v_loc is null or v_loc not in (select private.user_locations()) then
    return false;
  end if;

  -- De OUTRO atendente e eu não sou admin → não posso enviar (nem roubo).
  if v_owner is not null and v_owner <> v_uid and not private.is_admin(v_loc) then
    return false;
  end if;

  if v_owner is null then
    -- Sem dono → ASSUMO (atribuo a mim) + pauso o bot + reabro.
    update public.conversations
       set assigned_to = v_uid,
           bot_paused = true,
           closed_at = null, closed_by = null, archived_at = null, archived_by = null
     where id = conv_id;
  else
    -- Já tem dono (minha, ou de outro com eu sendo admin): NÃO troco o dono —
    -- só pauso o bot e reabro. Admin ajuda sem sequestrar a conversa.
    update public.conversations
       set bot_paused = true,
           closed_at = null, closed_by = null, archived_at = null, archived_by = null
     where id = conv_id;
  end if;
  return true;
end;
$$;

revoke all on function public.assign_conversation_to_self(uuid) from anon;
grant execute on function public.assign_conversation_to_self(uuid) to authenticated;
