# Agente de IA — pasta de trabalho

Ponto de entrada do módulo **Agentes de IA**. Material de referência e decisões
ficam aqui; os documentos formais seguem a convenção do repo (`specs/` e
`plans/`) e estão linkados abaixo.

## O que é

Um agente que fecha o elo entre pagamento e pipeline: a cada pagamento novo da
Guru, encontra o contato correspondente **entre os que já existem no CRM** e
move a oportunidade dele para a fase certa. Age sozinho quando o casamento é
inequívoco; manda para uma fila de aprovação quando não é.

## Status

| | |
|---|---|
| Spec | ✅ escrita e aprovada em 12/08/2026 |
| Plano | ✅ 7 tarefas definidas |
| Código | ⬜ não começou |
| Bloqueio | **Chave da Anthropic** — não há provedor de IA no projeto ainda |

## Documentos

- **Spec (o desenho):** [`docs/superpowers/specs/2026-08-12-agentes-ia-pagamentos-design.md`](../superpowers/specs/2026-08-12-agentes-ia-pagamentos-design.md)
- **Plano (as 7 tarefas):** [`docs/superpowers/plans/2026-08-12-agentes-ia-pagamentos.md`](../superpowers/plans/2026-08-12-agentes-ia-pagamentos.md)

## Decisões tomadas (12/08/2026)

Três escolhas do Gabriel que definem a arquitetura. Mudar qualquer uma delas
muda o desenho — por isso ficam registradas aqui, com o porquê:

1. **Nunca criar contato.** O agente só vincula a quem já está na aba Contatos.
   Pagamento de desconhecido é registrado como "sem contato no CRM" e ignorado.
   *Motivo:* manter o CRM como base curada, não um espelho dos 7.430 contatos da
   Guru.

2. **Híbrido.** E-mail ou CPF idêntico → o agente executa sozinho. Só nome
   parecido, ou mais de um candidato → vira sugestão para um humano aprovar.
   *Motivo:* erro de casamento entrando silencioso no pipeline é caro de
   descobrir depois.

3. **LLM de verdade (Claude Opus 5).** O modelo decide o casamento e a fase; a
   busca de candidatos e a execução no banco continuam determinísticas.
   *Motivo:* regra fixa erra nos dois sentidos com variação de nome e e-mail;
   mas recuperação e escrita não se delegam a modelo.

## Ponto em aberto

**O agente cria oportunidade?** Sim, no desenho atual: se o contato já está no
CRM e acabou de pagar mas não tem nenhum card, o agente cria um — senão não há
o que mover e o recurso não faz nada. Entendi a regra nº 1 como sendo sobre não
inflar a *agenda de contatos*, não sobre impedir cards. **Se a intenção for
também não criar oportunidade, é ajuste de uma linha** — confirmar antes da
Tarefa 5.

## Contexto que explica o módulo

O número que motiva tudo isto: hoje o CRM tem **10 contatos e 1 oportunidade**,
enquanto a Guru tem **7.430 contatos e 24 mil vendas**. Os módulos funcionam,
mas as duas bases não se falam. O agente é a ponte — e o KPI "sem contato no
CRM" da tela vira a medida de quanto valeria importar contatos da Guru, que é
uma decisão de negócio ainda em aberto.

## Para retomar

1. Provisionar `ANTHROPIC_API_KEY` (Vercel + `.env.local`).
2. Abrir o plano e começar pela Tarefa 1+2 (SDK + migração 0024).
3. Antes de criar a migração: `git pull` e confirmar que 0024 ainda está livre —
   o outro Claude também cria migrações.
