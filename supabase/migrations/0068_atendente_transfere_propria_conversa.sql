-- ============================================================
-- Lito CRM — Atendente pode TRANSFERIR a própria conversa (pelo topo)
--
-- A policy de UPDATE de conversas (0063) exigia, no WITH CHECK, que a conversa
-- CONTINUASSE sendo do usuário (assigned_to = eu). Isso impedia o atendente de
-- reatribuir a SUA conversa para outro atendente pelo cabeçalho. Relaxamos só o
-- WITH CHECK para "mesma empresa" — o USING (quem pode mexer) continua igual:
-- o atendente só edita/transfere a conversa que já é dele (ou admin/sees_all).
-- Idempotente.
-- ============================================================
set check_function_bodies = off;

drop policy if exists "membros editam" on public.conversations;
create policy "membros editam" on public.conversations
  for update to authenticated
  using (
    location_id in (select private.user_locations())
    and (
      assigned_to = (select auth.uid())
      or (
        private.sees_all(location_id)
        and private.channel_allowed(location_id, channel_id)
        and (private.is_admin(location_id) or not private.conv_with_bot(id))
      )
    )
  )
  with check (location_id in (select private.user_locations()));
