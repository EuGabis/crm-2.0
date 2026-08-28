-- Lito CRM — rodízio respeita presença + devolve conversa parada
--
-- Relato do Gabriel (2026-08-28): na Secretaria, a atendente Jenifer Martins
-- estava OFFLINE (começa 12h) e o bot moveu várias conversas para ela. Os outros
-- atendentes do setor não receberam esses contatos e a fila de espera dos alunos
-- ficou muito alta.
--
-- Decisão dele, ao ser perguntado: "quando a Jenifer não estiver online, as
-- conversas devem ser distribuídas [para os outros]".
--
-- ⚠️ **A causa é o flag `rodizio_offline`, que ELE MESMO pediu na 0083.** Naquela
-- migração o pedido foi o oposto: "na Secretaria o rodízio deve distribuir para
-- todos do pool mesmo que estejam offline". Com o flag ligado,
-- `distributeOne` usa o pool INTEIRO e ignora presença — então a Jenifer recebe
-- a fatia dela do rodízio às 5h da manhã.
--
-- Esta migração REVERTE esse ajuste, e está dito assim de propósito: é uma
-- reversão de decisão anterior, não a correção de um bug do outro Claude.

-- ---------- 1. Volta a respeitar presença ----------
-- Só onde está ligado; `where` estreito para não escrever em linha que já está
-- no valor certo.
update public.departments
   set rodizio_offline = false
 where rodizio_offline is true;

-- ---------- 2. Devolver conversa parada ----------
--
-- ⚠️ Respeitar presença sozinho NÃO resolve o problema inteiro, e é por isso que
-- esta coluna existe. Casos que continuariam furados:
--   - a pessoa está online mas saiu para almoçar, entrou em reunião, ou
--     simplesmente não viu a conversa;
--   - ninguém online no momento em que a conversa cai (madrugada): a conversa
--     fica aguardando, e nada garante que alguém vá olhar a fila do setor.
--
-- Então: conversa ATRIBUÍDA cujo aluno está esperando há mais de N minutos ÚTEIS
-- sem resposta humana volta para o rodízio e é redistribuída na hora (escolha do
-- Gabriel: "redistribui na hora", em vez de devolver para a caixa do grupo, que
-- depende de alguém ficar olhando).
--
-- ⚠️ O relógio é a ESPERA DO ALUNO (última mensagem de entrada sem resposta), e
-- não "quanto tempo faz que foi atribuída". Não há coluna `assigned_at`, mas mais
-- importante: o que o Gabriel reclamou foi a FILA DE ESPERA. Medir a espera do
-- aluno é medir exatamente a queixa.
--
-- 0 = desligado. Default 15 minutos, a mesma meta de primeira resposta que a
-- análise de SLA (0079) já usa — duas réguas diferentes para a mesma coisa só
-- gerariam discussão sobre qual vale.
alter table public.departments
  add column if not exists devolver_apos_min int not null default 15;

comment on column public.departments.devolver_apos_min is
  'Minutos de espera do aluno sem resposta humana antes de a conversa voltar ao rodízio. 0 = desligado.';
