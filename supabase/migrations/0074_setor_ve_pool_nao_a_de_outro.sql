-- ============================================================
-- Lito CRM — "Vê o setor" = fila do setor (sem dono) + as minhas
--
-- Antes: quem estava como "Todos os dados (vê o setor todo)" (sees_all, não
-- admin) via TODAS as conversas do canal do setor — inclusive as atribuídas a
-- OUTROS atendentes. Então ao transferir uma conversa para outra pessoa, ela
-- continuava aparecendo para quem transferiu (a conversa ainda era do canal
-- dele). Pedido do Gabriel: ao transferir, tem que sumir.
--
-- Novo modelo (não-admin):
--   - vejo SEMPRE as minhas (assigned_to = eu);
--   - "vê o setor" (sees_all) vê a mais a FILA do setor: conversas do meu canal,
--     fora do bot, e SEM dono (assigned_to is null) — o pool de onde se pega lead;
--   - conversa COM dono é privada do dono. Transferir = passa a ter outro dono =
--     sai da minha vista na hora.
--   - "Apenas atribuídos" continua vendo só as suas.
--   - ADMIN continua vendo tudo (inclusive as de outros e as no bot).
-- Espelha em conversations e messages. Idempotente.
-- ============================================================
set check_function_bodies = off;

-- Helper: a conversa está SEM dono? SECURITY DEFINER (não depende da RLS de
-- conversations — mesmo motivo de conv_with_bot).
create or replace function private.conv_unassigned(conv_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, private
as $$
  select exists (
    select 1 from public.conversations c
    where c.id = conv_id and c.assigned_to is null
  );
$$;
revoke all on function private.conv_unassigned(uuid) from public, anon;
grant execute on function private.conv_unassigned(uuid) to authenticated;

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
        -- não-admin: só o pool (sem dono); admin vê tudo
        and (private.is_admin(location_id) or assigned_to is null)
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
        and (private.is_admin(location_id) or assigned_to is null)
      )
    )
  )
  with check (true);

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
        and (private.is_admin(location_id) or private.conv_unassigned(conversation_id))
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
        and (private.is_admin(location_id) or private.conv_unassigned(conversation_id))
      )
    )
  )
  with check (true);

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
        and (private.is_admin(location_id) or private.conv_unassigned(conversation_id))
      )
    )
  );
