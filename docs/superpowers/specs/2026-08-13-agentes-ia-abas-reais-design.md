# Agentes de IA — abas restantes reais — Design Spec

> Torna reais as abas do módulo **Agentes de IA** que ainda eram mock, reusando a
> fundação de IA (`/api/ai/generate`, `ai_logs`) e o repo de agentes (`db/ai-agents.ts`).
> Data: 2026-08-13. Convenções: `AGENTS.md`. Depende de [[fundação de IA]] e [[Conversation AI]]
> (ambas já em produção). **Sem migração nova, sem rota nova** — é front-end ligando no que já existe.

## Objetivo

Depois do Conversation AI, o pedido do Gabriel foi "quero tudo real" nas abas do
`/agentes-ia`. Esta spec cobre as abas que dá pra deixar reais **agora** e marca
honestamente (sem dados fake) as que dependem de coisas que ainda não temos.

## Decisões aprovadas (perguntas ao Gabriel, 2026-08-13)

- **IA de voz → "em breve".** É telefonia; não temos provedor de voz conectado. A aba
  vira um estado honesto de "em breve" (sem campos/KPIs fake). Volta quando houver provedor.
- **Base de Conhecimento → deixar por último.** RAG (upload + embeddings + retrieval) é
  módulo próprio e maior; fica para uma rodada dedicada. Por enquanto, estado "em breve"
  (sem tabela de fontes fake).

## Escopo desta rodada

Reais agora (reusam a fundação):
1. **Content AI** — o "Gerar" passa a chamar a OpenAI de verdade (`aiActions.generate`).
2. **Modelos de agente** — "Usar modelo" **cria um agente real** já preenchido e leva à aba Conversation AI.
3. **Logs** — mostra os `ai_logs` reais (gerações + testes de bot), não mais a tabela fake.

Estados honestos "em breve" (removem o mock):
4. **IA de voz** — placeholder "em breve" (telefonia pendente).
5. **Base de Conhecimento** — placeholder "em breve" (RAG numa próxima rodada).

Inalterada:
6. **Começando** — tela de comparação/marketing (sem dado fake a corrigir; botão já navega).

## Não-objetivos

- Provedor de voz/telefonia (Vapi/Retell/Twilio) — decisão futura.
- RAG / Base de Conhecimento funcional (upload, embeddings, retrieval) — rodada própria.
- Auto-responder da IA em conversas reais de clientes (depende da Meta/WhatsApp).
- Novos KPIs reais no topo das abas.

## Arquitetura

Tudo em `src/app/(app)/agentes-ia/page.tsx`, extraindo as abas reais em componentes
próprios (como o `ConversationAiTab`), em `src/components/ai/`:

```
content-ai-tab.tsx     → aiActions.generate({ system, prompt, feature: "content" })  (db/ai.ts)
agent-templates-tab.tsx→ aiAgentActions.create({name}) + update(id, {personality, goal})  (db/ai-agents.ts)
                          depois onUsed() → a página troca para a aba "Conversation AI"
ai-logs-tab.tsx        → useAiLogs(30)  (db/ai.ts)
```
IA de voz e Base de Conhecimento viram blocos "em breve" (usam o `EmptyState` compartilhado).

Interfaces existentes reusadas (não mudam):
- `aiActions.generate({ system?, prompt, feature? }): Promise<{ ok, text?, error? }>` — POST `/api/ai/generate` (autenticada; honra `system` e `feature`; grava `ai_logs`).
- `useAiLogs(limit): { logs: AiLog[]; ready }` — `AiLog = { id, feature, model, prompt, response, promptTokens, completionTokens, createdAt }`.
- `aiAgentActions.create({name}): { ok, id?, error? }` e `aiAgentActions.update(id, patch)` — de `db/ai-agents.ts`.

## Detalhes por aba

### Content AI (real)
- Mantém os campos (pedido + seletor de Formato). Remove a constante `CONTENT_SAMPLES`.
- Formatos: **Post Instagram**, **E-mail**, **Anúncio**.
- Ao "Gerar": valida pedido não-vazio → `aiActions.generate({ feature: "content", system, prompt })`.
  - `system` guia o formato em pt-BR, ex.: "Você é redator de marketing/vendas do Lito CRM.
    Escreva em português do Brasil. Formato: <formato> (Post Instagram = curto, com emojis e
    hashtags; E-mail = com linha de Assunto; Anúncio = curto, com CTA). Devolva só o texto final."
  - `prompt` = o pedido do usuário.
- Estado de loading ("Gerando..."), resultado no painel, erro via toast. Botão **Copiar** no resultado.
- Sem chave/erro: toast (503 → "IA não configurada").

### Modelos de agente (real)
- Os 4 modelos ganham presets de `personality` + `goal` (curados, pt-BR).
- "Usar modelo": `create({ name: modelo.nome })` → se ok, `update(id, { personality, goal })` →
  toast "Agente criado a partir do modelo" → `onUsed()` (a página troca para "Conversation AI",
  onde o agente novo aparece na lista). Botão desabilitado enquanto cria; erro via toast.

### Logs (real)
- `useAiLogs(30)`. Colunas reais: **Data/hora** (ptBR), **Recurso** (rótulo amigável de `feature`:
  `generate`→"Geração de texto", `content`→"Content AI", `agent-test`→"Teste de bot", outro→o próprio),
  **Modelo**, **Tokens** (prompt+conclusão). `EmptyState` quando não há logs. Remove a constante `AI_LOGS`.

### IA de voz (em breve)
- Remove KPIs e formulário fake (e o estado `voice`/`afterHours`). `EmptyState` com ícone `Mic`,
  título "IA de voz — em breve", texto: atende ligações por telefone; requer um provedor de voz
  (ainda não conectado).

### Base de Conhecimento (em breve)
- Remove a tabela de fontes fake (`KNOWLEDGE_SOURCES`). `EmptyState` com ícone de documento,
  título "Base de Conhecimento — em breve", texto: em breve será possível subir PDFs/URLs para a
  IA responder com base neles (RAG).

## Limpeza

Remover do `page.tsx`: constantes mock (`CONTENT_SAMPLES`, `AI_LOGS`, `KNOWLEDGE_SOURCES`),
estados órfãos (`voice`, `afterHours`, `contentFormat/Prompt/Result` se migrarem para o componente),
e imports que ficarem sem uso. O build do Next roda eslint e acusa símbolo não usado — zerar.
`AGENT_TEMPLATES` fica (agora com presets), ou migra para o componente de modelos.

## Segurança

- Nada novo exposto: tudo reusa rotas autenticadas (`getUser()`) e RLS já existentes.
  `OPENAI_API_KEY` continua só no servidor. `ai_logs`/`ai_agents` com RLS por `location_id`.

## Testes / verificação

- Sem runner → gate `npx tsc --noEmit` + `npm run build` (eslint acusa símbolo órfão).
- Manual (com `OPENAI_API_KEY` + migrações aplicadas): Content AI gera texto real; "Usar modelo"
  cria agente e leva ao Conversation AI; Logs lista os `ai_logs` reais; IA de voz e Base de
  Conhecimento mostram "em breve" sem campos fake.

## Ordem de dependência

Nenhuma migração. Depende só de `OPENAI_API_KEY` na Vercel (já pendente da fundação) para o
Content AI responder — sem a chave, a UI mostra erro honesto (503), não quebra.
