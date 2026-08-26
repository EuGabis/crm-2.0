-- ============================================================
-- Lito CRM — Finalizar/reabrir conversa por função (fora da RLS)
--
-- Sintoma: ao finalizar (inclusive com resumo da IA) às vezes aparecia
-- "Não foi possível atualizar a conversa" e o status NÃO mudava. Causa: o
-- UPDATE direto de conversations passa pela RLS, e em casos de borda a conversa
-- não estava "atribuída a mim" no momento do clique (aberta sem atribuir via
-- get_conversation/0086, conversa de outro setor vista por supervisor, etc.) —
-- o update então não afeta nenhuma linha ou é barrado.
--
-- Solução (mesmo padrão de assign_conversation_to_self/0087 e
-- take_over_conversation/0080): função SECURITY DEFINER que finaliza/reabre por
-- fora da RLS, autorizando quem PODE agir na conversa: admin, o dono atual, ou
-- quem supervisiona o setor (colaborativo). Idempotente.
--
-- Finalizar (p_done=true): grava closed_at/closed_by e SOLTA o responsável
-- (assigned_to=null) — igual ao comportamento atual do app. Reabrir
-- (p_done=false): limpa closed_at/closed_by (não mexe no responsável).
-- ============================================================
set check_function_bodies = off;

create or replace function public.finish_conversation(conv_id uuid, p_done boolean)
returns boolean
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_loc uuid;
  v_can boolean;
begin
  select location_id into v_loc from public.conversations where id = conv_id;
  if v_loc is null then
    return false;
  end if;

  -- Pode finalizar/reabrir: admin, o dono atual, ou supervisor do setor.
  v_can :=
    private.is_admin(v_loc)
    or exists (
      select 1 from public.conversations c
      where c.id = conv_id and c.assigned_to = (select auth.uid())
    )
    or private.can_supervise_conv(conv_id);
  if not v_can then
    return false;
  end if;

  if p_done then
    update public.conversations
       set closed_at   = now(),
           closed_by   = (select auth.uid()),
           -- Finalizou = atendimento encerrado: solta o responsável (volta pra
           -- fila sem dono). Se o cliente voltar, é reatribuído/reassumido.
           assigned_to = null
     where id = conv_id;
  else
    update public.conversations
       set closed_at = null,
           closed_by = null
     where id = conv_id;
  end if;

  return true;
end;
$$;

revoke all on function public.finish_conversation(uuid, boolean) from public, anon;
grant execute on function public.finish_conversation(uuid, boolean) to authenticated;
