-- ============================================================
-- Lito CRM — sector_conversations com campos completos para o Relatório
--
-- O relatório de Conversas passa a mostrar TODAS as conversas do setor para o
-- supervisor (setor colaborativo/admin). Para isso a função precisa devolver
-- também e-mail do contato, canal (texto), se é receptivo (tem entrada) — além do
-- que já devolvia. Recria a função (DROP + CREATE porque o tipo de retorno muda).
-- Mesmas regras de acesso da 0080. Idempotente.
-- ============================================================
set check_function_bodies = off;

drop function if exists public.sector_conversations();

create function public.sector_conversations()
returns table (
  id uuid,
  contact_id uuid,
  contact_first text,
  contact_last text,
  contact_phone text,
  contact_email text,
  assigned_to uuid,
  channel text,
  channel_id uuid,
  inbound boolean,
  closed_at timestamptz,
  archived_at timestamptz,
  last_message_at timestamptz,
  last_message_preview text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public, private
as $$
  with me as (
    select lm.location_id,
           lm.department_id,
           lm.role,
           coalesce(d.colaborativo, false) as colaborativo
    from public.location_members lm
    left join public.departments d on d.id = lm.department_id
    where lm.user_id = (select auth.uid())
    limit 1
  )
  select c.id, c.contact_id, ct.first_name, ct.last_name, ct.phone, ct.email,
         c.assigned_to, c.channel, c.channel_id,
         exists (
           select 1 from public.messages m
           where m.conversation_id = c.id and m.direction = 'in'
         ) as inbound,
         c.closed_at, c.archived_at, c.last_message_at, c.last_message_preview, c.created_at
  from me
  join public.conversations c on c.location_id = me.location_id
  left join public.contacts ct on ct.id = c.contact_id
  where
    me.role = 'admin'
    or (
      me.colaborativo
      and exists (
        select 1 from public.department_channels dc
        where dc.department_id = me.department_id
          and dc.channel_id = c.channel_id
      )
    )
  order by c.last_message_at desc nulls last
  limit 500;
$$;
revoke all on function public.sector_conversations() from anon;
grant execute on function public.sector_conversations() to authenticated;
