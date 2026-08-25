-- Lito CRM — busca/paginação de contatos NO SERVIDOR
--
-- Problema: a tela de Contatos lia o array inteiro do store, e a empresa passou
-- de 365 para 41.532 contatos depois da importação do CRM antigo. Carregar tudo
-- são ~42 requisições (o PostgREST corta em 1000) e ~20 MB só para desenhar 12
-- linhas na tabela — a tela levava dezenas de segundos.
--
-- Aqui o filtro, a ordenação, a paginação e a CONTAGEM passam para o Postgres:
-- a tela pede uma página e recebe uma página.

-- ---------- 1. Índice da busca livre ----------
-- No Supabase as extensões moram no schema `extensions` — sem o qualificador o
-- `create index` falha com "operator class gin_trgm_ops does not exist".
create extension if not exists pg_trgm with schema extensions;

-- `ilike '%termo%'` não usa índice B-tree; sem isto é Seq Scan nas 41 mil linhas
-- (medido: 184 ms). O GIN de trigramas atende o `like` com curinga dos dois lados.
--
-- ⚠️ A expressão indexada tem que ser IDÊNTICA à do `where` da função, senão o
-- índice não é usado e ninguém avisa.
--
-- `tags` ficou DE FORA da busca livre de propósito: `array_to_string` não é
-- immutable e não entra em índice, e o OR com um `exists` sobre `unnest`
-- derrubaria o plano da busca inteira. Tag continua pesquisável pelo filtro
-- avançado e pelas listas inteligentes, que é onde ela é usada de verdade
-- (hoje 5 contatos têm tag).
create index if not exists contacts_busca_trgm_idx
  on public.contacts using gin (
    (lower(
      first_name || ' ' || last_name || ' ' || email || ' ' || phone
      || ' ' || coalesce(company, '')
    )) extensions.gin_trgm_ops
  );

-- Ordenação padrão da tela (mais recentes primeiro). O desempate por `id` é o
-- mesmo da paginação do app: a importação grava 500 linhas por transação, então
-- as 500 saem com o MESMO `created_at` e ordem instável faria a página 2
-- repetir e pular contatos.
create index if not exists contacts_location_created_idx
  on public.contacts (location_id, created_at desc, id desc);

-- ---------- 2. Busca paginada ----------
-- security definer + checagem de empresa NA PRIMEIRA LINHA — o padrão da 0049.
-- Sob RLS, um `where` que chama função não-leakproof (`lower`) não pode ser
-- avaliado antes das políticas, sai de baixo do índice funcional e vira Seq
-- Scan. Foi exatamente o que fez `lead_payment_profile` estourar o timeout.
-- ⚠️ Ao mexer nesta função, MANTENHA a checagem de membership no topo: sem ela,
-- `security definer` significa "qualquer autenticado lê o contato de qualquer
-- empresa".
create or replace function public.search_contacts(
  p_location uuid,
  p_query text default '',
  p_conditions jsonb default '[]'::jsonb,
  p_sort text default 'created_at',
  p_dir text default 'desc',
  p_limit int default 12,
  p_offset int default 0
)
returns table (
  id uuid,
  first_name text,
  last_name text,
  email text,
  phone text,
  doc text,
  company text,
  tags text[],
  owner_id uuid,
  dnd boolean,
  custom_fields jsonb,
  last_activity_at timestamptz,
  last_activity_channel text,
  created_at timestamptz,
  total bigint
)
language plpgsql
security definer
stable
set search_path = public, private, extensions
as $$
declare
  v_like text := case when nullif(btrim(coalesce(p_query, '')), '') is null
                      then null else '%' || lower(btrim(p_query)) || '%' end;
begin
  -- ⚠️ O guard fica FORA da consulta. Como CTE no `from` ele virava um join
  -- opaco e o planner desistia do índice de trigramas — medido: 153 ms com a
  -- CTE contra 81 ms sem, na mesma busca. E continua sendo a primeira coisa
  -- que roda.
  if p_location is null or p_location not in (select private.user_locations()) then
    return;
  end if;

  return query
  with filtrado as (
    select c.*
    from public.contacts c
    where c.location_id = p_location
      and (
        v_like is null
        or lower(
             c.first_name || ' ' || c.last_name || ' ' || c.email || ' ' || c.phone
             || ' ' || coalesce(c.company, '')
           ) like v_like
      )
      -- Filtros avançados / listas inteligentes: a linha passa quando NENHUMA
      -- condição falha. Avaliado com `jsonb_array_elements` em vez de SQL
      -- montado em texto — valor digitado pelo usuário não vira SQL aqui.
      and not exists (
        select 1
        from jsonb_array_elements(coalesce(p_conditions, '[]'::jsonb)) cond,
        lateral (
          select case cond.value->>'field'
                   when 'Tag' then array_to_string(c.tags, ' ')
                   when 'Empresa' then coalesce(c.company, '')
                   when 'E-mail' then c.email
                   when 'Telefone' then c.phone
                   else c.first_name || ' ' || c.last_name
                 end as hay
        ) h
        where
          -- Mesma semântica do `matchesConditions` do client (que a tela usava
          -- antes): "é" e "contém" são os dois SUBSTRING, "não é" é a negação.
          -- Trocar isso aqui mudaria o resultado das listas inteligentes já
          -- salvas, então fica como está.
          case when cond.value->>'operator' = 'não é'
               then strpos(lower(h.hay), lower(coalesce(cond.value->>'value', ''))) > 0
               else strpos(lower(h.hay), lower(coalesce(cond.value->>'value', ''))) = 0
          end
      )
  )
  select f.id, f.first_name, f.last_name, f.email, f.phone, f.doc, f.company,
         f.tags, f.owner_id, f.dnd, f.custom_fields, f.last_activity_at,
         f.last_activity_channel, f.created_at,
         -- Conta o filtro INTEIRO (a janela roda antes do limit) — é o número
         -- do selo "N contatos", que não pode virar "12".
         count(*) over () as total
  from filtrado f
  order by
    case when p_dir = 'asc' then
      case p_sort
        when 'name' then lower(f.first_name || ' ' || f.last_name)
        when 'company' then lower(coalesce(f.company, ''))
      end
    end asc nulls last,
    case when p_dir <> 'asc' then
      case p_sort
        when 'name' then lower(f.first_name || ' ' || f.last_name)
        when 'company' then lower(coalesce(f.company, ''))
      end
    end desc nulls last,
    case when p_sort = 'activity' and p_dir = 'asc'
         then coalesce(f.last_activity_at, f.created_at) end asc nulls last,
    case when p_sort = 'activity' and p_dir <> 'asc'
         then coalesce(f.last_activity_at, f.created_at) end desc nulls last,
    case when p_sort = 'created_at' and p_dir = 'asc' then f.created_at end asc,
    case when p_sort not in ('name', 'company', 'activity') or p_sort = 'created_at'
         then f.created_at end desc,
    f.id desc
  limit greatest(coalesce(p_limit, 12), 0)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

revoke all on function public.search_contacts(uuid, text, jsonb, text, text, int, int)
  from public, anon;
grant execute on function public.search_contacts(uuid, text, jsonb, text, text, int, int)
  to authenticated, service_role;

-- ---------- 3. Empresas (aba "Empresas" da tela de Contatos) ----------
-- A aba derivava as empresas percorrendo os 41 mil contatos no navegador. É um
-- `group by` — o banco responde em milissegundos e manda 5 linhas.
drop function if exists public.contact_companies(uuid);

create or replace function public.contact_companies(p_location uuid)
returns table (company text, contatos bigint, ultimo_contato timestamptz)
language sql
security definer
stable
set search_path = public, private
as $$
  select c.company, count(*), max(c.created_at)
  from public.contacts c
  where c.location_id = p_location
    and p_location in (select private.user_locations())
    and coalesce(btrim(c.company), '') <> ''
  group by c.company
  order by count(*) desc, c.company;
$$;

revoke all on function public.contact_companies(uuid) from public, anon;
grant execute on function public.contact_companies(uuid) to authenticated, service_role;

-- ---------- 4. Dedupe da importação ----------
-- O diálogo de importar montava o conjunto de "quem já existe" a partir do array
-- de contatos do store. Com a tela não carregando mais os 41 mil, esse array
-- fica vazio e a checagem sumiria em silêncio — reimportar o mesmo arquivo
-- voltaria a duplicar o histórico inteiro.
--
-- Aqui as chaves do ARQUIVO vão para o banco e voltam só as que já existem.
-- Mesmas chaves do CRM: documento (0048), telefone normalizado (0047) e e-mail.
create or replace function public.existing_contact_keys(
  p_location uuid,
  p_docs text[] default '{}',
  p_phones text[] default '{}',
  p_emails text[] default '{}'
)
returns table (chave text)
language sql
security definer
stable
set search_path = public, private
as $$
  select distinct k.chave
  from public.contacts c
  cross join lateral (
    values
      ('d:' || private.doc_key(c.doc)),
      ('p:' || private.phone_key(c.phone)),
      ('e:' || lower(btrim(c.email)))
  ) as k(chave)
  where c.location_id = p_location
    and p_location in (select private.user_locations())
    and k.chave in (
      select 'd:' || private.doc_key(d) from unnest(coalesce(p_docs, '{}')) d
      union all
      select 'p:' || private.phone_key(f) from unnest(coalesce(p_phones, '{}')) f
      union all
      select 'e:' || lower(btrim(e)) from unnest(coalesce(p_emails, '{}')) e
    );
$$;

revoke all on function public.existing_contact_keys(uuid, text[], text[], text[])
  from public, anon;
grant execute on function public.existing_contact_keys(uuid, text[], text[], text[])
  to authenticated, service_role;
