-- Lito CRM — admin deixa de ser "proprietário" de contato
--
-- O cadastro do contato mostrava "Proprietário: <admin>" em 40.964 contatos que
-- ele nunca atendeu. A causa: a rota de importação carimbava
-- `owner_id = quem importou`, e foram os admins que carregaram a base do CRM
-- antigo (32.017 de um, 8.947 do outro). Corrigido na rota — carga de base não
-- define proprietário.
--
-- ⚠️ **Verificado antes de rodar que zerar isto NÃO muda visibilidade.** Era a
-- dúvida que travou essa limpeza antes, e a resposta está nas policies de
-- `contacts`:
--   - SELECT: `location_id in private.user_locations()` — NÃO usa `owner_id`.
--     Todo membro já via todos os contatos da empresa; nada muda.
--   - DELETE: `private.sees_all(location_id) or owner_id = auth.uid()`.
--     Os três admins têm `only_assigned = false`, então `sees_all` é true e eles
--     continuam podendo excluir. Alberto, Paulo e Rogerio (os únicos com
--     `only_assigned = true`) já não podiam excluir estes contatos, porque o dono
--     era o admin — para eles também nada muda.
--   - INSERT/UPDATE: só olham `location_id`.
--
-- ⚠️ Só ADMIN é limpo. `owner_id` de atendente é atribuição real de trabalho:
-- Cibelle tem 187 contatos, Alberto 15 — zerar isso tiraria deles o direito de
-- excluir os próprios contatos (a policy de DELETE acima) e apagaria informação
-- de quem cuida de quem.
update public.contacts ct
   set owner_id = null
 where ct.owner_id is not null
   and exists (
     select 1 from public.location_members m
      where m.user_id = ct.owner_id
        and m.location_id = ct.location_id
        and m.role = 'admin'
   );
