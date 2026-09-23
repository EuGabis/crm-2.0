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

-- 🔴 NÃO criar a irmã em `messages`. Ela existiu por ~20 min em 2026-09-23 e
-- DERRUBOU o CRM (43% de 5xx no Data API, ~220 statement timeouts/minuto): o
-- `conversation_id in (select ... from conversations ...)` roda a RLS pesada de
-- `conversations` (sees_all, channel_allowed, conv_with_bot por linha) sobre as
-- 8 mil conversas A CADA leitura de mensagens. Removida à mão no SQL Editor.
-- Se o conteúdo da finalizada tiver de ser lido por quem finalizou, o caminho é
-- uma função `security definer` barata (como `private.conv_assigned_to_me`),
-- não um subselect sob RLS dentro da policy.
drop policy if exists "quem finalizou le" on public.messages;

commit;
