-- ============================================================
-- Lito CRM — Distribuição de leads: pool no DEPARTAMENTO (ajuste da Etapa A)
--
-- O pool do rodízio pertence ao departamento (que já agrupa atendentes e números
-- via department_channels), não ao número. O número herda o pool pelo vínculo.
--   - departments.lead_pool: user_ids do rodízio. Vazio = todos do departamento.
--   - departments.rr_cursor: cursor do rodízio (fairness).
-- As colunas equivalentes em whatsapp_channels (0056) ficam órfãs — o motor não
-- as usa mais. Presença (location_members.last_seen_at), fila
-- (conversations.awaiting_distribution) e touch_presence() continuam da 0056.
-- Idempotente.
-- ============================================================
set check_function_bodies = off;

alter table public.departments
  add column if not exists lead_pool uuid[] not null default '{}',
  add column if not exists rr_cursor int not null default 0;
