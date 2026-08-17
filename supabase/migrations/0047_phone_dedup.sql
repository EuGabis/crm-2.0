-- Lito CRM — deduplicação de contatos por telefone
--
-- Problema: o telefone é guardado em formatos diferentes (à mão "(21) 99717-0842"
-- vs. do WhatsApp "5521997170842"), e o webhook casava por texto EXATO. Resultado:
-- o mesmo número virava 2 contatos + 2 conversas.
--
-- Solução: uma chave canônica `phone_key` (só dígitos, sem o 55, ignorando o 9º
-- dígito de celular) usada para achar o contato que já existe. Não altera o valor
-- exibido de `contacts.phone` — só padroniza a COMPARAÇÃO.

-- ---------- 1. Função de normalização (imutável, p/ índice e RPC) ----------
create or replace function private.phone_key(raw text)
returns text
language sql
immutable
set search_path = ''
as $$
  with d as (
    select regexp_replace(coalesce(raw, ''), '\D', '', 'g') as digits
  ),
  s as (
    -- tira o código do país (55) quando presente
    select case
             when length(digits) >= 12 and left(digits, 2) = '55'
               then substr(digits, 3)
             else digits
           end as n
    from d
  )
  -- chave = DDD (2) + últimos 8 dígitos → une "com" e "sem" o 9º dígito de celular
  select case when length(n) < 10 then n else left(n, 2) || right(n, 8) end
  from s;
$$;

revoke all on function private.phone_key(text) from public, anon;
grant execute on function private.phone_key(text) to authenticated, service_role;

-- ---------- 2. Índice funcional (busca rápida por número normalizado) ----------
create index if not exists contacts_phone_key_idx
  on public.contacts (location_id, (private.phone_key(phone)));

-- ---------- 3. Busca de contato por número (webhook + app) ----------
-- security definer: o webhook chama com a service role (auth.uid() nulo → liberado);
-- o app só consegue buscar na própria empresa (checagem de membership).
create or replace function public.find_contact_by_phone(p_location uuid, p_phone text)
returns uuid
language sql
security definer
stable
set search_path = public, private
as $$
  select id
  from public.contacts
  where location_id = p_location
    and private.phone_key(p_phone) <> ''
    and private.phone_key(phone) = private.phone_key(p_phone)
    and (auth.uid() is null or p_location in (select private.user_locations()))
  order by created_at asc
  limit 1;
$$;

revoke all on function public.find_contact_by_phone(uuid, text) from public, anon;
grant execute on function public.find_contact_by_phone(uuid, text) to authenticated, service_role;
