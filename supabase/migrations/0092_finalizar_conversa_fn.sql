-- ============================================================
-- Lito CRM — Finalizar/reabrir conversa por função (fora da RLS)
--
-- (Substitui a 0089_finalizar_conversa_fn, que colidiu de número com a
-- 0089_previa_de_midia e acabou não sendo aplicada — por isso o "Não foi
-- possível finalizar" voltou: o close() caía no update direto, barrado pela RLS.)
--
-- Sintoma: ao finalizar às vezes aparecia "Não foi possível atualizar a
-- conversa" e o status NÃO mudava. Causa: o UPDATE direto passa pela RLS, e em
-- casos de borda a conversa não estava "atribuída a mim" no clique (aberta sem
-- atribuir via get_conversation/0086, de outro setor, ou o atendente REMOVEU o
-- responsável antes de finalizar).
--
-- Solução: função SECURITY DEFINER que finaliza/reabre por fora da RLS,
-- autorizando quem PODE agir na conversa:
--   - admin;
--   - o dono atual;
--   - supervisor do setor colaborativo;
--   - QUALQUER membro da empresa quando a conversa está SEM dono (fila/pool ou
--     responsável removido) — finalizar é não-destrutivo (reabre), e sem isto o
--     atendente que tira o responsável e finaliza levava "Não foi possível".
-- Idempotente.
--
-- Finalizar (p_done=true): grava closed_at/closed_by e SOLTA o responsável.
-- Reabrir (p_done=false): limpa closed_at/closed_by (não mexe no responsável).
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

  v_can :=
    private.is_admin(v_loc)
    or exists (
      select 1 from public.conversations c
      where c.id = conv_id and c.assigned_to = (select auth.uid())
    )
    or private.can_supervise_conv(conv_id)
    -- Sem dono + sou membro da empresa da conversa → posso finalizar.
    or exists (
      select 1
      from public.conversations c
      join public.location_members lm
        on lm.user_id = (select auth.uid()) and lm.location_id = c.location_id
      where c.id = conv_id and c.assigned_to is null
    );
  if not v_can then
    return false;
  end if;

  if p_done then
    update public.conversations
       set closed_at   = now(),
           closed_by   = (select auth.uid()),
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
