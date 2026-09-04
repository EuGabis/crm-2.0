-- Lito CRM — remove a `relatorio_triagem_diaria`, substituída pela `triagem_leads`
--
-- ⚠️ **APLICAR SÓ DEPOIS DO MERGE** do PR que troca a rota para `triagem_leads`
-- (a 202609041015 é a parte aditiva e pode ir antes).
--
-- Motivo de estar num arquivo separado: neste projeto **o código chega à
-- produção ANTES da migração** (deploy automático no merge, migração aplicada à
-- mão). Removendo a função antiga junto com a criação da nova, existe uma janela
-- em que o código no ar chama uma função que já não existe — foi o que eu fiz em
-- 03/09, e a aba "Leads do dia" ficou respondendo erro até o merge sair.
--
-- Com o `drop` separado, a produção nunca fica sem uma função válida: antes do
-- merge existem as duas, depois do merge sobra a nova.
--
-- Por que remover em vez de deixar: a `relatorio_triagem_diaria` agrega por dia
-- com um predicado de "entrou" COPIADO do que a `triagem_leads` faz agora.
-- Mantê-la seria manter duas definições de "lead" na mesma tela para
-- divergirem — e a de ontem já teve um defeito nessa exata lógica (o desfecho
-- contado no dia do evento em vez do dia de entrada).

drop function if exists public.relatorio_triagem_diaria(uuid, date, date, text);

notify pgrst, 'reload schema';
