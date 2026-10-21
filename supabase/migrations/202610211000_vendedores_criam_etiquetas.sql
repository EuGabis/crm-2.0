-- Vendedores passam a CRIAR etiquetas (pedido de 2026-10-21).
--
-- Revê a 202609091600, que deixava criar só com admin. Renomear e excluir
-- CONTINUAM de admin: renomear muda a etiqueta de todos os contatos que a
-- usam no filtro, e excluir tira a opção de toda a equipe.
-- O índice único por lower(name) segue impedindo "Interessado PP" ao lado de
-- "INTERESSADO PP" — o risco que a regra antiga existia para conter.
drop policy if exists "admin cria etiquetas" on public.contact_tags;
drop policy if exists "membros criam etiquetas" on public.contact_tags;
create policy "membros criam etiquetas" on public.contact_tags
  for insert to authenticated
  with check (location_id in (select private.user_locations()));
