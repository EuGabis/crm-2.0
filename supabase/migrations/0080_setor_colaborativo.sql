-- ============================================================
-- Lito CRM — Setor colaborativo (supervisão por departamento)
--
-- Pedido do Gabriel: em um departamento escolhido, os membros podem VER todas as
-- conversas do setor (não só as suas) num RELATÓRIO e ASSUMIR uma conversa que
-- está parada com outro atendente. A caixa de Conversas continua privada (cada
-- um só vê as suas) — a visão do setor e o "assumir" acontecem no relatório.
--
-- Peças:
--   1. departments.colaborativo (bool) — o admin liga por setor.
--   2. private.can_supervise_conv(conv) — admin OU membro de um setor colaborativo
--      cujos canais incluem o canal da conversa.
--   3. public.take_over_conversation(conv) — reatribui a conversa ao chamador
--      (pausa o bot, reabre) se ele pode supervisionar. SECURITY DEFINER.
--   4. public.sector_conversations() — lista as conversas que o chamador pode
--      supervisionar (as do seu setor colaborativo; admin vê todas). Não abre a
--      RLS da caixa — é uma leitura própria pro relatório.
-- Idempotente.
-- ============================================================
set check_function_bodies = off;

alter table public.departments
  add column if not exists colaborativo boolean not null default false;

-- ---------- 2. Quem pode supervisionar esta conversa ----------
create or replace function private.can_supervise_conv(conv_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select
    exists (
      select 1 from public.conversations c
      where c.id = conv_id and private.is_admin(c.location_id)
    )
    or exists (
      select 1
      from public.conversations c
      join public.location_members lm
        on lm.user_id = (select auth.uid()) and lm.location_id = c.location_id
      join public.departments d
        on d.id = lm.department_id and d.colaborativo = true
      join public.department_channels dc
        on dc.department_id = d.id and dc.channel_id = c.channel_id
      where c.id = conv_id
    );
$$;
revoke all on function private.can_supervise_conv(uuid) from public, anon;
grant execute on function private.can_supervise_conv(uuid) to authenticated;

-- ---------- 3. Assumir a conversa ----------
create or replace function public.take_over_conversation(conv_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_loc uuid;
begin
  if not private.can_supervise_conv(conv_id) then
    return false;
  end if;
  update public.conversations
     set assigned_to = (select auth.uid()),
         -- Humano assumiu → bot para; e reabre se estava finalizada/arquivada.
         bot_paused = true,
         closed_at = null,
         closed_by = null,
         archived_at = null,
         archived_by = null
   where id = conv_id
   returning location_id into v_loc;
  return v_loc is not null;
end;
$$;
revoke all on function public.take_over_conversation(uuid) from anon;
grant execute on function public.take_over_conversation(uuid) to authenticated;

-- ---------- 4. Conversas do setor (para o relatório) ----------
create or replace function public.sector_conversations()
returns table (
  id uuid,
  contact_id uuid,
  contact_first text,
  contact_last text,
  contact_phone text,
  assigned_to uuid,
  channel_id uuid,
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
  select c.id, c.contact_id, ct.first_name, ct.last_name, ct.phone,
         c.assigned_to, c.channel_id, c.closed_at, c.archived_at,
         c.last_message_at, c.last_message_preview, c.created_at
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
