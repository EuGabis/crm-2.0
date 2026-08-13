# WhatsApp Auto-responder — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o agente principal de IA responder sozinho as mensagens de WhatsApp recebidas — mensagem entra pelo webhook → agente principal (se "ativo") gera resposta pela OpenAI → envia pela Cloud API e grava no inbox; humano respondendo pausa o bot naquela conversa.

**Architecture:** Um `maybeAutoReply()` chamado pelo webhook (service role) depois de gravar a mensagem de entrada de texto. Ele carrega o agente `is_primary`+`ativo`, respeita `bot_paused` e `daily_limit`, monta system prompt + histórico, chama `lib/ai/openai.chat`, envia com `lib/whatsapp/client.sendText`, grava a saída e loga em `ai_logs`. O `/api/whatsapp/send` (humano) marca `conversations.bot_paused=true`.

**Tech Stack:** Next.js (App Router) · TypeScript · Supabase (service role no webhook) · OpenAI · WhatsApp Cloud API.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-13-whatsapp-auto-responder-design.md`. Convenções: `AGENTS.md`.
- **Migração livre = `0031`** → `supabase/migrations/0031_whatsapp_autoreply.sql`. Idempotente. ⚠️ O outro Claude pode pegar `0031` — reconciliar no merge (renumerar como já foi feito).
- **Migração aplicada pelo Gabriel** no SQL Editor (o worker NÃO aplica).
- **Sem runner de testes:** verificação = `npx tsc --noEmit` **e** `npm run build` limpos. Rodar do repo `C:\Users\Gabriel\Documents\crm 2.0` (NÃO de worktree). Não invente pytest/jest.
- **Best-effort:** o auto-reply roda dentro do webhook e **NUNCA** pode quebrar o 200 nem lançar — tudo em `try/catch` interno. Idem: não pode quebrar o `/api/whatsapp/send`.
- **Segredos server-only:** `OPENAI_API_KEY`, `WHATSAPP_TOKEN`, `WHATSAPP_APP_SECRET` só no servidor. O webhook segue validando a assinatura HMAC antes de tudo (não mexer nisso).
- **Interfaces reusadas (não mudam):**
  - `chat(messages, opts?) : Promise<{ text, usage: { promptTokens, completionTokens } }>` de `@/lib/ai/openai`.
  - `sendText(phoneNumberId, to, body) : Promise<any>` de `@/lib/whatsapp/client` (retorna `{ messages: [{ id }] }`).
  - `createAdminClient()` (service role) de `@/lib/supabase/admin` — já usado no webhook.
  - `ai_agents(is_primary, status in ('ativo','sugestivo','desativado'), personality, goal, extra_info, model, location_id)`.
  - `ai_logs(location_id, feature, model, prompt, response, prompt_tokens, completion_tokens, created_by nullable, created_at)`.
  - `messages(location_id, conversation_id, direction 'in'|'out', type, channel, body, channel_id, wa_message_id, status, created_at)`.
  - `conversations(id, location_id, last_message_at, last_message_preview, ...)`.
  - `whatsapp_channels(id, location_id, phone_number_id, daily_limit, active)`.
- **Texto pt-BR.** Commits `feat(whatsapp): ...`. Branch → PR → squash na `main`. Área do Claude B.

---

## File Structure

**Criar:**
- `supabase/migrations/0031_whatsapp_autoreply.sql` — `conversations.bot_paused`.
- `src/lib/whatsapp/auto-reply.ts` — `maybeAutoReply()`.

**Modificar:**
- `src/app/api/whatsapp/webhook/route.ts` — chamar `maybeAutoReply` no fim de `handleIncoming` (só texto) + incluir `daily_limit` no select do canal + guardar contra corrida no insert.
- `src/app/api/whatsapp/send/route.ts` — no update final da conversa, setar `bot_paused: true` (handoff humano).
- `AGENTS.md` — doc + próxima migração livre.

---

## Task 1: Migração 0031 (bot_paused)

Adiciona a flag de handoff. Deliverable: SQL pronto + build limpo.

**Files:**
- Create: `supabase/migrations/0031_whatsapp_autoreply.sql`

**Interfaces:**
- Produces (SQL): coluna `public.conversations.bot_paused boolean not null default false`.

- [ ] **Step 1: Escrever a migração**

Create `supabase/migrations/0031_whatsapp_autoreply.sql`:

```sql
-- ============================================================
-- Lito CRM — WhatsApp auto-responder: flag de handoff humano
--
-- Quando um humano responde uma conversa pelo inbox (/api/whatsapp/send),
-- marcamos bot_paused=true e o auto-responder para de responder AQUELA conversa.
-- Nasce false. Idempotente.
-- ============================================================
alter table public.conversations
  add column if not exists bot_paused boolean not null default false;
```

- [ ] **Step 2: Aplicação (Gabriel)**

Pedir ao Gabriel para rodar `supabase/migrations/0031_whatsapp_autoreply.sql` no SQL Editor.

- [ ] **Step 3: Verificar build**

Run: `npx tsc --noEmit && npm run build`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0031_whatsapp_autoreply.sql
git commit -m "feat(whatsapp): migração 0031 (conversations.bot_paused)"
```

---

## Task 2: Lib do auto-responder

O motor do auto-reply, isolado e best-effort. Deliverable: arquivo pronto + build limpo.

**Files:**
- Create: `src/lib/whatsapp/auto-reply.ts`

**Interfaces:**
- Consumes: `chat` de `@/lib/ai/openai`; `sendText` de `@/lib/whatsapp/client`.
- Produces: `export async function maybeAutoReply(db: any, p: { locationId: string; conversationId: string; channelId: string; phoneNumberId: string; toPhone: string; dailyLimit: number; }): Promise<void>`
  - `db` é o client service role (passado pelo webhook). Nunca lança (try/catch interno).

- [ ] **Step 1: Escrever a lib**

Create `src/lib/whatsapp/auto-reply.ts`:

```ts
import { chat } from "@/lib/ai/openai";
import { sendText } from "@/lib/whatsapp/client";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Auto-responder do WhatsApp. Chamado pelo webhook (service role) depois de
 * gravar uma mensagem de ENTRADA de texto. Best-effort: qualquer falha é
 * engolida — nunca pode quebrar o 200 do webhook.
 *
 * Regras (spec 2026-08-13):
 * - só responde o agente principal (is_primary) com status 'ativo';
 * - não responde se a conversa está com bot_paused=true (humano assumiu);
 * - respeita o daily_limit do canal;
 * - usa as últimas ~10 mensagens da conversa como contexto.
 */
export async function maybeAutoReply(
  db: any,
  p: {
    locationId: string;
    conversationId: string;
    channelId: string;
    phoneNumberId: string;
    toPhone: string;
    dailyLimit: number;
  },
): Promise<void> {
  try {
    if (!process.env.OPENAI_API_KEY) return;

    // handoff: humano já assumiu esta conversa?
    const { data: conv } = await db
      .from("conversations")
      .select("bot_paused")
      .eq("id", p.conversationId)
      .maybeSingle();
    if (!conv || conv.bot_paused) return;

    // agente principal ATIVO da empresa
    const { data: agent } = await db
      .from("ai_agents")
      .select("personality, goal, extra_info, model")
      .eq("location_id", p.locationId)
      .eq("is_primary", true)
      .eq("status", "ativo")
      .maybeSingle();
    if (!agent) return;

    // limite diário do canal (conta saídas de hoje)
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const { count } = await db
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("channel_id", p.channelId)
      .eq("direction", "out")
      .gte("created_at", startOfDay.toISOString());
    if ((count ?? 0) >= p.dailyLimit) return;

    // histórico (últimas 10, ordem cronológica)
    const { data: rows } = await db
      .from("messages")
      .select("direction, body, created_at")
      .eq("conversation_id", p.conversationId)
      .order("created_at", { ascending: false })
      .limit(10);
    const history: any[] = (rows ?? []).slice().reverse();

    const parts = [
      agent.personality,
      agent.goal ? `Objetivo: ${agent.goal}` : "",
      agent.extra_info ? `Informações: ${agent.extra_info}` : "",
    ].filter((s: string) => s && s.trim());
    const system = parts.join("\n\n") || "Você é um assistente prestativo.";

    const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
      { role: "system", content: system },
      ...history.map((m) => ({
        role: m.direction === "out" ? ("assistant" as const) : ("user" as const),
        content: String(m.body ?? ""),
      })),
    ];

    let result;
    try {
      result = await chat(messages, { model: agent.model });
    } catch {
      return; // OpenAI falhou — best-effort
    }
    const reply = (result.text ?? "").trim();
    if (!reply) return;

    // envia pela Cloud API
    let waResp: any;
    try {
      waResp = await sendText(p.phoneNumberId, p.toPhone, reply);
    } catch {
      return; // envio falhou — best-effort
    }
    const waMessageId = waResp?.messages?.[0]?.id ?? null;

    // grava a saída + atualiza a conversa (mesma forma do /api/whatsapp/send)
    const { data: msg } = await db
      .from("messages")
      .insert({
        location_id: p.locationId,
        conversation_id: p.conversationId,
        direction: "out",
        type: "text",
        channel: "whatsapp",
        body: reply,
        channel_id: p.channelId,
        wa_message_id: waMessageId,
        status: "sent",
      })
      .select("created_at")
      .single();
    await db
      .from("conversations")
      .update({
        last_message_at: msg?.created_at ?? new Date().toISOString(),
        last_message_preview: reply,
      })
      .eq("id", p.conversationId);

    // log (best-effort; created_by null = máquina)
    const lastUser = [...history].reverse().find((m) => m.direction === "in");
    await db.from("ai_logs").insert({
      location_id: p.locationId,
      feature: "whatsapp-auto",
      model: agent.model,
      prompt: String(lastUser?.body ?? ""),
      response: reply,
      prompt_tokens: result.usage.promptTokens,
      completion_tokens: result.usage.completionTokens,
      created_by: null,
    });
  } catch {
    // best-effort absoluto: nunca propaga pro webhook
  }
}
```

- [ ] **Step 2: Verificar build**

Run: `npx tsc --noEmit && npm run build`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add src/lib/whatsapp/auto-reply.ts
git commit -m "feat(whatsapp): motor do auto-responder (agente principal responde)"
```

---

## Task 3: Ligar no webhook + handoff no send

Dispara o auto-reply ao receber texto e pausa o bot quando um humano responde. Deliverable: os dois arquivos alterados + build limpo.

**Files:**
- Modify: `src/app/api/whatsapp/webhook/route.ts`
- Modify: `src/app/api/whatsapp/send/route.ts`

**Interfaces:**
- Consumes: `maybeAutoReply` de `@/lib/whatsapp/auto-reply` (Task 2).

- [ ] **Step 1: Webhook — import + select do canal**

In `src/app/api/whatsapp/webhook/route.ts`:
- Add import no topo (após os imports existentes):
  ```ts
  import { maybeAutoReply } from "@/lib/whatsapp/auto-reply";
  ```
- No `POST`, o select do canal hoje é `.select("id, location_id")`. Troque para incluir o limite:
  ```ts
  .select("id, location_id, daily_limit")
  ```

- [ ] **Step 2: Webhook — disparar o auto-reply no fim de `handleIncoming`**

Ainda em `handleIncoming`, o trecho final hoje é:

```ts
  const { error: insErr } = await db.from("messages").insert({
    location_id: channel.location_id,
    conversation_id: conv.id,
    direction: "in",
    type: "text",
    channel: "whatsapp",
    body: text,
    channel_id: channel.id,
    wa_message_id: waId,
    status: "delivered",
  });
  // corrida: entrega duplicada da Meta — o índice único barra o 2º insert; ignore
  if (insErr && (insErr as any).code !== "23505") throw insErr;
}
```

Substitua a parte do `insErr` (do comentário até o `}` final da função) por:

```ts
  if (insErr) {
    // corrida: entrega duplicada da Meta — o índice único barra o 2º insert.
    // Nesse caso NÃO responde de novo (evita auto-reply duplicado).
    if ((insErr as any).code !== "23505") throw insErr;
    return;
  }

  // Auto-responder: só para mensagens de texto de verdade, best-effort.
  if (m.text?.body) {
    await maybeAutoReply(db, {
      locationId: channel.location_id,
      conversationId: conv.id,
      channelId: channel.id,
      phoneNumberId: value?.metadata?.phone_number_id,
      toPhone: phone,
      dailyLimit: channel.daily_limit ?? 1000,
    });
  }
}
```

(`phone`, `conv`, `channel`, `value`, `m` já existem nesse escopo. `maybeAutoReply` tem try/catch interno, mas o `if (m.text?.body)` garante que só texto dispara.)

- [ ] **Step 3: Send route — pausar o bot no handoff humano**

In `src/app/api/whatsapp/send/route.ts`, o update final da conversa hoje é:

```ts
  await supabase
    .from("conversations")
    .update({ last_message_at: msg.created_at, last_message_preview: bodyText, sla_days: 0 })
    .eq("id", conversationId);
```

Adicione `bot_paused: true` (um humano enviou → o bot para nessa conversa):

```ts
  await supabase
    .from("conversations")
    .update({
      last_message_at: msg.created_at,
      last_message_preview: bodyText,
      sla_days: 0,
      bot_paused: true,
    })
    .eq("id", conversationId);
```

- [ ] **Step 4: Verificar build**

Run: `npx tsc --noEmit && npm run build`
Expected: sem erros; rotas `/api/whatsapp/webhook` e `/api/whatsapp/send` no manifesto.

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/whatsapp/webhook/route.ts" "src/app/api/whatsapp/send/route.ts"
git commit -m "feat(whatsapp): dispara auto-reply no webhook e pausa bot no handoff humano"
```

---

## Task 4: Docs

Documenta o módulo. Deliverable: build limpo; `AGENTS.md` atualizado.

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Doc no AGENTS.md**

In `AGENTS.md`, na seção do WhatsApp (ou logo abaixo da Conversation AI), adicionar um parágrafo do auto-responder e atualizar a nota de "próxima migração livre" para **0032** (rodar `ls supabase/migrations/` antes; nossa é `0031_whatsapp_autoreply.sql` → próxima livre = **0032** se nada maior existir). Conteúdo (bater com o código):
- Auto-responder: `src/lib/whatsapp/auto-reply.ts` (`maybeAutoReply`), chamado pelo webhook depois de gravar mensagem de entrada de texto. Responde só o agente `is_primary`+`status='ativo'`; respeita `conversations.bot_paused` (migração `0031`) e `daily_limit`; usa as últimas ~10 msgs de contexto; grava saída + `ai_logs` feature `"whatsapp-auto"`.
- Handoff: `/api/whatsapp/send` seta `bot_paused=true` quando um humano responde → o bot para naquela conversa.
- Liga/desliga pelo status do agente principal (Ativo = responde). Sem env nova.

- [ ] **Step 2: Verificar build**

Run: `npx tsc --noEmit && npm run build`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "docs(whatsapp): seção auto-responder e próxima migração livre 0032"
```

---

## Handoff (Gabriel — fora do código)

1. Rodar `supabase/migrations/0031_whatsapp_autoreply.sql` no SQL Editor.
2. `OPENAI_API_KEY` + `WHATSAPP_TOKEN` já na Vercel (pré-requisitos no ar).
3. Em `/agentes-ia → Conversation AI`, deixar o agente principal **"Ativo"** com o config de redirect.
4. Mandar mensagem no 3408 → o bot responde sozinho e aparece no inbox. Responder pelo inbox → o bot para naquela conversa.

## Self-Review (autor do plano)

- **Cobertura da spec:** `bot_paused` → Task 1; motor com regras (principal+ativo, bot_paused, daily_limit, histórico, log) → Task 2; gatilho no webhook (só texto, guarda de corrida) + handoff no send → Task 3; docs → Task 4. Não-objetivos (ações do agente, bot por setor, re-ligar pós-handoff, mídia, fora da janela) ficam de fora. ✓
- **Consistência de tipos:** `maybeAutoReply(db, {locationId, conversationId, channelId, phoneNumberId, toPhone, dailyLimit})` (Task 2) chamado com esses campos exatos no webhook (Task 3). `chat()`/`sendText()` usados conforme as assinaturas reais (lidas). Colunas (`bot_paused`, `messages`, `ai_logs`, `conversations`) batem com migração/schema. ✓
- **Sem placeholders:** todo passo tem código real; verificação por tsc/build (projeto sem runner). ✓
- **Pontos de atenção:** (a) auto-reply inline no webhook (latência ~2-3s) — aceitável na v1, `waitUntil` fica pra depois; (b) guarda de corrida no insert evita auto-reply duplicado quando a Meta reentrega; (c) `ai_logs.created_by` é nullable (confirmado na 0026), então o log da máquina entra com null.
