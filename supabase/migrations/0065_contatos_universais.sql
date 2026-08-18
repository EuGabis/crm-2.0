-- ============================================================
-- Lito CRM — Contatos são UNIVERSAIS (catálogo compartilhado da empresa)
--
-- Decisão (Gabriel): o contato é um catálogo da plataforma — TODOS os membros da
-- empresa veem e editam todos os contatos. O que continua privado é o LEAD: a
-- CONVERSA (só o atendente atribuído) e o CARD/oportunidade (só o dono). E
-- TRANSFERIR (reatribuir) é só admin — isso é tratado na UI.
--
-- Substitui a RLS de contacts da 0004/0064 (que filtrava por sees_all/owner).
-- Idempotente.
-- ============================================================
set check_function_bodies = off;

-- SELECT: qualquer membro da empresa vê qualquer contato.
drop policy if exists "membros leem" on public.contacts;
create policy "membros leem" on public.contacts
  for select to authenticated
  using (location_id in (select private.user_locations()));

-- UPDATE: qualquer membro edita (catálogo compartilhado).
drop policy if exists "membros editam" on public.contacts;
create policy "membros editam" on public.contacts
  for update to authenticated
  using (location_id in (select private.user_locations()))
  with check (location_id in (select private.user_locations()));
