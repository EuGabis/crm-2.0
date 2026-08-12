# Agentes de IA — Pagamento → Pipeline (Plano)

> Implementação da spec `docs/superpowers/specs/2026-08-12-agentes-ia-pagamentos-design.md`.
> 7 tarefas. Cada uma vira um PR pequeno na `main`, na ordem.

## Tarefa 1 — Provedor de IA no projeto

Não existe nenhuma infra de IA hoje (sem chave, sem SDK).

- `npm i @anthropic-ai/sdk` — **arquivo de alta colisão** (`package.json`,
  `package-lock.json`): `git pull --rebase` imediatamente antes do push.
- `src/lib/ai/client.ts` — cliente compartilhado; lança se `ANTHROPIC_API_KEY`
  faltar (mesmo padrão de `supabase/admin.ts`).
- `ANTHROPIC_API_KEY` e `AI_AGENT_SECRET` no `.env.example` (placeholder), na
  Vercel e no `.env.local`.
- Nota nova em `AGENTS.md` (edição **aditiva**, arquivo de alta colisão).

**Pronto quando:** uma chamada de teste ao `claude-opus-5` responde localmente.

## Tarefa 2 — Migração 0024

`supabase/migrations/0024_ai_agents.sql` (0023 é Google Ads; confirmar com
`git pull` que 0024 segue livre antes de criar).

- `ai_agent_runs`, `ai_agent_suggestions`, `ai_agent_logs` — colunas conforme a
  spec; RLS padrão membership; `revoke all ... from anon`.
- `private.enqueue_ai_run()` + trigger em `payment_events`, filtrando por status
  (`aprovado`/`reembolsado`/`chargeback`) e com idempotência por `event_key`.
- `private.ai_agent_config` guardando `tick_url` + `secret` — segredo real setado
  à mão no SQL Editor, **nunca** no arquivo versionado.
- Idempotente (`create ... if not exists`, `drop policy if exists`).

**Pronto quando:** aplicada via SQL Editor; um INSERT em `payment_events`
enfileira uma linha em `ai_agent_runs`.

## Tarefa 3 — Busca de candidatos (determinística)

`src/lib/agents/candidates.ts` — dado um `payment_event`, retorna os contatos do
CRM que podem ser a mesma pessoa:

- e-mail exato (`lower(trim(...))`), CPF (campo personalizado ou `doc`), telefone
  normalizado (só dígitos, ignorando DDI/9º dígito).
- Teto de 5 candidatos; nunca varre a base inteira.
- Índices necessários na própria 0024 se faltarem.

**Pronto quando:** teste com os 3 contatos que hoje casam com pagamentos retorna
o candidato certo; um pagamento sem contato retorna lista vazia.

## Tarefa 4 — A decisão (Claude)

`src/lib/agents/decide.ts` — uma chamada, structured output, conforme a spec.

- `claude-opus-5`, `effort: "low"`, `max_tokens: 4000` (pensamento vem ligado por
  padrão e divide o mesmo teto).
- Sem `temperature`/`top_p` (o Opus 5 rejeita).
- System prompt com as regras da matriz de decisão + as fases reais do pipeline
  carregadas do banco.
- **Validação de saída**: se `contatoId` não estiver na lista de candidatos que
  mandamos, descartar a decisão e cair para `sugerir`. O schema restringe o
  formato, não a veracidade.
- Tratar `stop_reason: "refusal"` antes de ler o conteúdo.

**Pronto quando:** casos de teste (e-mail exato, só nome parecido, dois
candidatos, reembolso) produzem a ação esperada.

## Tarefa 5 — Motor + rota

- `src/lib/agents/engine.ts` — `processDueRuns()`: claim do run por update
  condicional (dois ticks não pegam o mesmo run), candidatos → decisão →
  executa ou enfileira sugestão → log. Backoff `[1, 5, 15]` min.
- `src/app/api/agents/tick/route.ts` — POST protegido por `x-ai-agent-secret`.
- **`src/proxy.ts`: incluir `api/agents` na lista de rotas fora do matcher** —
  chamada máquina-a-máquina, sem sessão; sem isso o middleware devolve 307.
  Arquivo de alta colisão: edição aditiva + `git pull --rebase` antes do push.
- Execução via `oppActions` existente; cria oportunidade se o contato não tiver.

**Pronto quando:** sem header → 401; com header → 200 e a fila anda.

## Tarefa 6 — UI da aba

`src/app/(app)/agentes-ia/page.tsx` — primeira aba deixa de ser maquete:

- KPIs (processados, vinculados, aguardando, sem contato no CRM).
- **Fila de aprovação** com pagamento, contato sugerido, ação, justificativa do
  modelo, Aprovar/Recusar.
- Histórico das execuções automáticas.
- Repo `src/lib/data/repos/db/ai-agents.ts` + Realtime nas sugestões.
- Demais abas intocadas.

**Pronto quando:** aprovar uma sugestão move o card no Leads de verdade.

## Tarefa 7 — pg_cron + ponta a ponta

- Migração `0025_ai_agent_cron.sql`: `private.ai_agent_tick()` lendo de
  `private.ai_agent_config` + `cron.schedule('lito-ai-agent-tick', ...)`.
- Teste real: pagamento novo na Guru → agente vincula → card se move.
- `AGENTS.md`: seção do módulo, diagnóstico e como pausar (aditivo).

**Pronto quando:** o ciclo roda sozinho e está documentado.

---

## Ordem e risco

1–2 são infraestrutura e podem ir juntas. 3–4 são o miolo e valem PR próprio
cada. 5 liga tudo. 6 é a única que toca área do Claude B (UI) — avisar no PR.
7 fecha.

O agente nasce com pouco o que fazer: 10 contatos no CRM, dos quais 3 casam com
pagamentos. Isso é esperado e é a informação que interessa — o KPI "sem contato
no CRM" mede exatamente quanto valeria importar contatos da Guru, que é a decisão
de negócio em aberto.
