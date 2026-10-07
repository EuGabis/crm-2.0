-- ============================================================
-- Lito CRM — "Minhas respostas": respostas rápidas PESSOAIS
-- ============================================================
-- Pedido (2026-10-07): a Meta passou a cobrar por mensagem enviada, então o
-- vendedor quer montar a resposta inteira de uma vez, com os textos que ELE
-- usa — sem encher a lista de respostas rápidas da empresa inteira.
--
-- Mesma tabela, uma coluna a mais: `snippets.owner_id`.
--   NULL      = resposta rápida da empresa (como sempre foi; todos veem)
--   preenchido = resposta PESSOAL — só o dono lê, edita e exclui
--
-- ⚠️ Tabela nova foi descartada: o composer, a aba de Respostas rápidas e o
-- marketing já leem `snippets`, e duas tabelas para o mesmo formato (nome +
-- texto) divergiriam na primeira coluna nova.
--
-- ⚠️ É RLS, não filtro de tela: sem a policy, a pessoal de um vendedor viria na
-- consulta de todos os outros e bastaria um `.select()` para ler.
--
-- Idempotente. Pode ser aplicada antes ou depois do merge: o código trata a
-- coluna ausente como "tudo é da empresa", que é exatamente o estado de hoje.
-- ============================================================

alter table public.snippets
  add column if not exists owner_id uuid references auth.users (id) on delete cascade;

create index if not exists snippets_owner_idx
  on public.snippets (owner_id) where owner_id is not null;

-- As quatro policies da 0003, cada uma com a mesma condição a mais:
-- da empresa (owner_id nulo) OU minha.
drop policy if exists "membros leem" on public.snippets;
create policy "membros leem" on public.snippets
  for select to authenticated
  using (
    location_id in (select private.user_locations())
    and (owner_id is null or owner_id = (select auth.uid()))
  );

-- ⚠️ O `with check` impede criar uma resposta "pessoal" em nome de um colega.
drop policy if exists "membros criam" on public.snippets;
create policy "membros criam" on public.snippets
  for insert to authenticated
  with check (
    location_id in (select private.user_locations())
    and (owner_id is null or owner_id = (select auth.uid()))
  );

-- ⚠️ O `with check` do UPDATE impede "adotar" uma resposta da empresa (tirando-a
-- de todo mundo) ou passar a minha para outra pessoa.
drop policy if exists "membros editam" on public.snippets;
create policy "membros editam" on public.snippets
  for update to authenticated
  using (
    location_id in (select private.user_locations())
    and (owner_id is null or owner_id = (select auth.uid()))
  )
  with check (
    location_id in (select private.user_locations())
    and (owner_id is null or owner_id = (select auth.uid()))
  );

drop policy if exists "membros excluem" on public.snippets;
create policy "membros excluem" on public.snippets
  for delete to authenticated
  using (
    location_id in (select private.user_locations())
    and (owner_id is null or owner_id = (select auth.uid()))
  );

notify pgrst, 'reload schema';
