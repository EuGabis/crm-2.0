-- Lito CRM — as 5 saudações fixas viram respostas rápidas de verdade
--
-- O composer tinha DOIS menus, os dois chamados "Respostas rápidas":
--   * o do ícone de raio, com 5 frases FIXAS NO CÓDIGO (`QUICK_REPLIES`) — não
--     dava para editar, acrescentar nem remover;
--   * o botão "Trechos", que lê `public.snippets` (migração 0003) e é editável.
--
-- Duas listas com o mesmo nome, uma editável e a outra não, é o tipo de coisa
-- que faz o usuário pedir "quero editar as respostas rápidas" olhando justamente
-- para a que não dá.
--
-- A lista fixa sai do código e o CRM passa a ter UMA fonte: `snippets`. Esta
-- migração move as 5 frases para lá, para que ninguém perca o que já usava — e
-- agora elas podem ser editadas e apagadas como qualquer outra.
--
-- ⚠️ Idempotente por (location_id, name): rodar de novo não duplica. É o único
-- jeito seguro, já que `snippets` não tem restrição de unicidade e a tabela
-- é editada pela tela — reexecutar não pode encher a lista de repetidas.

insert into public.snippets (location_id, name, content)
select l.id, v.name, v.content
  from public.locations l
  cross join (values
    ('Saudação',            'Olá! Tudo bem? 👋'),
    ('Agradecer contato',   'Obrigado pelo contato! Em que posso ajudar?'),
    ('Pedir um momento',    'Só um momento, já verifico isso pra você.'),
    ('Dar andamento',       'Perfeito! Vou dar andamento.'),
    ('Encerrar à disposição','Qualquer dúvida, estou à disposição. 😊')
  ) as v(name, content)
 where not exists (
   select 1 from public.snippets s
    where s.location_id = l.id and s.name = v.name
 );

/*
 * ⚠️ Os NOMES são novos, e isso é escolha, não descuido. No código as frases
 * eram anônimas (o menu mostrava o texto inteiro); `snippets` tem nome e
 * conteúdo, e o menu mostra o nome em negrito com a prévia embaixo. Sem um nome
 * curto, o menu de respostas rápidas viraria cinco parágrafos empilhados —
 * exatamente o que a lista de trechos de curso já evita.
 */
