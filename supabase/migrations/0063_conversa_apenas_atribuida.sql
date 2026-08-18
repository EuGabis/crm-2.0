-- ============================================================
-- Lito CRM — Conversas respeitam "ver apenas atribuídos" (only_assigned)
--
-- Bug: a RLS de conversas/mensagens filtrava só por SETOR (channel_allowed) e não
-- olhava o `only_assigned` do membro — então todo atendente via TODAS as conversas
-- do número, mesmo as não atribuídas a ele (a de oportunidades já respeitava).
--
-- Regra final (consolida a 0053 + 0062):
--   Vejo a conversa se:
--     - ela é MINHA (assigned_to = eu), OU
--     - eu vejo tudo do meu setor (private.sees_all = admin ou only_assigned=false)
--       E o número é do meu setor (channel_allowed)
--       E ela NÃO está no bot (a não ser admin).
--   Ou seja: atendente com "apenas atribuídos" só vê o que foi transferido pra ele.
-- Idempotente.
-- ============================================================
set check_function_bodies = off;

-- Helper (idem 0062) — a conversa está sendo conduzida pelo bot agora?
create or replace function private.conv_with_bot(conv_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, private
as $$
  select exists (
    select 1 from public.bot_sessions s
    where s.conversation_id = conv_id
      and s.status in ('ativo', 'aguardando')
  );
$$;
revoke all on function private.conv_with_bot(uuid) from public, anon;
grant execute on function private.conv_with_bot(uuid) to authenticated;

-- ---------- conversations ----------
drop policy if exists "membros leem" on public.conversations;
create policy "membros leem" on public.conversations
  for select to authenticated
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
  );

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
  with check (
    location_id in (select private.user_locations())
    and (
      assigned_to = (select auth.uid())
      or (
        private.sees_all(location_id)
        and private.channel_allowed(location_id, channel_id)
        and (private.is_admin(location_id) or not private.conv_with_bot(id))
      )
    )
  );

-- ---------- messages ----------
drop policy if exists "membros leem" on public.messages;
create policy "membros leem" on public.messages
  for select to authenticated
  using (
    location_id in (select private.user_locations())
    and (
      private.conv_assigned_to_me(conversation_id)
      or (
        private.sees_all(location_id)
        and private.channel_allowed(location_id, channel_id)
        and (private.is_admin(location_id) or not private.conv_with_bot(conversation_id))
      )
    )
  );

drop policy if exists "membros editam" on public.messages;
create policy "membros editam" on public.messages
  for update to authenticated
  using (
    location_id in (select private.user_locations())
    and (
      private.conv_assigned_to_me(conversation_id)
      or (
        private.sees_all(location_id)
        and private.channel_allowed(location_id, channel_id)
        and (private.is_admin(location_id) or not private.conv_with_bot(conversation_id))
      )
    )
  )
  with check (
    location_id in (select private.user_locations())
    and (
      private.conv_assigned_to_me(conversation_id)
      or (
        private.sees_all(location_id)
        and private.channel_allowed(location_id, channel_id)
        and (private.is_admin(location_id) or not private.conv_with_bot(conversation_id))
      )
    )
  );

drop policy if exists "membros criam" on public.messages;
create policy "membros criam" on public.messages
  for insert to authenticated
  with check (
    location_id in (select private.user_locations())
    and (
      private.conv_assigned_to_me(conversation_id)
      or (
        private.sees_all(location_id)
        and private.channel_allowed(location_id, channel_id)
        and (private.is_admin(location_id) or not private.conv_with_bot(conversation_id))
      )
    )
  );
