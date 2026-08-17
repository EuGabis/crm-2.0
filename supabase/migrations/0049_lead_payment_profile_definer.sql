-- ============================================================
-- Lito CRM — Detalhe do lead: cruzamento sem estourar o tempo limite
--
-- A 0048 deixou `lead_payment_profile` como função NORMAL (security invoker),
-- de propósito: a RLS de cada tabela de pagamento valeria para quem chama, sem
-- eu ter que reimplementar a checagem de empresa. Bonito e errado.
--
-- Sob RLS, um `where` que chama função **não-leakproof** (`private.phone_key`,
-- `private.doc_key`, `lower`) NÃO pode ser avaliado antes das políticas — o
-- Postgres não arrisca vazar dado de outra linha por uma função que ele não
-- sabe se é segura. Resultado: o predicado sai de baixo do índice funcional e
-- vira filtro pós-RLS, ou seja, **Seq Scan** nas ~25 mil vendas calculando
-- jsonb + regexp linha a linha. Medido como `authenticated`: 7,7 s por
-- consulta, e a tela mostrava "canceling statement due to statement timeout".
-- Como `postgres` (RLS desligada) a mesma consulta é Index Scan de 0,2 ms —
-- por isso o teste original passou.
--
-- Duas saídas possíveis:
--   (a) colunas geradas (`generated always as ... stored`) nas duas tabelas de
--       pagamento, para o predicado virar `coluna = parâmetro`;
--   (b) `security definer` + checagem de empresa explícita.
-- Fica a (b): é o padrão que este repo já usa em `public.find_contact_by_phone`
-- (0047), não reescreve tabela de 25 mil linhas e não cria mais um campo
-- derivado para o mapeamento da Guru manter em dia.
--
-- O preço da (b) é que a checagem de tenant passa a ser MINHA — e é a primeira
-- coisa que a função faz. `private.user_locations()` continua enxergando o
-- `auth.uid()` de quem chamou (definer troca o dono, não o JWT), então quem não
-- é membro da empresa recebe o mesmo vazio de antes. Chamada com a service role
-- (auth.uid() nulo) também recebe vazio; só `authenticated` tem execute.
--
-- Idempotente (create or replace).
-- ============================================================

create or replace function public.lead_payment_profile(
  p_location uuid,
  p_doc text default null,
  p_phone text default null,
  p_email text default null,
  p_name text default null,
  p_limit int default 200
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_doc   text := private.doc_key(p_doc);
  v_phone text := nullif(private.phone_key(p_phone), '');
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_name  text := nullif(lower(trim(coalesce(p_name, ''))), '');

  -- Só a chave vencedora fica preenchida; as consultas finais leem daqui.
  m_doc   text := null;
  m_phone text := null;
  m_email text := null;
  m_name  text := null;

  v_key   text := null;
  v_hit   boolean;

  v_guru  jsonb;
  v_sales jsonb;
  v_subs  jsonb;
  v_totals jsonb;

  v_empty jsonb := jsonb_build_object(
    'match_key', null, 'guru_contact', null,
    'sales', '[]'::jsonb, 'subscriptions', '[]'::jsonb, 'totals', null
  );
begin
  -- ----- a única coisa que separa uma empresa da outra aqui -----
  -- Sem isto, `security definer` viraria "qualquer autenticado lê o pagamento
  -- de qualquer empresa passando outro p_location".
  if p_location is null
     or p_location not in (select private.user_locations()) then
    return v_empty;
  end if;

  -- ----- cascata: documento -> telefone -> e-mail -> nome -----
  -- Cada bloco pergunta "existe alguma coisa por esta chave?" com predicado
  -- literal (uma chave só), para o planner poder usar o índice da 0048.

  if v_key is null and v_doc is not null then
    select
      exists (
        select 1 from public.payment_events e
        where e.location_id = p_location
          and private.doc_key(e.raw -> 'contact' ->> 'doc') = v_doc
      )
      or exists (
        select 1 from public.payment_subscriptions s
        where s.location_id = p_location
          and private.doc_key(s.raw -> 'contact' ->> 'doc') = v_doc
      )
      or exists (
        select 1 from public.payment_guru_contacts g
        where g.location_id = p_location and private.doc_key(g.doc) = v_doc
      )
      into v_hit;
    if v_hit then
      v_key := 'doc';
      m_doc := v_doc;
    end if;
  end if;

  if v_key is null and v_phone is not null then
    select
      exists (
        select 1 from public.payment_events e
        where e.location_id = p_location
          and private.phone_key(e.raw -> 'contact' ->> 'phone_number') = v_phone
      )
      or exists (
        select 1 from public.payment_subscriptions s
        where s.location_id = p_location
          and private.phone_key(s.raw -> 'contact' ->> 'phone_number') = v_phone
      )
      or exists (
        select 1 from public.payment_guru_contacts g
        where g.location_id = p_location and private.phone_key(g.phone) = v_phone
      )
      into v_hit;
    if v_hit then
      v_key := 'phone';
      m_phone := v_phone;
    end if;
  end if;

  if v_key is null and v_email is not null then
    select
      exists (
        select 1 from public.payment_events e
        where e.location_id = p_location and lower(trim(e.contact_email)) = v_email
      )
      or exists (
        select 1 from public.payment_subscriptions s
        where s.location_id = p_location and lower(trim(s.contact_email)) = v_email
      )
      or exists (
        select 1 from public.payment_guru_contacts g
        where g.location_id = p_location and lower(trim(g.email)) = v_email
      )
      into v_hit;
    if v_hit then
      v_key := 'email';
      m_email := v_email;
    end if;
  end if;

  if v_key is null and v_name is not null then
    select
      exists (
        select 1 from public.payment_events e
        where e.location_id = p_location and lower(trim(e.contact_name)) = v_name
      )
      or exists (
        select 1 from public.payment_subscriptions s
        where s.location_id = p_location and lower(trim(s.contact_name)) = v_name
      )
      or exists (
        select 1 from public.payment_guru_contacts g
        where g.location_id = p_location and lower(trim(g.name)) = v_name
      )
      into v_hit;
    if v_hit then
      v_key := 'name';
      m_name := v_name;
    end if;
  end if;

  if v_key is null then
    return v_empty;
  end if;

  -- ----- contato da Guru (nome/doc/telefone/e-mail que ELA tem) -----
  select to_jsonb(x) into v_guru
  from (
    select g.external_id, g.name, g.email, g.doc, g.phone,
           g.guru_created_at, g.guru_updated_at
    from public.payment_guru_contacts g
    where g.location_id = p_location
      and (
        (m_doc   is not null and private.doc_key(g.doc) = m_doc)
        or (m_phone is not null and private.phone_key(g.phone) = m_phone)
        or (m_email is not null and lower(trim(g.email)) = m_email)
        or (m_name  is not null and lower(trim(g.name)) = m_name)
      )
    order by g.guru_updated_at desc nulls last
    limit 1
  ) x;

  -- ----- vendas (página visível) -----
  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_sales
  from (
    select e.id, e.code, e.status, e.amount, e.currency, e.product_name,
           e.contact_name, e.contact_email,
           e.raw -> 'contact' ->> 'doc' as contact_doc,
           e.raw -> 'contact' ->> 'phone_number' as contact_phone,
           e.guru_created_at, e.received_at
    from public.payment_events e
    where e.location_id = p_location
      and (
        (m_doc   is not null and private.doc_key(e.raw -> 'contact' ->> 'doc') = m_doc)
        or (m_phone is not null
            and private.phone_key(e.raw -> 'contact' ->> 'phone_number') = m_phone)
        or (m_email is not null and lower(trim(e.contact_email)) = m_email)
        or (m_name  is not null and lower(trim(e.contact_name)) = m_name)
      )
    order by e.guru_created_at desc nulls last
    limit greatest(p_limit, 1)
  ) x;

  -- ----- assinaturas (cabem todas; são poucas por pessoa) -----
  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_subs
  from (
    select s.id, s.code, s.status, s.amount, s.currency, s.product_name,
           s.contact_name, s.contact_email, s.charged_times, s.charged_every_days,
           s.next_cycle_at, s.guru_started_at, s.guru_updated_at
    from public.payment_subscriptions s
    where s.location_id = p_location
      and (
        (m_doc   is not null and private.doc_key(s.raw -> 'contact' ->> 'doc') = m_doc)
        or (m_phone is not null
            and private.phone_key(s.raw -> 'contact' ->> 'phone_number') = m_phone)
        or (m_email is not null and lower(trim(s.contact_email)) = m_email)
        or (m_name  is not null and lower(trim(s.contact_name)) = m_name)
      )
    order by s.guru_updated_at desc nulls last
    limit 200
  ) x;

  -- ----- totais sobre o HISTÓRICO INTEIRO, não sobre a página -----
  -- Somar o array de cima daria um número convincente e errado quando o
  -- comprador tem mais vendas do que p_limit.
  select jsonb_build_object(
           'approved_count', coalesce(count(*) filter (where aprovada), 0),
           'approved_total', coalesce(sum(amount) filter (where aprovada), 0),
           'refunded_count', coalesce(count(*) filter (where devolvida), 0),
           'refunded_total', coalesce(sum(amount) filter (where devolvida), 0),
           'sales_count', coalesce(count(*), 0),
           'first_sale_at', min(guru_created_at),
           'last_sale_at', max(guru_created_at)
         )
    into v_totals
  from (
    select e.amount, e.guru_created_at,
           lower(e.status) = any (array['approved','completed','trial','started','transferred'])
             as aprovada,
           lower(e.status) = any (array['refunded','chargeback','canceled','cancelled'])
             as devolvida
    from public.payment_events e
    where e.location_id = p_location
      and (
        (m_doc   is not null and private.doc_key(e.raw -> 'contact' ->> 'doc') = m_doc)
        or (m_phone is not null
            and private.phone_key(e.raw -> 'contact' ->> 'phone_number') = m_phone)
        or (m_email is not null and lower(trim(e.contact_email)) = m_email)
        or (m_name  is not null and lower(trim(e.contact_name)) = m_name)
      )
  ) t;

  v_totals := v_totals || jsonb_build_object(
    'active_subs',
    (
      select count(*)
      from jsonb_array_elements(v_subs) s
      where lower(coalesce(s ->> 'status', '')) = any (array['active','started','trial'])
    )
  );

  return jsonb_build_object(
    'match_key', v_key,
    'guru_contact', v_guru,
    'sales', v_sales,
    'subscriptions', v_subs,
    'totals', v_totals
  );
end;
$$;

revoke all on function public.lead_payment_profile(uuid, text, text, text, text, int)
  from public, anon;
grant execute on function public.lead_payment_profile(uuid, text, text, text, text, int)
  to authenticated;
