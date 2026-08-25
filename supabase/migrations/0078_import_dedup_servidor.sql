-- ============================================================
-- Lito CRM — Deduplicação da importação NO SERVIDOR
--
-- Problema: a importação deduplicava no cliente, comparando com os contatos
-- carregados em memória. Quando a lista de contatos virou busca paginada no
-- servidor (o cliente não segura mais os 40 mil), esse filtro ficou vazio e a
-- importação passou a criar DUPLICADOS de quem já existia (mesmo e-mail/telefone).
--
-- Solução: uma função que, dado o conjunto de telefones/e-mails/documentos de um
-- lote, devolve QUAIS chaves canônicas JÁ EXISTEM na empresa do chamador. A rota
-- /api/contacts/import usa isso para pular os que já existem antes de inserir.
--
-- Chaves canônicas:
--   telefone → private.phone_key (0047): só dígitos, sem 55, DDD + últimos 8.
--   e-mail   → lower(trim(email)).
--   doc      → só dígitos.
-- SECURITY DEFINER: resolve a empresa pelo próprio auth.uid() (membership) e só
-- enxerga contatos dessa empresa. Idempotente.
-- ============================================================
set check_function_bodies = off;

create or replace function public.existing_contact_keys(
  p_phones text[],
  p_emails text[],
  p_docs   text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_loc uuid;
  v_phone_keys text[];
  v_emails     text[];
  v_docs       text[];
begin
  -- Empresa do chamador (fluxo atual: um membership por usuário).
  select location_id into v_loc
  from public.location_members
  where user_id = (select auth.uid())
  limit 1;
  if v_loc is null then
    return jsonb_build_object('phones', '[]'::jsonb, 'emails', '[]'::jsonb, 'docs', '[]'::jsonb);
  end if;

  -- Normaliza as entradas do lote (descarta vazios).
  select array_agg(distinct k)
    into v_phone_keys
  from (
    select private.phone_key(p) as k
    from unnest(coalesce(p_phones, '{}')) as p
  ) s
  where k <> '';

  select array_agg(distinct e)
    into v_emails
  from (
    select lower(trim(x)) as e
    from unnest(coalesce(p_emails, '{}')) as x
  ) s
  where e <> '' and e like '%@%';

  select array_agg(distinct d)
    into v_docs
  from (
    select regexp_replace(coalesce(x, ''), '\D', '', 'g') as d
    from unnest(coalesce(p_docs, '{}')) as x
  ) s
  where length(d) >= 11;

  return jsonb_build_object(
    'phones', coalesce((
      select jsonb_agg(distinct private.phone_key(c.phone))
      from public.contacts c
      where c.location_id = v_loc
        and v_phone_keys is not null
        and private.phone_key(c.phone) = any(v_phone_keys)
    ), '[]'::jsonb),
    'emails', coalesce((
      select jsonb_agg(distinct lower(trim(c.email)))
      from public.contacts c
      where c.location_id = v_loc
        and v_emails is not null
        and lower(trim(c.email)) = any(v_emails)
    ), '[]'::jsonb),
    'docs', coalesce((
      select jsonb_agg(distinct regexp_replace(coalesce(c.doc, ''), '\D', '', 'g'))
      from public.contacts c
      where c.location_id = v_loc
        and v_docs is not null
        and regexp_replace(coalesce(c.doc, ''), '\D', '', 'g') = any(v_docs)
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.existing_contact_keys(text[], text[], text[]) from public, anon;
grant execute on function public.existing_contact_keys(text[], text[], text[]) to authenticated;

-- Índices auxiliares para o e-mail/doc casarem rápido no lote (o telefone já tem
-- contacts_phone_key_idx da 0047). Funcionais, por empresa.
create index if not exists contacts_email_lower_idx
  on public.contacts (location_id, lower(trim(email)));
create index if not exists contacts_doc_digits_idx
  on public.contacts (location_id, (regexp_replace(coalesce(doc, ''), '\D', '', 'g')));
