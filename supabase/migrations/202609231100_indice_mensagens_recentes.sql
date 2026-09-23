-- Índice de messages por created_at (sem location_id na frente).
--
-- A caixa carrega as 3.000 mensagens mais recentes (`order by created_at desc
-- limit 3000`) e o syncInboxDelta busca `created_at > cursor` a cada 15 s. Sem
-- filtro de location no cliente, o índice (location_id, created_at) não servia:
-- o plano era Seq Scan nas 143 mil mensagens + RLS por linha + sort — passava
-- de 25 s e estourava o statement_timeout de 8 s em TODA abertura da caixa
-- (dezenas de 57014 nos logs de 2026-09-23, mesmo depois da 202609231000).
-- Com este índice: Index Scan que para no limit — 1,1 s como admin, 2,9 s como
-- vendedor (only_assigned). Aditivo, idempotente. Aplicado via MCP.
create index if not exists messages_created_at_idx
  on public.messages (created_at desc, id desc);
