-- ============================================================
-- Lito CRM — Importação: marcar a TAG nos contatos que já existem
--
-- A dedup da 0078 PULA quem já existe (não duplica) — mas com isso um contato já
-- existente não recebe a tag da importação e fica de fora da lista inteligente.
-- Para "importar como lista" funcionar de verdade, os já existentes precisam
-- receber a tag também (sem virar linha duplicada).
--
-- Esta função adiciona um conjunto de tags a TODOS os contatos da empresa do
-- chamador que casem por telefone (private.phone_key), e-mail ou documento com o
-- lote enviado. Faz a união (sem repetir tag). Set-based (um UPDATE por lote),
-- usando os índices de 0047/0078. SECURITY DEFINER, escopo pela membership.
-- Idempotente.
-- ============================================================
set check_function_bodies = off;

create or replace function public.add_tags_to_existing(
  p_phones text[],
  p_emails text[],
  p_docs   text[],
  p_tags   text[]
)
returns integer
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_loc uuid;
  v_pk  text[];
  v_em  text[];
  v_dc  text[];
  v_n   integer;
begin
  select location_id into v_loc
  from public.location_members
  where user_id = (select auth.uid())
  limit 1;
  if v_loc is null or p_tags is null or array_length(p_tags, 1) is null then
    return 0;
  end if;

  select array_agg(distinct k) into v_pk
  from (select private.phone_key(p) as k from unnest(coalesce(p_phones, '{}')) as p) s
  where k <> '';

  select array_agg(distinct e) into v_em
  from (select lower(trim(x)) as e from unnest(coalesce(p_emails, '{}')) as x) s
  where e like '%@%';

  select array_agg(distinct d) into v_dc
  from (select regexp_replace(coalesce(x, ''), '\D', '', 'g') as d from unnest(coalesce(p_docs, '{}')) as x) s
  where length(d) >= 11;

  with upd as (
    update public.contacts c
    set tags = (select array_agg(distinct t) from unnest(c.tags || p_tags) as t)
    where c.location_id = v_loc
      and (
        (v_pk is not null and private.phone_key(c.phone) = any(v_pk))
        or (v_em is not null and lower(trim(c.email)) = any(v_em))
        or (v_dc is not null and regexp_replace(coalesce(c.doc, ''), '\D', '', 'g') = any(v_dc))
      )
    returning 1
  )
  select count(*) into v_n from upd;

  return coalesce(v_n, 0);
end;
$$;

revoke all on function public.add_tags_to_existing(text[], text[], text[], text[]) from public, anon;
grant execute on function public.add_tags_to_existing(text[], text[], text[], text[]) to authenticated;
