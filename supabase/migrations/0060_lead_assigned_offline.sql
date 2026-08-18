-- ============================================================
-- Lito CRM — Leads recebidos offline (aba "Offline" nas Conversas)
--
-- Mudança de regra na distribuição: quando ALGUÉM do pool está online, o lead vai
-- só para os online (rodízio entre eles). Quando TODOS estão offline, distribui
-- igualitário entre todos do pool — e marca a conversa como `assigned_offline`
-- para o atendente ver, numa aba "Offline", os leads que caíram enquanto ele
-- estava fora. A flag limpa quando ele abre a conversa.
-- Idempotente.
-- ============================================================
set check_function_bodies = off;

alter table public.conversations
  add column if not exists assigned_offline boolean not null default false;

create index if not exists conversations_assigned_offline_idx
  on public.conversations (location_id, assigned_to)
  where assigned_offline;
