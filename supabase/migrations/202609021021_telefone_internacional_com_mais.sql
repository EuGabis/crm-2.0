-- Lito CRM — telefone de contato estrangeiro ganha o "+" que nunca teve
--
-- Erro relatado em 02/09/2026: template falhando com **#131026 Message
-- Undeliverable**. Não era a conta (o #131042 de cobrança, do dia anterior, é
-- outro problema e já foi resolvido): o CRM estava enviando para números
-- INEXISTENTES.
--
-- ⚠️ **A causa é o "+" que se perde no webhook.** O `from` da Meta é o número
-- internacional COMPLETO, só sem o "+", e era gravado cru em `contacts.phone`.
-- Sem o "+", `toWhatsAppNumber` tentava adivinhar o país pelos dois primeiros
-- dígitos — e vários códigos de país COLIDEM com DDD brasileiro. Medido no
-- banco:
--
--   61412914627  (+61 412 914 627, Austrália) -> 5561412914627   "61" = DF
--   15149635422  (+1 514 963 5422, Canadá)    -> 5515149635422   "15" = Sorocaba
--   16472895906  (+1 647 289 5906, Canadá)    -> 5516472895906   "16" = Ribeirão
--
-- Os três contatos ESCREVERAM para nós (a entrada funciona, porque quem resolve
-- o número é a Meta) e nenhum jamais recebeu resposta. Era isso que fazia o
-- problema parecer da conta em vez de nosso.
--
-- O código já foi corrigido em duas frentes: o webhook passa a gravar com "+", e
-- `toWhatsAppNumber` exige FORMA de número brasileiro (celular com 9, fixo com
-- 2–5) e não só um DDD plausível. Esta migração cuida do que já está gravado.

/*
 * ⚠️ **Critério ESTREITO: só contato que já nos ESCREVEU.**
 *
 * Se existe mensagem de ENTRADA, o telefone veio do `from` da Meta e é
 * comprovadamente o número internacional completo — não é suposição. Contato
 * digitado à mão ou vindo da importação não entra: ali um número de 11 dígitos
 * pode genuinamente ser brasileiro sem o 55, e carimbar "+" nele criaria o
 * defeito INVERSO, mandando "+11 9xxxx" para o nada.
 *
 * Também exige `left(d,2) <> '55'`: número brasileiro já com o país está certo
 * como está, e o "+" ali não muda nada nem estraga — mas mexer no que está certo
 * é risco sem ganho.
 */
update public.contacts c
   set phone = '+' || regexp_replace(c.phone, '\D', '', 'g')
 where coalesce(c.phone, '') <> ''
   and c.phone not like '+%'
   and length(regexp_replace(c.phone, '\D', '', 'g')) between 10 and 15
   and left(regexp_replace(c.phone, '\D', '', 'g'), 2) <> '55'
   and exists (
     select 1
       from public.messages m
       join public.conversations cv on cv.id = m.conversation_id
      where cv.contact_id = c.id
        and m.direction = 'in'
   );

/*
 * ⚠️ **O dedupe por telefone NÃO é afetado.** `private.phone_key` (0047) faz
 * `regexp_replace(raw, '\D', '', 'g')` antes de qualquer coisa, então o "+" some
 * no cálculo da chave e nenhum contato passa a ser visto como novo.
 *
 * ⏳ O que esta migração NÃO resolve, de propósito: os 10 dígitos genuinamente
 * ambíguos, que são ao mesmo tempo fixo brasileiro plausível e internacional
 * plausível (`9549373665` = "(95) 4937-3665" ou "+1 954 937 3665"). Se o contato
 * nunca escreveu, não há como decidir pelos dígitos, e chutar seria trocar um
 * número errado por outro. Para esses, a correção é alguém salvar com o "+".
 *
 * Para conferir o que ficou de fora e pode precisar de ajuste à mão:
 *
 *   select c.id, c.first_name, c.phone
 *     from public.contacts c
 *    where c.phone not like '+%'
 *      and length(regexp_replace(c.phone,'\D','','g')) in (10,11)
 *      and left(regexp_replace(c.phone,'\D','','g'),2) <> '55'
 *      and not (length(regexp_replace(c.phone,'\D','','g')) = 11
 *               and substr(regexp_replace(c.phone,'\D','','g'),3,1) = '9')
 *      and not (length(regexp_replace(c.phone,'\D','','g')) = 10
 *               and substr(regexp_replace(c.phone,'\D','','g'),3,1) between '2' and '5');
 */
