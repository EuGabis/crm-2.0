-- Lito CRM — devolve para a fila os leads que caíram na caixa de um admin
--
-- Causa (corrigida no webhook): `contacts.owner_id` guarda quem INSERIU o
-- contato, e a importação do CRM antigo deixou um admin como dono de 32 mil
-- contatos. O webhook tratava "dono do contato" como "atendente responsável",
-- então cada um desses contatos que mandasse mensagem caía direto na caixa do
-- admin — com `bot_paused`, de modo que nem o bot atendia nem o rodízio
-- distribuía. O lead ficava parado.
--
-- Esta migração conserta o que já aconteceu.

-- ⚠️ Critério ESTREITO, de propósito. Só entra a conversa que reúne as três
-- condições, porque cada uma descarta um caso legítimo:
--   1. atribuída a um ADMIN e o dono do contato é esse mesmo admin — a assinatura
--      exata do bug;
--   2. NENHUM evento na conversa — evento significa que alguém assumiu ou
--      transferiu à mão, e essa decisão humana não deve ser desfeita;
--   3. NENHUMA resposta humana — se já respondeu, o atendimento começou; tirar a
--      conversa de quem está atendendo seria pior que o bug.
--
-- `bot_paused` continua TRUE de propósito: liberar o bot agora faria ele mandar
-- mensagem automática para clientes que escreveram horas atrás, o que é uma
-- ação externa inesperada. A conversa fica na fila para uma PESSOA assumir.
update public.conversations c
   set assigned_to = null,
       awaiting_distribution = true
 where c.assigned_to is not null
   and exists (
     select 1 from public.location_members m
      where m.user_id = c.assigned_to
        and m.location_id = c.location_id
        and m.role = 'admin'
   )
   and exists (
     select 1 from public.contacts ct
      where ct.id = c.contact_id
        and ct.owner_id = c.assigned_to
   )
   and not exists (
     select 1 from public.messages m
      where m.conversation_id = c.id and m.type = 'event'
   )
   and not exists (
     select 1 from public.messages m
      where m.conversation_id = c.id
        and m.direction = 'out'
        and coalesce(m.internal, false) = false
        and coalesce(m.automated, false) = false
   );
