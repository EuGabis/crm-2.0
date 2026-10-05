-- ============================================================
-- Índice parcial das conversas ABERTAS com mensagem não lida.
--
-- O sino de notificações pergunta, por aba, "as 15 não lidas mais recentes
-- (minhas ou de ninguém)". Sem este índice o Postgres percorria a caixa
-- inteira (9+ mil conversas) pela ordem de `last_message_at`, avaliando a RLS
-- de `conversations` linha a linha até achar 15 — a tela de Saúde mediu 4 s.
-- Com o índice parcial, só entram no percurso as conversas que de fato têm
-- não lidas e estão abertas: algumas centenas.
--
-- O `where` do índice tem de bater com o filtro da consulta
-- (`unread_count > 0`, `closed_at is null`, `archived_at is null`), senão o
-- planner o ignora sem avisar.
--
-- Só índice: não muda dado nem permissão. Em ~9 mil linhas é criado em menos
-- de um segundo. Idempotente.
-- ============================================================

create index if not exists conversations_nao_lidas_idx
  on public.conversations (location_id, last_message_at desc)
  where unread_count > 0 and closed_at is null and archived_at is null;
