# Detalhe do lead — spec de design

**Data:** 2026-08-17
**Módulo:** Leads (`/leads`), com dados de Contatos, Pagamentos (Guru) e Conversas
**Migração:** `0048_lead_detalhe_cruzamento.sql`

## Problema

O card do funil mostra nome, fonte e valor. Para saber quem é a pessoa, o
vendedor abria Contatos; para saber se ela já compra, abria Pagamentos e
procurava pelo nome; os comentários combinados ficavam em Conversas. Três telas
para responder "vale ligar para esse lead agora?".

## O que passa a existir

Clicar no card (ou na linha, na vista lista) abre **Detalhe do lead**, com três
abas:

1. **Resumo** — dados do contato (incluindo o CPF/CNPJ novo), dados do lead
   (funil, fase, valor, fonte, status, responsável), os outros leads do mesmo
   contato, tarefas e compromissos.
2. **Pagamentos** — o histórico do MESMO comprador na Guru: KPIs (total
   aprovado, nº de vendas, assinaturas ativas, reembolsos), o cadastro que a
   Guru tem dele, a lista de vendas e a de assinaturas. Só aparece para quem
   enxerga o módulo Pagamentos (`useMyMembership().can("pagamentos")`, o mesmo
   guard da sidebar).
3. **Comentários** — as notas internas do contato, e um campo para escrever
   outra.

## Cruzamento CRM ↔ Guru

Contato do CRM e comprador da Guru são cadastros independentes. Ordem de
casamento, da chave mais forte para a mais fraca:

| # | Chave | Por quê |
|---|-------|---------|
| 1 | **CPF/CNPJ** | documento é único por pessoa — é a chave principal |
| 2 | **Telefone** | quando o documento não bate ou o contato não tem documento |
| 3 | **E-mail** | complemento |
| 4 | **Nome** | último recurso; homônimo existe |

A **primeira chave que encontra algo ganha**, e a tela mostra qual foi ("Casado
por CPF/CNPJ"). Quando o casamento sai pelo nome, a aba avisa que a chave é
fraca. Sem esse rótulo, "achei o cliente" e "achei alguém com nome parecido"
seriam indistinguíveis na tela.

Quando nada casa, o vazio diz **quais chaves foram tentadas** e sugere preencher
o CPF — em vez de dar a entender que o cliente nunca comprou.

## Decisões de implementação

**A cascata roda no banco.** `public.lead_payment_profile(location, doc, phone,
email, name, limit)` devolve `{match_key, guru_contact, sales, subscriptions,
totals}` numa chamada. No client, cada passo seria uma ida e volta e o rótulo
("casou por telefone") poderia vir de uma consulta enquanto as vendas vinham de
outra — chave inconsistente com os dados ao lado.

**A função é `stable` e SEM `security definer`.** A RLS de membership de
`payment_events`/`payment_subscriptions`/`payment_guru_contacts` continua valendo
para quem chama; passar outro `p_location` não lê pagamento de outra empresa.

**Nada de coluna nova nas tabelas de pagamento.** Documento e telefone do
comprador não existem como coluna (0008/0012), mas estão em `raw->'contact'` em
100% das linhas (conferido: 24.832/24.832 vendas, 2.453/2.453 assinaturas).
Criar colunas exigiria backfill, reescrita de tabela e mais um lugar para o
mapeamento da Guru esquecer de preencher. A migração indexa a **expressão** que
lê do `raw` — e `raw` é a fonte de verdade declarada desde a 0008. Medido:
0,2 ms por busca indexada; ~20 ms a chamada completa.

**`private.phone_key` é reusada como está** (migração 0047, do trabalho de
deduplicação por telefone): dígitos, sem o 55, ignorando o 9º dígito de celular.
Telefone normalizado tem que significar a mesma coisa nos dois lugares. O
documento ganhou a irmã `private.doc_key` (só dígitos), porque o CRM recebe
"123.456.789-00" digitado à mão e a Guru devolve "12345678900".

**`contacts.doc` é coluna de primeira classe**, não campo personalizado: é a
chave principal do cruzamento e precisa de índice. Aparece no cadastro de
contato e no detalhe do contato.

**Comentário continua sendo mensagem interna da conversa.** É onde a nota já é
gravada (ação `nota-interna` das automações, botão "Nota" do card). Uma tabela
nova de comentários faria a nota escrita num lugar não aparecer no outro. A
listagem usa consulta própria e enxuta — o store de Conversas carrega todas as
mensagens da empresa, caro demais para abrir um card.

**Totais somam o histórico inteiro**, não o array de vendas exibido (limitado a
200). Somar a página daria um número convincente e errado para quem compra
muito.

**Clique vs. arrastar.** O corpo do card é o punho do arrasto. O `PointerSensor`
só começa a arrastar depois de 6 px, mas o `click` do navegador dispara mesmo
depois de um arrasto que voltou para perto do início — por isso o card guarda
onde o ponteiro desceu e só abre o detalhe se soltou a menos de 6 px de lá.

## Fora desta versão

- Editar o lead (valor, fase, nome) de dentro do detalhe — continua no card e no
  diálogo de oportunidade.
- Ver o payload cru da venda (existe na aba Vendas de Pagamentos).
- Casar um lead à mão com um comprador da Guru quando as quatro chaves falham.
