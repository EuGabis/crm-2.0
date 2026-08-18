-- ============================================================
-- Lito CRM — Distribuição inteligente de leads (Etapa A)
--
-- Rodízio de leads QUENTES entre atendentes online. Peças:
--  - presença: location_members.last_seen_at (heartbeat do app); online = ≤ 5 min.
--  - pool por número: whatsapp_channels.lead_pool (user_ids elegíveis) + rr_cursor.
--  - fila: conversations.awaiting_distribution (quando ninguém online — Etapa B).
--  - touch_presence(): o próprio usuário marca presença (SECURITY DEFINER, só a
--    própria linha), sem alargar o UPDATE de location_members.
-- Idempotente.
-- ============================================================
set check_function_bodies = off;

-- Presença dos membros (heartbeat).
alter table public.location_members
  add column if not exists last_seen_at timestamptz;
create index if not exists location_members_presence_idx
  on public.location_members (location_id, last_seen_at);

-- Pool de distribuição por número + cursor do rodízio.
alter table public.whatsapp_channels
  add column if not exists lead_pool uuid[] not null default '{}',
  add column if not exists rr_cursor int not null default 0;

-- Lead quente sem ninguém online fica aguardando o admin distribuir (Etapa B).
alter table public.conversations
  add column if not exists awaiting_distribution boolean not null default false;
create index if not exists conversations_awaiting_dist_idx
  on public.conversations (location_id)
  where awaiting_distribution;

-- Heartbeat: o usuário logado carimba a própria presença. SECURITY DEFINER para
-- não precisar de policy de UPDATE em location_members (evita brecha lateral).
create or replace function public.touch_presence()
returns void
language sql
security definer
set search_path = public
as $$
  update public.location_members
     set last_seen_at = now()
   where user_id = auth.uid();
$$;
revoke all on function public.touch_presence() from anon;
grant execute on function public.touch_presence() to authenticated;
