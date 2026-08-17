-- ============================================================
-- Lito CRM — Detalhe do lead: cruzamento com os dados da Guru
--
-- O card do funil abre uma tela com o contato, os comentários e — quando o
-- mesmo comprador existe na Guru — as vendas e assinaturas dele. O problema é
-- CASAR as duas pontas: o contato do CRM e o comprador da Guru são cadastros
-- independentes.
--
-- Ordem de casamento (definida pelo Gabriel, da mais forte para a mais fraca):
--   1. CPF/CNPJ  — documento é único por pessoa; é a chave principal
--   2. Telefone  — quando o documento não bate ou o contato não tem documento
--   3. E-mail    — complemento
--   4. Nome      — último recurso (homônimo existe; por isso é o fim da fila)
-- A PRIMEIRA chave que encontra algo ganha, e a tela mostra qual foi — sem
-- isso o usuário não teria como saber se "achou o cliente" ou "achou alguém
-- com nome parecido".
--
-- Duas decisões que valem registro:
--
-- * `payment_events`/`payment_subscriptions` NÃO têm coluna de documento nem de
--   telefone — só nome e e-mail (migração 0008/0012). Os dois campos existem
--   dentro de `raw->'contact'` em 100% das linhas (conferido: 24.832/24.832
--   vendas e 2.453/2.453 assinaturas). Em vez de criar colunas e fazer
--   backfill (reescrita de tabela + mais um lugar para o mapeamento da Guru
--   esquecer de preencher), este arquivo indexa a EXPRESSÃO que lê do `raw`.
--   O `raw` é a fonte de verdade declarada na 0008; ler dele não pode ficar
--   defasado.
--
-- * A cascata roda no BANCO (`public.lead_payment_profile`), não no client. Se
--   rodasse no navegador, cada passo seria uma ida e volta e o "casou por
--   telefone" poderia sair de uma consulta enquanto as vendas vinham de outra
--   — chave inconsistente com os dados ao lado. A função é `stable` e SEM
--   security definer de propósito: a RLS de membership de cada tabela continua
--   valendo para quem chama, então não há como ler pagamento de outra empresa
--   passando outro `p_location`.
--
-- `private.phone_key` (migração 0047, do trabalho de deduplicação) é reusada
-- como está — telefone normalizado tem que significar a mesma coisa nos dois
-- lugares.
--
-- Idempotente.
-- ============================================================

-- ---------- 1. Documento normalizado (espelha private.phone_key) ----------
-- Só dígitos: o CRM recebe o CPF digitado à mão ("123.456.789-00") e a Guru
-- devolve sem pontuação ("12345678900"). Comparar texto cru nunca casaria.
create or replace function private.doc_key(raw text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(regexp_replace(coalesce(raw, ''), '\D', '', 'g'), '');
$$;

revoke all on function private.doc_key(text) from public, anon;
grant execute on function private.doc_key(text) to authenticated, service_role;

-- ---------- 2. CPF/CNPJ no contato do CRM ----------
-- Coluna de primeira classe (não campo personalizado): é a chave principal do
-- cruzamento e precisa de índice.
alter table public.contacts
  add column if not exists doc text;

create index if not exists contacts_doc_key_idx
  on public.contacts (location_id, (private.doc_key(doc)));

-- ---------- 3. Índices do cruzamento ----------
-- Um por chave da cascata, nas duas tabelas de pagamento. Sem eles cada
-- abertura de lead varreria as ~25 mil vendas extraindo jsonb.

create index if not exists payment_events_doc_idx
  on public.payment_events (location_id, (private.doc_key(raw -> 'contact' ->> 'doc')));

create index if not exists payment_events_phone_idx
  on public.payment_events
  (location_id, (private.phone_key(raw -> 'contact' ->> 'phone_number')));

create index if not exists payment_events_email_lower_idx
  on public.payment_events (location_id, (lower(trim(contact_email))));

create index if not exists payment_events_name_lower_idx
  on public.payment_events (location_id, (lower(trim(contact_name))));

create index if not exists payment_subscriptions_doc_idx
  on public.payment_subscriptions (location_id, (private.doc_key(raw -> 'contact' ->> 'doc')));

create index if not exists payment_subscriptions_phone_idx
  on public.payment_subscriptions
  (location_id, (private.phone_key(raw -> 'contact' ->> 'phone_number')));

create index if not exists payment_subscriptions_email_lower_idx
  on public.payment_subscriptions (location_id, (lower(trim(contact_email))));

create index if not exists payment_subscriptions_name_lower_idx
  on public.payment_subscriptions (location_id, (lower(trim(contact_name))));

-- payment_guru_contacts (0018) já tem índice simples em doc e phone, mas em
-- TEXTO CRU — inútil para comparar com valor normalizado.
create index if not exists payment_guru_contacts_doc_key_idx
  on public.payment_guru_contacts (location_id, (private.doc_key(doc)));

create index if not exists payment_guru_contacts_phone_key_idx
  on public.payment_guru_contacts (location_id, (private.phone_key(phone)));

create index if not exists payment_guru_contacts_email_lower_idx
  on public.payment_guru_contacts (location_id, (lower(trim(email))));

create index if not exists payment_guru_contacts_name_lower_idx
  on public.payment_guru_contacts (location_id, (lower(trim(name))));

-- ---------- 4. O perfil de pagamento de um lead ----------
-- Uma chamada, uma chave, tudo consistente:
--   { match_key, guru_contact, sales[], subscriptions[], totals }
-- `match_key` nulo = nenhuma das quatro chaves achou nada (a tela mostra o
-- vazio explicando o que foi tentado, em vez de fingir que o cliente não
-- comprou).
--
-- Os vocabulários de status espelham classifyGuruStatus() em
-- src/lib/data/guru.ts, igual às views 0016/0020 — se aquele arquivo mudar,
-- mudar aqui junto.
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
begin
  if p_location is null then
    return jsonb_build_object('match_key', null, 'guru_contact', null,
                             'sales', '[]'::jsonb, 'subscriptions', '[]'::jsonb,
                             'totals', null);
  end if;

  -- ----- cascata: documento -> telefone -> e-mail -> nome -----
  -- Cada bloco pergunta "existe alguma coisa por esta chave?" com predicado
  -- literal (uma chave só), para o planner poder usar o índice.

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
    return jsonb_build_object('match_key', null, 'guru_contact', null,
                             'sales', '[]'::jsonb, 'subscriptions', '[]'::jsonb,
                             'totals', null);
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
