# Fundação de IA (OpenAI) — Design Spec

> Base reutilizável pra IA no Lito CRM: cliente server da OpenAI (chave só no servidor),
> rota autenticada `/api/ai/generate`, repo pro cliente, **logs de uso** (`ai_logs`) e um
> **playground real no AI Studio** que prova a fundação. As features específicas (Content AI,
> Conversation AI, Base de Conhecimento) vêm depois, em cima disso.
> Data: 2026-08-12. Convenções: `AGENTS.md`.

## Objetivo

Montar o "encanamento" seguro pra falar com a OpenAI, sem ainda definir cada agente:
- **Cliente server** que chama a OpenAI usando `OPENAI_API_KEY` (nunca no cliente).
- **Rota autenticada** `POST /api/ai/generate` — o motor genérico que qualquer feature de IA
  vai usar (recebe prompt/system, devolve texto).
- **Logs** de cada geração (`ai_logs`): modelo, prompt, resposta, tokens, quem chamou.
- **AI Studio** vira real: o playground "Construa usando IA" gera de verdade, e os KPIs/lista
  de uso saem dos `ai_logs`.

## Não-objetivos (v1 — a FUNDAÇÃO)

- **Definir o que cada IA faz** (Content AI, Conversation AI no inbox, base de conhecimento/
  RAG, IA de voz) — vem depois, cada uma como spec própria em cima desta base.
- **Agentes de IA (`/agentes-ia`)** continua MOCK nesta fase (a aba "Logs" de lá é sobre
  eventos de agente de conversa, não sobre chamadas de geração — vira real com o Conversation AI).
- **Streaming** de resposta (v1 responde de uma vez), **function/tool calling**, **fine-tuning**.
- **Chave por empresa** — v1 usa UMA chave do sistema (env), decisão do Gabriel.

## Decisões aprovadas (brainstorming)

1. **Estrutura primeiro, features depois.**
2. **Uma chave do sistema** (`OPENAI_API_KEY` na Vercel/env), não por empresa. Chave só no servidor.
3. **Logs inclusos** na fundação (tabela `ai_logs` + uso no AI Studio).
4. **OpenAI** (a conta que o Gabriel já tem). Modelo configurável por env (não travar em versão).

## Config (env — nunca `NEXT_PUBLIC_`)

- `OPENAI_API_KEY` — chave secreta da OpenAI (server-only).
- `OPENAI_MODEL` — opcional, default `gpt-4o-mini`. Trocar por qualquer modelo atual da conta
  (a OpenAI renomeia/aposenta modelos; deixar configurável evita travar, como no Google Ads).

## Arquitetura

```
UI (playground / futuras features)
  → aiActions.generate({ system?, prompt, feature? })   (repo, cliente)
  → POST /api/ai/generate  (autenticada: getUser + membership)
       → lib/ai/openai.ts chat()  → https://api.openai.com/v1/chat/completions  (usa OPENAI_API_KEY)
       → grava ai_logs (modelo, prompt, resposta, tokens, created_by, location)
       → devolve { text, usage }
```

A rota é **autenticada** (tem sessão do usuário) → fica no matcher normal do `proxy.ts`
(NÃO alterar `proxy.ts`). A chave nunca vai ao cliente. O `location_id` do log vem da
sessão/membership, nunca do corpo.

## Cliente OpenAI (`src/lib/ai/openai.ts`) — server-only

- `defaultModel(): string` — `process.env.OPENAI_MODEL || "gpt-4o-mini"`.
- `chat(messages: {role:"system"|"user"|"assistant"; content:string}[], opts?: { model?: string; temperature?: number }): Promise<{ text: string; usage: { promptTokens: number; completionTokens: number } }>`
  - `POST https://api.openai.com/v1/chat/completions`, header `Authorization: Bearer OPENAI_API_KEY`.
  - Body `{ model, messages, temperature }`. Lê `choices[0].message.content` e `usage`.
  - Lança com a mensagem de erro da OpenAI (`error.message`) em não-2xx; lança se a chave faltar.

## Modelo de dados (migração `0025_ai_logs.sql`)

**`public.ai_logs`** — uma linha por geração
- `id`, `location_id` (RLS), `feature text default 'generate'` (ex.: "playground", depois
  "content", "inbox-suggest"), `model text`, `prompt text`, `response text`,
  `prompt_tokens int default 0`, `completion_tokens int default 0`,
  `created_by uuid references auth.users(id) on delete set null`, `created_at`.
- RLS padrão membership; `revoke all from anon`. Membros **leem** e **inserem** (a rota roda
  com a sessão do usuário; o insert passa pela RLS como membro).
- índice em `(location_id, created_at desc)`.

> **Colisão de número:** `0025` é o próximo livre no `AGENTS.md`. O outro Claude pode pegar
> `0025` — reconciliar no merge (renumerar como foi feito: 0020→0022).

## Rota (`POST /api/ai/generate`)

Autenticada (`getUser()`; resolve `location_id` da membership).
- Body: `{ system?: string; prompt: string; model?: string; temperature?: number; feature?: string }`.
- Sem sessão → 401. `OPENAI_API_KEY` ausente → 503 ("IA não configurada"). Prompt vazio → 400.
- Monta `messages` (`system` opcional + `user: prompt`), chama `chat()`.
- Grava `ai_logs` (feature ?? "generate", model usado, prompt, response, tokens, created_by, location).
- Resposta: `200 { text, usage: { promptTokens, completionTokens } }` | `502 { error }` (falha OpenAI).

## Repo (`src/lib/data/repos/db/ai.ts`)

- `aiActions.generate(input: { system?: string; prompt: string; feature?: string }): Promise<{ ok: boolean; text?: string; error?: string }>` — POST na rota.
- `useAiLogs(limit?: number): { logs: AiLog[]; ready: boolean }` — últimos logs da empresa
  (`AiLog = { id, feature, model, prompt, response, promptTokens, completionTokens, createdAt }`).
- `useAiUsage(): { callsThisMonth: number; tokensThisMonth: number; ready: boolean }` — derivado
  dos logs do mês (contagem + soma de tokens).

## UI (`src/app/(app)/ai-studio/page.tsx`)

- **Playground "Construa usando IA":** o `Textarea` + botão **Gerar** passam a chamar
  `aiActions.generate({ prompt, feature: "playground" })`; mostra a resposta abaixo (com
  estado de carregando e erro via toast). Substitui o `toast.info("...chega com o backend")`.
- **KPIs reais:** "Conversas/gerações com IA no mês" e "tokens" saem de `useAiUsage()`
  (substituem os valores mock; "Agentes ativos" pode virar "—"/estático até o Conversation AI).
- **Últimas gerações:** uma lista curta dos `ai_logs` recentes (feature, modelo, trecho do
  prompt, quando). Estilo conforme `AGENTS.md`.
- Os atalhos (Agentes de IA / Automações) ficam como estão.

## Segurança

- `OPENAI_API_KEY` só no servidor (env, nunca `NEXT_PUBLIC_`); nenhuma rota devolve a chave.
- `/api/ai/generate` valida `getUser()` + membership; `location_id` vem da sessão, não do corpo.
- `ai_logs` com RLS por location; prompts/respostas ficam visíveis só aos membros da empresa.
- (v1 sem rate-limit; como é chave própria e uso interno, aceitável — anotar como follow-up.)

## Testes / verificação

- Sem runner de testes → gate `npx tsc --noEmit` + `npm run build`.
- Sem sessão → `/api/ai/generate` responde 401. Sem `OPENAI_API_KEY` → 503.
- Manual (com a chave na Vercel): AI Studio → playground → "Gerar" → resposta real aparece e
  um `ai_log` é gravado; KPIs/lista de uso refletem.

## Ordem de dependência

Migração `0025` aplicada (Gabriel, SQL Editor) + `OPENAI_API_KEY` (e opcional `OPENAI_MODEL`)
na Vercel + `.env.local` → deploy → testar no AI Studio. Sem aprovação externa (é só
nosso backend + a chave da OpenAI que já existe).
