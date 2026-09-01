-- Lito CRM — o bot passa a VALIDAR o e-mail antes de guardar
--
-- Medido neste banco em 01/09/2026: o nó `ask` só validava `name`, e todo o
-- resto caía num `vars[node.var] = args.text` que gravava a resposta CRUA. O
-- resultado é lixo indo para o lead e para a base de contatos, porque o bot
-- trata QUALQUER mensagem como resposta à pergunta atual — cliente que pergunta
-- em vez de responder tem a pergunta dele gravada no campo:
--
--   email = 'Será do dia 14.10 ate dia 21.10, o ideal seria eu fazer a visita…'
--   email = 'Usmetzket9@gmail. Com'
--   curso = 'Muito obrigado novamente Beatriz'
--
-- ⚠️ **O fluxo que VALE é o do banco.** `getFlow` lê `bot_flows.definition` e só
-- cai no padrão em código quando não acha a linha. Marcar `validate` apenas no
-- TypeScript não teria efeito nenhum em produção — é por isto que esta migração
-- existe.

-- ── E-mail puro: triagem da secretaria ──────────────────────────────────────
--
-- `jsonb_set` no caminho do nó. Idempotente por natureza (reescrever o mesmo
-- valor não muda nada) e não toca em nenhum outro nó do fluxo, que é editável
-- pela tela do construtor de bot (0055).
update public.bot_flows
   set definition = jsonb_set(
         definition,
         '{nodes,pede_email,validate}',
         '"email"'::jsonb,
         true            -- cria a chave se não existir
       ),
       updated_at = now()
 where definition -> 'nodes' -> 'pede_email' is not null
   and coalesce(definition -> 'nodes' -> 'pede_email' ->> 'validate', '') <> 'email';

-- ── E-mail OU documento: nó do financeiro ───────────────────────────────────
--
-- ⚠️ Este nó pergunta "e-mail **ou** CPF" (var `email_cpf`). Validador estrito de
-- e-mail recusaria o CPF e travaria a triagem de quem respondeu certo — daí o
-- modo `email_ou_doc`, que aceita os dois.
update public.bot_flows
   set definition = jsonb_set(
         definition,
         '{nodes,fin_pede_doc,validate}',
         '"email_ou_doc"'::jsonb,
         true
       ),
       updated_at = now()
 where definition -> 'nodes' -> 'fin_pede_doc' is not null
   and coalesce(definition -> 'nodes' -> 'fin_pede_doc' ->> 'validate', '') <> 'email_ou_doc';

/*
 * ⚠️ **O lixo JÁ GRAVADO não é apagado aqui.**
 *
 * `bot_sessions.vars` é o rascunho da triagem em curso, e `contacts.email` pode
 * ter sido corrigido à mão pelo atendente depois. Um `update` em massa por
 * heurística ("não tem @, então limpa") apagaria correção humana junto — e
 * apagar dado de contato é irreversível.
 *
 * Para VER o que ficou torto (é curto, dá para corrigir a olho):
 *
 *   select c.id, c.first_name, c.last_name, c.email
 *     from public.contacts c
 *    where coalesce(c.email,'') <> ''
 *      and c.email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[A-Za-z]{2,}$'
 *    order by c.updated_at desc;
 */
