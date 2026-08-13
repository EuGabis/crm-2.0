-- ============================================================
-- Lito CRM — WhatsApp auto-responder: flag de handoff humano
--
-- Quando um humano responde uma conversa pelo inbox (/api/whatsapp/send),
-- marcamos bot_paused=true e o auto-responder para de responder AQUELA conversa.
-- Nasce false. Idempotente.
-- ============================================================
alter table public.conversations
  add column if not exists bot_paused boolean not null default false;
