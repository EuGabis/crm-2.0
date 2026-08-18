-- ============================================================
-- Lito CRM — Notificação de VENDA NOVA (o que é, e o que não é)
--
-- "Chegou uma venda aprovada" NÃO serve como gatilho de aviso. Medido neste
-- banco, em 7 dias: 12.224 vendas aprovadas entraram, e só 93 eram de fato
-- novas. Avisar por chegada renderia doze mil pop-ups.
--
-- Os três casos que se disfarçam de venda nova:
--
-- 1. **Histórico sincronizando.** O backfill da Guru importa anos de vendas; o
--    `received_at` é de hoje e o `guru_created_at`, de 2024. Foram 12.033 nos
--    mesmos 7 dias.
-- 2. **Boleto/Pix antigo pago agora** (696 casos). A transação foi CRIADA
--    semanas atrás e só hoje mudou para aprovada: `dates.created_at` é velho,
--    `dates.confirmed_at` é de agora. É dinheiro entrando, e merece aparecer no
--    caixa — mas não é venda nova, é cobrança antiga liquidada.
-- 3. **Renovação de assinatura** (6.815 contra 411 primeiras cobranças, ou seja
--    94% do volume de plano). Cada ciclo gera uma transação nova, com
--    `guru_created_at` de agora: pelo critério de data, passaria como venda
--    nova todo mês, para sempre, no mesmo cliente.
--
-- Daí a definição desta view — venda nova é:
--   * status na família APROVADA (mesmo vocabulário de classifyGuruStatus);
--   * `guru_created_at` recente (a JANELA fica com quem consulta, não aqui:
--     o sino quer 24h, um relatório pode querer o mês);
--   * e, quando o produto é assinatura (`product.type = 'plan'`), apenas a
--     PRIMEIRA cobrança (`subscription.charged_times <= 1`).
--
-- `kind` sai pronto para a tela não precisar repetir a regra: 'avulsa' ou
-- 'assinatura-primeira'.
--
-- `security_invoker = on`: a RLS de `payment_events` (membership, da 0008)
-- continua valendo para quem consulta. A view não expõe `raw` — só os campos
-- que o aviso mostra.
--
-- Idempotente (create or replace).
-- ============================================================

create or replace view public.payment_new_sales
with (security_invoker = on) as
select
  e.id,
  e.location_id,
  e.code,
  e.status,
  e.amount,
  e.currency,
  e.product_name,
  e.contact_name,
  e.contact_email,
  e.guru_created_at,
  e.received_at,
  case
    when e.raw -> 'product' ->> 'type' = 'plan' then 'assinatura-primeira'
    else 'avulsa'
  end as kind
from public.payment_events e
where lower(e.status) = any (array['approved','completed','trial','started','transferred'])
  and e.guru_created_at is not null
  -- Renovação fica fora: só a primeira cobrança do plano conta como venda nova.
  and (
    e.raw -> 'product' ->> 'type' <> 'plan'
    or coalesce((e.raw -> 'subscription' ->> 'charged_times')::int, 0) <= 1
  );

grant select on public.payment_new_sales to authenticated;
revoke all on public.payment_new_sales from anon;
