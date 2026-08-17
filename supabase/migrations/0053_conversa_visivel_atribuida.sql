-- Lito CRM — "vê os números do seu setor OU a conversa atribuída a você"
--
-- Problema: com a restrição por número/setor ligada (0035), transferir uma
-- conversa de um número que NÃO é do setor da pessoa (ex.: Comercial 3408 →
-- Secretaria) não adiantava: a RLS de canal escondia a conversa da pessoa de
-- destino. Agora, se a conversa foi ATRIBUÍDA a ela, ela enxerga aquela conversa
-- específica — sem abrir o número inteiro pro setor dela.

-- Helper: a conversa está atribuída ao usuário atual? security definer para não
-- depender da RLS de `conversations` (evita recursão nas policies de `messages`).
create or replace function private.conv_assigned_to_me(conv_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, private
as $$
  select exists (
    select 1 from public.conversations c
    where c.id = conv_id and c.assigned_to = (select auth.uid())
  );
$$;
revoke all on function private.conv_assigned_to_me(uuid) from public, anon;
grant execute on function private.conv_assigned_to_me(uuid) to authenticated;

-- ---------- conversations: canal do setor OU atribuída a mim ----------
drop policy if exists "membros leem" on public.conversations;
create policy "membros leem" on public.conversations
  for select to authenticated
  using (
    location_id in (select private.user_locations())
    and (
      private.channel_allowed(location_id, channel_id)
      or assigned_to = (select auth.uid())
    )
  );

drop policy if exists "membros editam" on public.conversations;
create policy "membros editam" on public.conversations
  for update to authenticated
  using (
    location_id in (select private.user_locations())
    and (
      private.channel_allowed(location_id, channel_id)
      or assigned_to = (select auth.uid())
    )
  )
  with check (
    location_id in (select private.user_locations())
    and (
      private.channel_allowed(location_id, channel_id)
      or assigned_to = (select auth.uid())
    )
  );

-- ---------- messages: canal do setor OU a conversa é atribuída a mim ----------
drop policy if exists "membros leem" on public.messages;
create policy "membros leem" on public.messages
  for select to authenticated
  using (
    location_id in (select private.user_locations())
    and (
      private.channel_allowed(location_id, channel_id)
      or private.conv_assigned_to_me(conversation_id)
    )
  );

drop policy if exists "membros editam" on public.messages;
create policy "membros editam" on public.messages
  for update to authenticated
  using (
    location_id in (select private.user_locations())
    and (
      private.channel_allowed(location_id, channel_id)
      or private.conv_assigned_to_me(conversation_id)
    )
  )
  with check (
    location_id in (select private.user_locations())
    and (
      private.channel_allowed(location_id, channel_id)
      or private.conv_assigned_to_me(conversation_id)
    )
  );

drop policy if exists "membros criam" on public.messages;
create policy "membros criam" on public.messages
  for insert to authenticated
  with check (
    location_id in (select private.user_locations())
    and (
      private.channel_allowed(location_id, channel_id)
      or private.conv_assigned_to_me(conversation_id)
    )
  );
