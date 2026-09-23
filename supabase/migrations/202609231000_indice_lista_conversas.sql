-- Índice da ORDEM da caixa de entrada (last_message_at desc nulls last, id desc).
--
-- Relato (2026-09-23): a caixa demora e, filtrando por responsável, "Nenhuma
-- conversa". Medido: 8.049 conversas, e o load paginava por OFFSET — cada uma
-- das 9 páginas refazia Seq Scan + RLS por linha + sort das 8 mil (2,7 s na
-- página 8, como admin). Somado ao join do contato e à carga do horário, páginas
-- estouravam o statement_timeout de 8 s (dezenas de 57014 nos logs de hoje), e
-- página que falha devolve erro para a lista INTEIRA → caixa vazia.
--
-- Com este índice e paginação por cursor (keyset) no cliente, cada página vira
-- Index Scan que para no limit: 2,7 s → ~0,3 s. Aditivo, idempotente.
create index if not exists conversations_ordem_caixa_idx
  on public.conversations (last_message_at desc nulls last, id desc);
