# Agentes de IA — Pagamento → Pipeline (Design Spec)

> Módulo **Agentes de IA** do Lito CRM: um agente que lê cada pagamento novo da
> Guru, decide a qual contato do CRM ele pertence e move a oportunidade na
> fase certa do pipeline. Age sozinho quando tem certeza; pergunta quando não tem.
> Data: 2026-08-12. Convenções: `AGENTS.md`.

## Objetivo

Fechar o elo que hoje está solto: a Guru sabe quem pagou, o CRM sabe quem é
lead — e ninguém liga os dois. O agente passa a fazer isso: para cada
pagamento novo, encontra o contato correspondente **entre os contatos que já
existem no CRM**, encontra (ou cria) a oportunidade dele e a move para a fase
que o status do pagamento indica.

## Não-objetivos (v1)

- **Não cria contato.** Decisão do Gabriel: o agente **só vincula quando o
  contato já existe na aba Contatos do CRM**. Pagamento de alguém que não está
  na agenda é registrado como "sem contato no CRM" e ignorado — não vira contato
  novo, não vira card. Isso mantém o CRM como uma base curada em vez de um
  espelho dos 7.430 contatos da Guru.
- **Não faz backfill.** Só pagamentos que chegarem a partir de agora. As 24.139
  vendas históricas seguem apenas na aba Pagamentos.
- **Não mexe em contato.** O agente não edita nome, e-mail, telefone nem campos
  do contato. Só vincula e move oportunidade.
- **Não fecha venda perdida sozinho.** Mover para PERDIDO é sempre sugestão,
  nunca ação automática (ver "Matriz de decisão").
- **As outras abas do módulo continuam maquete** — Conversation AI, IA de voz,
  Base de Conhecimento, Content AI. Esta spec cobre só a primeira aba real.

## Decisões aprovadas (brainstorming)

1. **Vincular só a contato existente** — nunca criar contato a partir de pagamento.
2. **Híbrido** — casamento inequívoco o agente executa; ambíguo vira sugestão numa
   fila para um humano aprovar.
3. **LLM de verdade desde o início** — Claude decide o casamento e a ação, não uma
   tabela de regras. Sem provedor de IA no projeto hoje; entra agora.

## Por que LLM aqui (e onde ele não entra)

Vale ser explícito, porque metade deste fluxo **não** é problema de IA:

| Etapa | Quem faz | Por quê |
|---|---|---|
| Buscar candidatos (e-mail, CPF, telefone) | SQL determinístico | É índice, não julgamento. Rápido, grátis, auditável. |
| Decidir se o candidato **é a mesma pessoa** | **Claude** | "Abimael De Amorin Guimarães" (Guru) vs "Abimael Guimaraes" (CRM), e-mail pessoal vs corporativo, CPF só de um lado. Regra fixa erra nos dois sentidos. |
| Decidir **qual fase** o pagamento implica | **Claude** | Depende do status da Guru, do produto e de onde o card está hoje. Uma tabela status→fase quebra assim que surge produto ou fase nova. |
| Executar (mover card, gravar log) | Código determinístico | Efeito colateral no banco não se delega a modelo. |

Ou seja: o LLM ocupa a camada de julgamento — que é onde ele ganha de uma regra —
e fica fora da recuperação e da execução, onde regra ganha dele.

## Arquitetura

Espelha os três motores que já rodam (automações, marketing, sync da Guru), pelo
mesmo motivo: `pg_cron` no banco, execução em TypeScript na Vercel.

```
payment_events (INSERT/UPDATE)
        │  trigger private.enqueue_ai_run()
        ▼
  ai_agent_runs  ── pg_cron 1×/min ──▶ POST /api/agents/tick
        │                                      │
        │                    1. candidatos por e-mail/CPF/telefone (SQL)
        │                    2. zero candidatos → status "sem-contato", fim
        │                    3. ≥1 candidato   → Claude Opus 5 decide
        │                                      │
        ├──────────────── confiança alta ──────┤ executa: vincula + move fase
        └──────────────── confiança baixa ─────┘ grava ai_agent_suggestions
                                                        │
                                              aba Agentes de IA → aprovar/recusar
```

### Gatilho e fila

Migração `0024_ai_agents.sql` (próximo número livre — 0023 é Google Ads):

- `ai_agent_runs` — fila, mesmo shape de `automation_runs`: `status`
  (`pending|running|done|error|skipped`), `attempts`, `run_after`, `event_key`
  para idempotência, `payment_event_id`.
- `ai_agent_suggestions` — fila de aprovação: pagamento, contato sugerido, ação
  proposta, justificativa do modelo, confiança, `status`
  (`pending|approved|rejected`), quem decidiu e quando.
- `ai_agent_logs` — o que foi feito e por quê (auditoria; o motivo do modelo vai
  aqui em texto).
- Trigger em `payment_events` que enfileira só o que interessa: status
  classificado como `aprovado`, `reembolsado` ou `chargeback`. Pagamento pendente
  ou expirado não acorda o agente.
- RLS padrão membership nas três tabelas; escrita só pela service role.

### A decisão do modelo

Uma chamada por pagamento, `client.messages.create` com **structured output** —
o modelo é obrigado a responder no schema, então não há parsing frágil:

```ts
// src/lib/agents/decide.ts
const DECISION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["acao", "confianca", "motivo"],
  properties: {
    acao: { type: "string", enum: ["vincular-e-mover", "sugerir", "ignorar"] },
    contatoId: { type: ["string", "null"] },
    faseDestino: { type: ["string", "null"] },
    confianca: { type: "string", enum: ["alta", "media", "baixa"] },
    motivo: { type: "string" },   // texto curto, aparece no log e na fila
  },
} as const;

const res = await client.messages.create({
  model: "claude-opus-5",
  max_tokens: 4000,               // cobre thinking + resposta (ver nota abaixo)
  output_config: {
    effort: "low",                // decisão pequena e repetitiva
    format: { type: "json_schema", schema: DECISION_SCHEMA },
  },
  system: SYSTEM,                 // regras do negócio + fases reais do pipeline
  messages: [{ role: "user", content: JSON.stringify({ pagamento, candidatos, pipeline }) }],
});
```

Detalhes que vão morder se esquecidos:

- **Pensamento vem ligado por padrão no Opus 5** e `max_tokens` limita
  *pensamento + resposta juntos*. Um `max_tokens` apertado trunca no meio. Daí
  os 4000 para um JSON de ~100 tokens.
- **`effort: "low"`** — a decisão é pequena, repetitiva e tem candidatos já
  filtrados. Nível baixo no Opus 5 rende bem e é o principal controle de custo.
- **Sem `temperature`/`top_p`** — o Opus 5 rejeita esses parâmetros (400).
- O modelo **nunca recebe a base inteira** — só o pagamento e os poucos
  candidatos que o SQL trouxe. Isso limita custo, latência e superfície de erro.

### Matriz de decisão

O prompt fixa estas regras; o modelo aplica julgamento **dentro** delas:

| Situação | Ação |
|---|---|
| E-mail idêntico ao de um contato | vincular e mover — sozinho |
| CPF idêntico, e-mail diferente | vincular e mover — sozinho |
| Só nome parecido, sem e-mail/CPF batendo | **sugerir** — humano aprova |
| Mais de um candidato plausível | **sugerir**, listando qual e por quê |
| Nenhum candidato | ignorar, registrar "sem contato no CRM" |
| Venda aprovada | mover para a fase de ganho (hoje `ASSINOU`) |
| Reembolso / chargeback | **sugerir** mover para `PERDIDO` — nunca sozinho |

A fase de ganho não fica escrita no código: o prompt recebe as fases reais do
pipeline (`NOVO LEAD → NEGOCIANDO → QUENTE 🔥 → ASSINOU → PERDIDO`) e o modelo
escolhe entre elas. Renomear uma fase não quebra o agente.

### Execução

Reaproveita o que já existe — nada de caminho de escrita novo:

- `oppActions` (`db/pipeline.ts`) para criar/mover oportunidade.
- Se o contato existe mas **não tem oportunidade**, o agente cria uma. Isso não
  contradiz "não criar contato": a restrição é sobre a agenda de contatos; um
  contato que já está no CRM e acabou de pagar precisa de um card para o
  pipeline significar alguma coisa. Fica explícito no log.
- Toda ação vira linha em `ai_agent_logs`, com o `motivo` que o modelo deu.

## UI — aba Agentes de IA

A primeira aba do módulo deixa de ser maquete e passa a ser o painel do agente:

- **Cabeçalho**: liga/desliga o agente; badge "Ao vivo".
- **KPIs**: pagamentos processados, vinculados automaticamente, aguardando
  aprovação, sem contato no CRM.
- **Fila de aprovação** — o coração da tela: cada sugestão mostra o pagamento
  (valor, produto, data), o contato sugerido, a ação proposta, a **justificativa
  do modelo** e dois botões (Aprovar / Recusar). Aprovar executa; recusar só
  arquiva.
- **Histórico**: as últimas execuções automáticas, com motivo, para auditoria.

As demais abas seguem como estão.

## Custo

Uma chamada curta por pagamento **que tenha candidato no CRM**. Com 10 contatos
hoje, é um filete. Se a base de contatos crescer para milhares, ainda são
centenas de chamadas de ~1–2k tokens por mês em `effort: "low"` — ordem de
grandeza de poucos dólares. O gargalo de custo nunca é o modelo aqui; é ligar o
agente a uma base grande sem a etapa de candidatos, que esta arquitetura evita
por construção.

## Env

`ANTHROPIC_API_KEY` — privada, na Vercel (production+preview+development) e no
`.env.local`; placeholder no `.env.example`. `AI_AGENT_SECRET` para proteger
`/api/agents/tick` (mesmo padrão de `AUTOMATION_SECRET`/`GURU_SYNC_SECRET`),
guardado em `private.ai_agent_config` e nunca em SQL versionado.

## Riscos

| Risco | Mitigação |
|---|---|
| Vínculo errado entra silencioso no pipeline | Só e-mail/CPF exato é automático; o resto passa por humano |
| Modelo "alucina" um contactId | O schema restringe, e a rota **valida** que o id veio da lista de candidatos antes de executar |
| Agente fica sem o que fazer (10 contatos) | Esperado no início — os KPIs mostram "sem contato no CRM", que é justamente o dado para decidir se vale importar contatos da Guru |
| Custo escapar | `effort: "low"`, candidatos pré-filtrados, e o agente pode ser desligado pela UI ou pelo `cron.unschedule` |

## Como pausar

```sql
select cron.unschedule('lito-ai-agent-tick');
select * from public.ai_agent_runs order by created_at desc limit 20;
```
