-- Quem FINALIZOU uma conversa continua lendo essa conversa.
--
-- Relato (2026-09-23): "Finalizadas" + "Atribuídas a mim" não traz nada.
-- `finish_conversation` (0092) grava `assigned_to = null` — de propósito: a
-- conversa reaberta volta sem dono e é triada de novo. Medido: 1.309 das 1.311
-- finalizadas estão sem dono. Para quem tem `only_assigned` (os vendedores), a
-- RLS da 0074 só entrega a conversa atribuída a ele, então o que ele mesmo
-- finalizou SUMIA da caixa na hora — não havia lista de "minhas finalizadas".
--
-- ⚠️ Policy NOVA e só de LEITURA, somada às existentes (permissivas fazem OR).
-- As policies da 0074 não são tocadas: nada de UPDATE/INSERT muda, então quem
-- lê a finalizada não passa a responder por ela.
-- ⚠️ Estreita por construção: `closed_by` é zerado quando a conversa reabre
-- (`conversationActions.close(id,false)` e a mensagem de entrada do webhook),
-- então reaberta e reatribuída a outro, ela deixa de ser lida por quem a
-- finalizou antes.

begin;

drop policy if exists "quem finalizou le" on public.conversations;
create policy "quem finalizou le" on public.conversations
  for select to authenticated
  using (
    closed_by = auth.uid()
    and location_id in (select private.user_locations())
  );

drop policy if exists "quem finalizou le" on public.messages;
create policy "quem finalizou le" on public.messages
  for select to authenticated
  using (
    location_id in (select private.user_locations())
    and conversation_id in (
      select c.id from public.conversations c where c.closed_by = auth.uid()
    )
  );

commit;
