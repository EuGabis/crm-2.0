-- ============================================================
-- Lito CRM — Recuperar telefone dos contatos importados sem número
--
-- Uma importação anterior (RVOPS) entrou SEM telefone (o número estava na coluna
-- `mobile`, ainda não lida na época). Resultado: ~9 mil contatos sem telefone,
-- que não recebem WhatsApp/template.
--
-- Esta função PREENCHE o telefone VAZIO de um contato existente (casado por
-- e-mail ou documento) com o número da linha do arquivo — sem sobrescrever quem
-- já tem telefone e sem duplicar. A rota /api/contacts/import chama para os que
-- já existem, então basta reimportar o mesmo CSV (agora o parser lê o `mobile`).
-- SECURITY DEFINER, por empresa. Idempotente.
-- ============================================================
set check_function_bodies = off;

create or replace function public.fill_missing_contact_phone(p_rows jsonb)
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
  v_doc   text;
  v_phone text;
begin
  select location_id into v_loc
  from public.location_members
  where user_id = (select auth.uid())
  limit 1;
  if v_loc is null then
    return 0;
  end if;

  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_phone := btrim(coalesce(r->>'phone', ''));
    if v_phone = '' then
      continue;
    end if;
    v_email := lower(trim(coalesce(r->>'email', '')));
    v_doc   := regexp_replace(coalesce(r->>'doc', ''), '\D', '', 'g');

    with upd as (
      update public.contacts c
         set phone = v_phone
       where c.location_id = v_loc
         and coalesce(c.phone, '') = ''   -- só preenche telefone VAZIO
         and (
           (v_email like '%@%' and lower(trim(c.email)) = v_email)
           or (length(v_doc) >= 11 and regexp_replace(coalesce(c.doc, ''), '\D', '', 'g') = v_doc)
         )
      returning 1
    )
    select v_n + count(*) into v_n from upd;
  end loop;

  return v_n;
end;
$$;

revoke all on function public.fill_missing_contact_phone(jsonb) from public, anon;
grant execute on function public.fill_missing_contact_phone(jsonb) to authenticated;
