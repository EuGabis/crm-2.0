-- ============================================================
-- Lito CRM — Recuperar E-MAIL dos contatos importados sem e-mail
--
-- Simétrico ao fill_missing_contact_phone (0088). Quando um contato importado já
-- existe no CRM e casou por TELEFONE ou DOCUMENTO (ex.: a mesma pessoa da base
-- RVOPS, que tinha telefone mas não e-mail), o e-mail que veio no arquivo não era
-- salvo — o contato ficava com "—" no e-mail. Esta função PREENCHE o e-mail VAZIO
-- do contato existente (casado por telefone ou documento) com o e-mail da linha
-- do arquivo, sem sobrescrever quem já tem e-mail e sem duplicar.
-- SECURITY DEFINER, por empresa. Idempotente.
-- ============================================================
set check_function_bodies = off;

create or replace function public.fill_missing_contact_email(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_loc   uuid;
  v_n     integer := 0;
  r       jsonb;
  v_email text;
  v_pk    text;
  v_doc   text;
begin
  select location_id into v_loc
  from public.location_members
  where user_id = (select auth.uid())
  limit 1;
  if v_loc is null then
    return 0;
  end if;

  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_email := lower(btrim(coalesce(r->>'email', '')));
    if v_email not like '%@%' then
      continue;
    end if;
    v_pk  := private.phone_key(coalesce(r->>'phone', ''));
    v_doc := regexp_replace(coalesce(r->>'doc', ''), '\D', '', 'g');

    with upd as (
      update public.contacts c
         set email = v_email
       where c.location_id = v_loc
         and coalesce(c.email, '') = ''   -- só preenche e-mail VAZIO
         and (
           (v_pk <> '' and private.phone_key(c.phone) = v_pk)
           or (length(v_doc) >= 11 and regexp_replace(coalesce(c.doc, ''), '\D', '', 'g') = v_doc)
         )
      returning 1
    )
    select v_n + count(*) into v_n from upd;
  end loop;

  return v_n;
end;
$$;

revoke all on function public.fill_missing_contact_email(jsonb) from public, anon;
grant execute on function public.fill_missing_contact_email(jsonb) to authenticated;
