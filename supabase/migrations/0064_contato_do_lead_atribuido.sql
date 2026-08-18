-- ============================================================
-- Lito CRM — Atendente vê o CONTATO do lead atribuído a ele
--
-- Bug: com "ver apenas atribuídos" (only_assigned), a RLS de contacts (0004) só
-- liberava o contato se `sees_all` ou `owner_id = eu`. Quando um lead é distribuído
-- por rodízio, a CONVERSA e o CARD viram do atendente, mas o CONTATO não — então o
-- atendente via a conversa vazia (a linha do inbox depende do contato para o nome).
--
-- Correção: o atendente também vê (e edita) o contato quando tem uma CONVERSA
-- atribuída a ele OU um CARD (oportunidade) dele para aquele contato.
-- Idempotente.
-- ============================================================
set check_function_bodies = off;

-- Helper: este contato é "meu"? (tenho conversa atribuída ou card dele).
-- SECURITY DEFINER para não depender da RLS de conversations/opportunities.
create or replace function private.contact_is_mine(cid uuid)
returns boolean
language sql
security definer
stable
set search_path = public, private
as $$
  select exists (
    select 1 from public.conversations c
    where c.contact_id = cid and c.assigned_to = (select auth.uid())
  ) or exists (
    select 1 from public.opportunities o
    where o.contact_id = cid and o.owner_id = (select auth.uid())
  );
$$;
revoke all on function private.contact_is_mine(uuid) from public, anon;
grant execute on function private.contact_is_mine(uuid) to authenticated;

-- Índices que ajudam o helper (idempotentes).
create index if not exists conversations_contact_assigned_idx
  on public.conversations (contact_id, assigned_to);
create index if not exists opportunities_contact_owner_idx
  on public.opportunities (contact_id, owner_id);

-- contacts: vê se vê tudo, é dono, OU o contato é de conversa/card atribuído a ele.
drop policy if exists "membros leem" on public.contacts;
create policy "membros leem" on public.contacts
  for select to authenticated
  using (
    location_id in (select private.user_locations())
    and (
      private.sees_all(location_id)
      or owner_id = (select auth.uid())
      or private.contact_is_mine(id)
    )
  );

-- E poder editar o contato do lead que é dele (nome, telefone, etc.).
drop policy if exists "membros editam" on public.contacts;
create policy "membros editam" on public.contacts
  for update to authenticated
  using (
    location_id in (select private.user_locations())
    and (
      private.sees_all(location_id)
      or owner_id = (select auth.uid())
      or private.contact_is_mine(id)
    )
  )
  with check (location_id in (select private.user_locations()));
