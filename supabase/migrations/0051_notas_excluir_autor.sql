-- ============================================================
-- Lito CRM — Observações: o autor pode excluir a própria nota
--
-- A 0040 deixou DELETE em `messages` só para admin, e com razão: sem isso um
-- usuário comum esvaziaria a conversa mensagem por mensagem, apagando o
-- histórico do cliente sem desfazer.
--
-- Só que nota interna não é histórico do cliente: é anotação da equipe, escrita
-- pelo próprio atendente, muitas vezes com erro de digitação. Exigir um
-- administrador para apagar "Teste teste" é atrito sem ganho de segurança.
--
-- Esta migração abre EXATAMENTE esse caso:
--   * a linha precisa ser `internal = true` (mensagem de cliente continua
--     intocável para quem não é admin);
--   * e ter sido escrita por quem está pedindo a exclusão.
--
-- Daí a coluna `created_by`: `messages` nunca soube quem escreveu (só
-- `scheduled_by`, e só para agendamento). Sem autor, "excluir a própria nota"
-- viraria "qualquer um exclui a nota de qualquer um". As mensagens ANTIGAS
-- ficam com `created_by` nulo e continuam admin-only — não há como adivinhar
-- retroativamente quem escreveu, e chutar seria pior.
--
-- Policies são permissivas e somam: a "admin exclui mensagens" da 0040
-- continua valendo em cima desta.
--
-- Idempotente.
-- ============================================================

alter table public.messages
  add column if not exists created_by uuid references auth.users (id) on delete set null;

drop policy if exists "autor exclui a propria nota" on public.messages;
create policy "autor exclui a propria nota" on public.messages
  for delete to authenticated
  using (
    location_id in (select private.user_locations())
    and internal is true
    and created_by is not null
    and created_by = (select auth.uid())
  );

-- "As notas desta conversa, e quem escreveu" — o painel de Observações lê
-- exatamente isso. Parcial: nota é minoria absoluta das mensagens.
create index if not exists messages_internal_author_idx
  on public.messages (conversation_id, created_by)
  where internal is true;
