-- ============================================================
-- Lito CRM — Corrige a transferência de conversa (WITH CHECK que falhava)
--
-- Sintoma: reatribuir a própria conversa dava "42501: new row violates RLS",
-- mesmo com a location batendo. O USING já garante QUEM pode mexer (dono/admin/
-- sees_all no setor). Repetir `location_id in (select private.user_locations())`
-- no WITH CHECK estava barrando a linha nova na avaliação do UPDATE (reproduzido
-- direto no banco). Como o USING é o portão real, o WITH CHECK vira `true`: quem
-- passou no USING pode salvar a mudança (ex.: trocar o responsável).
-- Não afrouxa acesso — o USING continua idêntico.
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
  with check (true);
