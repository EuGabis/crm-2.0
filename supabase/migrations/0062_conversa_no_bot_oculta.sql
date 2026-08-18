-- ============================================================
-- Lito CRM — Conversa "no bot" não aparece para usuário comum
--
-- Regra (pedido do Gabriel): enquanto a conversa está sendo conduzida pelo BOT
-- (existe bot_session ativa/aguardando), ela NÃO aparece na caixa de nenhum
-- atendente comum — só some de lá quando é distribuída/transferida (ganha
-- assigned_to) ou o bot é encerrado. Admin continua vendo tudo (inclusive nos
-- relatórios). Recria as policies da 0053 acrescentando a condição do bot.
-- Idempotente.
-- ============================================================
set check_function_bodies = off;

-- Helper: a conversa está sendo conduzida pelo bot agora? SECURITY DEFINER para
-- não depender da RLS de bot_sessions (evita recursão nas policies).
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
-- Vejo a conversa se: é minha (assigned_to), OU é do meu setor E (sou admin OU
-- ela NÃO está no bot). Ou seja: conversa no bot só admin vê pelo setor.
drop policy if exists "membros leem" on public.conversations;
create policy "membros leem" on public.conversations
  for select to authenticated
  using (
    location_id in (select private.user_locations())
    and (
      assigned_to = (select auth.uid())
      or (
        private.channel_allowed(location_id, channel_id)
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
        private.channel_allowed(location_id, channel_id)
        and (private.is_admin(location_id) or not private.conv_with_bot(id))
      )
    )
  )
  with check (
    location_id in (select private.user_locations())
    and (
      assigned_to = (select auth.uid())
      or (
        private.channel_allowed(location_id, channel_id)
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
        private.channel_allowed(location_id, channel_id)
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
        private.channel_allowed(location_id, channel_id)
        and (private.is_admin(location_id) or not private.conv_with_bot(conversation_id))
      )
    )
  )
  with check (
    location_id in (select private.user_locations())
    and (
      private.conv_assigned_to_me(conversation_id)
      or (
        private.channel_allowed(location_id, channel_id)
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
        private.channel_allowed(location_id, channel_id)
        and (private.is_admin(location_id) or not private.conv_with_bot(conversation_id))
      )
    )
  );
