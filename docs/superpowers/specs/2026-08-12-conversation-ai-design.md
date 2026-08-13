# Conversation AI (Agentes de IA) — Design Spec

> Torna funcional a aba **Agentes de IA → Conversation AI**: agentes de IA reais
> (personalidade/meta/infos/modelo/status) por empresa, e o painel **"Testar seu bot"**
> conversando de verdade com a OpenAI (via a fundação de IA). Auto-responder em conversas
> reais, base de conhecimento e execução de ações ficam pra fases seguintes.
> Data: 2026-08-12. Convenções: `AGENTS.md`. Depende de [[fundação de IA]] (`/api/ai/*`).

## Objetivo

Deixar o usuário **criar/configurar agentes de IA** e **conversar com um agente** no painel
"Testar seu bot" — validando a IA de ponta a ponta. Cada agente tem personalidade (system
prompt), meta e informações; o teste monta o system prompt a partir do agente + o histórico
da conversa e chama a OpenAI (rota `/api/ai/chat`), gravando em `ai_logs`.

## Não-objetivos (v1)

- **Auto-responder em conversas reais** (inbox/WhatsApp) — depende da Meta destravar e de
  lógica de roteamento; fase seguinte. (A aba já avisa "somente o agente principal responde".)
- **Base de Conhecimento / RAG** (subir docs e a IA responder por eles) — spec própria depois.
- **Execução real das ações** (agendar compromisso, disparar fluxo, transferir p/ humano) — os
  toggles são **guardados como config**, mas não executam nada na v1.
- **IA de voz** (telefonia — não temos).
- **KPIs e aba "Logs" dessa página** — continuam mock (são atividade de bot em conversa real).
- **Streaming** da resposta no teste (v1 responde de uma vez).

## Decisões aprovadas (brainstorming)

1. Escopo v1 = **agentes reais (CRUD) + "Testar seu bot" funcional**. O resto vem depois.
2. Em cima da **fundação de IA** (OpenAI, chave só no servidor).
3. Os **toggles de ações** ficam como config no agente (sem execução ainda).
4. Modelo por agente (default `gpt-4o-mini`, configurável no form).

## Arquitetura

```
Aba Conversation AI (agentes-ia):
  Lista de agentes + form "Metas do bot"  → aiAgentActions.create/update/... (Supabase RLS)
  Painel "Testar seu bot"  → aiAgentActions.chat(agentId, messages)
      → POST /api/ai/chat (autenticada): carrega o agente (RLS), monta o system prompt
        (personalidade + meta + infos), usa agent.model, chama lib/ai/openai chat([system, ...messages]),
        grava ai_logs (feature "agent-test"), devolve { text, usage }
```

A rota `/api/ai/chat` é **autenticada** (sessão) → fica no matcher normal do `proxy.ts`
(NÃO alterar). Reaproveita `src/lib/ai/openai.ts` (`chat`) da fundação. A chave nunca vai ao cliente.

## Modelo de dados (migração `0027_ai_agents.sql`)

**`public.ai_agents`**
- `id`, `location_id` (RLS), `name text`, `personality text default ''` (system prompt),
  `goal text default ''`, `extra_info text default ''`, `model text default 'gpt-4o-mini'`,
  `status text default 'sugestivo' check (status in ('ativo','sugestivo','desativado'))`,
  `is_primary boolean default false`, `channels text[] default '{}'`,
  `actions jsonb default '{}'` (mapa de flags: `{ agendamento: true, ... }`),
  `created_at`, `updated_at`.
- RLS padrão membership (select/insert/update/delete) + `revoke ... from anon` + trigger
  `set_updated_at`. índice `(location_id, created_at desc)`.
- **Agente principal:** garantido no app — ao marcar `is_primary=true` num agente, os outros
  da empresa viram `false` (uma `update ... set is_primary=false where location_id=... and id<>...`).

> **Colisão de número:** `0027` é o próximo livre esperado. O outro Claude pode pegar `0027` —
> conferir no merge e renumerar se preciso (como 0020→0022).

## Rota (`POST /api/ai/chat`)

Autenticada (`getUser()`). Body `{ agentId: string; messages: { role: "user" | "assistant"; content: string }[]; }`.
- Sem sessão → 401. Sem `OPENAI_API_KEY` → 503. `messages` vazio → 400.
- Carrega o agente por `agentId` via o client RLS (garante que é da empresa do usuário); não
  achou → 404.
- Monta o **system prompt** a partir do agente:
  `"<personality>\n\nObjetivo: <goal>\n\nInformações: <extra_info>"` (pulando os vazios).
- Chama `chat([{role:'system',content:system}, ...messages], { model: agent.model })`.
- Grava `ai_logs` (feature "agent-test", model, prompt = última msg do usuário, response, tokens,
  created_by, location) — best-effort.
- Resposta: `200 { text, usage }` | erros como acima | `502 { error }` (falha OpenAI).

## Repo (`src/lib/data/repos/db/ai-agents.ts`)

- type `AiAgent = { id, name, personality, goal, extraInfo, model, status, isPrimary, channels: string[], actions: Record<string, boolean> }`.
- `useAiAgents(): { agents: AiAgent[]; ready: boolean }`
- `aiAgentActions.create(input: { name: string }): Promise<{ ok, id?, error? }>` (cria com defaults).
- `aiAgentActions.update(id, patch: Partial<Pick<AiAgent,"name"|"personality"|"goal"|"extraInfo"|"model"|"status"|"channels"|"actions">>): Promise<boolean>`
- `aiAgentActions.setPrimary(id): Promise<boolean>` (marca este e desmarca os outros).
- `aiAgentActions.remove(id): Promise<boolean>`
- `aiAgentActions.chat(agentId, messages: { role:"user"|"assistant"; content:string }[]): Promise<{ ok, text?, error? }>` (POST na rota).

## UI (`src/app/(app)/agentes-ia/page.tsx`, aba "Conversation AI")

Substitui os mocks da aba Conversation AI (as demais abas ficam como estão):
- **Lista de agentes** real (`useAiAgents`): nome, badge "Principal", status, canais; selecionar
  um edita; **"+ Criar bot"** cria (pede o nome). Marcar principal / excluir.
- **"Metas do bot — <agente>"**: form ligado ao agente selecionado — Personalidade, Meta,
  Informações adicionais, seletor de **Modelo**, seletor de **Status**, os **toggles de ações**
  (guardados em `actions`). Botão **Salvar** → `update`.
- **"Testar seu bot"**: painel de chat real. Estado local de `messages`; enviar → adiciona a msg
  do usuário, chama `aiAgentActions.chat(agente.id, messages)`, adiciona a resposta. Loading e
  erro tratados. Sem agente selecionado → aviso pra criar/selecionar.

Estilo conforme `AGENTS.md`; texto pt-BR; Base UI (Select com children explícito).

## Segurança

- Reusa a fundação: `OPENAI_API_KEY` só no servidor; `/api/ai/chat` autenticada + RLS.
- O agente é carregado pela sessão (RLS) — não dá pra testar agente de outra empresa.
- `ai_agents`/`ai_logs` com RLS por location.

## Testes / verificação

- Sem runner → gate `npx tsc --noEmit` + `npm run build`.
- Sem sessão → `/api/ai/chat` 401; sem `OPENAI_API_KEY` → 503; `messages` vazio → 400.
- Manual (com a chave + migração `0027`): criar um agente, preencher personalidade/meta, salvar,
  e conversar no "Testar seu bot" → respostas reais coerentes com a personalidade; aparece em `ai_logs`.

## Ordem de dependência

Migração `0027_ai_agents.sql` aplicada (Gabriel) + a fundação de IA já no ar (`OPENAI_API_KEY`
na Vercel). Sem aprovação externa — é só nosso backend + a OpenAI.
