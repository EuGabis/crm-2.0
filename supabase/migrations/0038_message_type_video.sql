-- Lito CRM — permite mensagens do tipo 'video' (mídia real do WhatsApp).
-- Idempotente (drop + add da constraint). Aplicar no SQL Editor.
set check_function_bodies = off;
alter table public.messages drop constraint if exists messages_type_check;
alter table public.messages add constraint messages_type_check
  check (type in ('text', 'audio', 'image', 'file', 'event', 'video'));
