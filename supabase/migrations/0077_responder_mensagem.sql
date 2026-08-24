-- ============================================================
-- Lito CRM — Responder uma mensagem específica (citação estilo WhatsApp)
--
-- Pedido do Gabriel: poder "marcar pra responder uma mensagem específica".
-- Guarda o vínculo da resposta com a mensagem citada. No WhatsApp isso vira o
-- `context.message_id` da Cloud API (o cliente vê a citação); no CRM mostramos
-- a prévia da mensagem citada dentro da bolha.
--
-- Coluna nova, anulável: mensagens antigas ficam com NULL (sem citação). Ao
-- excluir a mensagem citada, o vínculo vira NULL (a resposta continua existindo).
-- Idempotente.
-- ============================================================
alter table public.messages
  add column if not exists reply_to uuid references public.messages(id) on delete set null;

-- Busca "quem respondeu esta mensagem" é rara; o índice serve para o lookup do
-- alvo ao renderizar a citação e para o ON DELETE SET NULL não varrer a tabela.
create index if not exists messages_reply_to_idx on public.messages(reply_to);
