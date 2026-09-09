-- ============================================================
-- Catálogo de ETIQUETAS: uma lista curada para o vendedor marcar e filtrar
--
-- Pedido do Gabriel (2026-09-09): as etiquetas que a equipe usava no CRM antigo
-- passam a existir aqui, o vendedor marca nos contatos e filtra a própria caixa
-- de entrada por elas.
--
-- Hoje o CRM tem `contacts.tags` (text[]) e NENHUMA lista: o composer, o
-- formulário do contato e a ação em massa pedem a etiqueta em CAMPO DE TEXTO
-- LIVRE. Ninguém consegue marcar sem digitar de memória, e cada variação vira
-- uma etiqueta nova em silêncio — a ação em massa ainda grava
-- `.toLowerCase()`, então "QUENTE" e "quente" já convivem hoje.
--
-- ⚠️ **`contacts.tags` NÃO muda, e essa é a decisão central.** Este catálogo é
-- só a lista de nomes VÁLIDOS; o valor continua no array de sempre. Trocar o
-- armazenamento por tabela de junção quebraria de uma vez as listas
-- inteligentes, as campanhas de marketing, os formulários (`forms.tag`), a
-- importação/exportação CSV e as ações em massa — tudo lê `contacts.tags`.
--
-- Idempotente.
-- ============================================================

create table if not exists public.contact_tags (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations (id) on delete cascade,
  name text not null,
  -- Ordem de exibição na lista. O CRM antigo agrupava por família (Aluno…,
  -- INTERESSADO…, estado) e é o que faz uma lista de 21 nomes ser navegável.
  position int not null default 0,
  created_at timestamptz not null default now()
);

/*
 * ⚠️ Único por `lower(name)`, não por `name`. É esta linha que impede o
 * catálogo de repetir o problema que ele vem resolver: com unicidade sensível a
 * maiúsculas, "QUENTE" e "Quente" entrariam as duas e o vendedor teria duas
 * caixas com o mesmo significado.
 *
 * A GRAFIA escolhida é preservada (a coluna guarda o texto como veio) — os
 * nomes do Gabriel misturam caixa de propósito: "PAGO", "Agora", "Aluno Eng".
 */
create unique index if not exists contact_tags_nome_unico
  on public.contact_tags (location_id, lower(name));

alter table public.contact_tags enable row level security;

-- Ler: qualquer membro da empresa — é a lista que o vendedor usa para marcar.
drop policy if exists "membros leem etiquetas" on public.contact_tags;
create policy "membros leem etiquetas" on public.contact_tags
  for select to authenticated
  using (location_id in (select private.user_locations()));

/*
 * Escrever: só admin. Decisão do Gabriel — a lista fica curada, e é o que
 * impede "INTERESSADO PP", "Interessado PP" e "interessado pp" coexistirem.
 * ⚠️ É RLS, não botão escondido: marcar a etiqueta continua sendo de todos
 * (isso mexe em `contacts.tags`, não nesta tabela).
 */
drop policy if exists "admin cria etiquetas" on public.contact_tags;
create policy "admin cria etiquetas" on public.contact_tags
  for insert to authenticated
  with check (private.is_admin(location_id));

drop policy if exists "admin edita etiquetas" on public.contact_tags;
create policy "admin edita etiquetas" on public.contact_tags
  for update to authenticated
  using (private.is_admin(location_id))
  with check (private.is_admin(location_id));

drop policy if exists "admin exclui etiquetas" on public.contact_tags;
create policy "admin exclui etiquetas" on public.contact_tags
  for delete to authenticated
  using (private.is_admin(location_id));

-- ------------------------------------------------------------
-- Semente: as etiquetas do CRM antigo
-- ------------------------------------------------------------
/*
 * A lista veio dos prints do Gabriel, agrupada por família na ordem em que a
 * equipe pensa: quem já é ALUNO, quem está INTERESSADO, e o estado do negócio.
 *
 * ⚠️ `on conflict do nothing` é obrigatório: a migração é idempotente e, mais
 * importante, a varredura logo abaixo pode trazer a mesma etiqueta em outra
 * grafia — a primeira vence e nada estoura.
 */
insert into public.contact_tags (location_id, name, position)
select l.id, e.nome, e.pos
  from public.locations l
  cross join (values
    ('Aluno MMA', 10), ('Aluno PC', 11), ('Aluno PP', 12), ('Aluno Cmro', 13),
    ('Aluno Selva', 14), ('Aluno Eng', 15), ('Aluno Safe', 16),
    ('Aluno Cancelado', 17),
    ('INTERESSADO MMA', 30), ('INTERESSADO COMISSÁRIO', 31),
    ('INTERESSADO SELVA', 32), ('INTERESSADO PP', 33), ('INTERESSADO PC', 34),
    ('INTERESSADO PÓS ENGENHEIROS', 35),
    ('INTERESSADO MASTERCLASS COMISSARIO', 50),
    ('INTERESSADO MASTERCLASS FRENO', 51),
    ('INTERESSADO MASTERCLASS ELÉTRICA', 52),
    ('INTERESSADO MASTERCLASS REPARO ESTRUTURAL', 53),
    ('Agora', 70), ('PAGO', 71), ('QUENTE', 72)
  ) as e(nome, pos)
on conflict do nothing;

-- ------------------------------------------------------------
-- Absorve o que JÁ está em uso nos contatos
-- ------------------------------------------------------------
/*
 * Decisão do Gabriel: a lista nasce refletindo a realidade, não só os prints.
 * Sem isto, etiqueta que veio da importação continuaria gravada nos contatos e
 * funcionando em lista inteligente, mas sumiria de vista — ninguém conseguiria
 * marcá-la de novo nem filtrar por ela.
 *
 * ⚠️ `position 900` põe as absorvidas DEPOIS das curadas, sem se misturarem: o
 * admin vê o que veio de fora agrupado no fim e decide o que fundir ou apagar.
 *
 * ⚠️ Colisão de grafia é resolvida pelo `on conflict do nothing` — a curada
 * vence, porque foi semeada antes. O que ficou de fora NÃO é apagado do
 * contato; só não vira item do catálogo. A consulta que lista essas colisões
 * está no AGENTS.md, para o Gabriel decidir uma a uma.
 */
insert into public.contact_tags (location_id, name, position)
select c.location_id, t.nome, 900
  from public.contacts c
  cross join lateral unnest(c.tags) as t(nome)
 where btrim(t.nome) <> ''
 group by c.location_id, t.nome
on conflict do nothing;
