-- ============================================================
-- Lito CRM — Email Marketing: claim atômico de destinatários
-- Evita envio duplicado quando dois ticks do cron se sobrepõem.
-- Rode este arquivo inteiro de uma vez no SQL Editor.
-- ============================================================
set check_function_bodies = off;

alter table public.email_campaign_recipients
  add column if not exists claimed_at timestamptz;

create index if not exists ecr_claim_idx
  on public.email_campaign_recipients (campaign_id, status, claimed_at);

-- Reivindica atomicamente um lote de destinatários pendentes e o retorna já com os
-- dados do contato. FOR UPDATE SKIP LOCKED garante que dois ticks simultâneos peguem
-- lotes diferentes (nunca o mesmo destinatário duas vezes). Um claim "preso" (tick que
-- caiu antes de marcar 'sent') é reaproveitado após 5 minutos.
create or replace function public.claim_recipients(p_campaign_id uuid, p_limit int)
returns table (
  id uuid,
  contact_id uuid,
  email text,
  first_name text,
  last_name text,
  custom_fields jsonb
) language plpgsql security definer set search_path = '' as $$
begin
  -- só envia se a campanha ainda estiver 'sending' (respeita pausa/cancelamento)
  if not exists (
    select 1 from public.email_campaigns c
    where c.id = p_campaign_id and c.status = 'sending'
  ) then
    return;
  end if;

  return query
  with picked as (
    select r.id
    from public.email_campaign_recipients r
    where r.campaign_id = p_campaign_id
      and r.status = 'pending'
      and (r.claimed_at is null or r.claimed_at < now() - interval '5 minutes')
    order by r.created_at
    limit p_limit
    for update skip locked
  ),
  claimed as (
    update public.email_campaign_recipients r
    set claimed_at = now()
    from picked
    where r.id = picked.id
    returning r.id, r.contact_id, r.email
  )
  select cl.id, cl.contact_id, cl.email, ct.first_name, ct.last_name, ct.custom_fields
  from claimed cl
  join public.contacts ct on ct.id = cl.contact_id;
end;
$$;

revoke all on function public.claim_recipients(uuid, int) from public, anon, authenticated;
grant execute on function public.claim_recipients(uuid, int) to service_role;
