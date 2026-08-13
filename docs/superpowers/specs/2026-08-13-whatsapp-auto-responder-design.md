# WhatsApp Auto-responder (Conversation AI nos números) — Design Spec

> Faz o **agente principal de IA responder sozinho** as mensagens que chegam no WhatsApp:
> mensagem entra pelo webhook → o agente principal (se "Ativo") gera a resposta pela OpenAI →
> envia pela Cloud API e grava no inbox. Liga a [[Conversation AI]] às [[Conversas]] reais.
> Data: 2026-08-13. Convenções: `AGENTS.md`. Depende de: WhatsApp conectado (webhook + envio),
> Conversation AI (`ai_agents`), Fundação de IA (`lib/ai/openai`, `ai_logs`, `OPENAI_API_KEY`).

## Objetivo

Quando um cliente manda mensagem no número conectado (ex.: 3408), o **agente principal**
da empresa responde automaticamente com a IA — sem intervenção humana. É o que torna o bot
de "redirecionar pra Secretaria" (e futuros bots) funcional de verdade, 24/7.

## Decisões aprovadas (Gabriel, 2026-08-13)

1. **Quem responde:** SÓ o agente marcado como **principal** (`is_primary`), e SÓ quando o
   status dele for **"ativo"**. O Gabriel liga/desliga o auto-resposta trocando o status
   (ativo = responde; sugestivo/desativado = não responde).
2. **Handoff humano:** assim que um **atendente humano** responder aquela conversa pelo inbox,
   o bot **para de responder AQUELA conversa** (não atropela o atendente). É "grudento": uma vez
   que um humano assumiu, o bot fica fora daquela conversa.

## Não-objetivos (v1)

- Bot por canal/setor específico, ou vários bots roteados — v1 é 1 agente principal por empresa.
- Execução das "ações" do agente (agendar, transferir, parar) — os toggles seguem só config.
- Responder **fora da janela de 24h** — a resposta é disparada por uma mensagem recebida, então
  está sempre dentro da janela; texto livre sempre entrega. (Não manda template.)
- Responder a mídia/reação/localização — v1 responde só a **mensagens de texto**.
- Re-ligar o bot numa conversa após o handoff (fica pausado; religar manualmente é fase futura).
- Streaming, filas, retries sofisticados — best-effort simples.

## Arquitetura

```
Cliente → WhatsApp → webhook /api/whatsapp/webhook (service role)
   grava contato/conversa/mensagem (como hoje)
   → maybeAutoReply():
        se sem OPENAI_API_KEY → nada
        se conversa.bot_paused = true → nada (humano assumiu)
        carrega agente principal ativo (ai_agents: is_primary, status='ativo') → se não há, nada
        respeita daily_limit do canal (conta saídas de hoje) → se estourou, nada
        monta system prompt (personalidade+meta+infos) + histórico (últimas ~10 msgs)
        chat() → sendText(phone_number_id, telefone_cliente, resposta)
        grava mensagem 'out' + atualiza conversa + grava ai_logs (feature "whatsapp-auto")

Inbox humano → /api/whatsapp/send (autenticada): ao enviar com sucesso,
   marca conversations.bot_paused = true  → a partir daí o bot não responde essa conversa.
```

Tudo best-effort e em `try/catch`: o auto-reply **nunca** pode quebrar o 200 do webhook nem o
envio humano. O webhook já roda com a service role (`createAdminClient`) e já tem o
`phone_number_id` (de `value.metadata.phone_number_id`) e o telefone do cliente (`m.from`).

## Modelo de dados (migração — próximo número livre)

**`public.conversations`** ganha uma coluna:
- `bot_paused boolean not null default false` — quando `true`, o auto-responder ignora a conversa.
  Setado por `/api/whatsapp/send` quando um humano envia; nasce `false`.

Sem novas tabelas. Migração idempotente (`add column if not exists`).

## Detalhes de comportamento

- **Gatilho:** dentro de `handleIncoming` do webhook, **depois** de gravar a mensagem de entrada
  de **texto** (`m.text?.body` presente), chama `maybeAutoReply`. Mídia/status não disparam.
- **Agente:** `ai_agents` onde `location_id = canal.location_id`, `is_primary = true`,
  `status = 'ativo'` (maybeSingle). Sem esse agente → não responde.
- **System prompt:** igual à Conversation AI —
  `personality` + (`Objetivo: goal`) + (`Informações: extra_info`), pulando vazios.
- **Histórico:** últimas ~10 mensagens da conversa (ordem cronológica), mapeadas
  `direction 'in' → user`, `'out' → assistant`. Dá contexto pra respostas coerentes.
- **Envio:** `sendText(channel.phone_number_id, telefoneCliente, resposta)`.
- **Grava saída:** insert em `messages` (direction 'out', type 'text', channel 'whatsapp', body,
  channel_id, wa_message_id da resposta, status 'sent') + update na conversa
  (`last_message_at`, `last_message_preview`). Mesma forma do `/api/whatsapp/send`.
- **`daily_limit`:** conta saídas do canal no dia (como no send); se atingiu, não responde
  (evita loop/estouro de custo).
- **Log:** `ai_logs` feature `"whatsapp-auto"`, model, prompt = texto do cliente, response,
  tokens, created_by = null (é a máquina), location_id.
- **Anti-loop:** só responde a mensagens `direction 'in'`; as saídas do bot não voltam como
  entrada. `bot_paused` evita o bot brigar com o humano.
- **Latência:** OpenAI + envio rodam inline antes do 200 (gpt-4o-mini é rápido, ~2-3s). Se
  virar problema de timeout do webhook, otimizar depois com `waitUntil` (fora do escopo v1).

## Segurança

- `OPENAI_API_KEY` e `WHATSAPP_TOKEN` só no servidor (webhook). Nada novo exposto ao cliente.
- Webhook segue validando assinatura (HMAC `WHATSAPP_APP_SECRET`) antes de qualquer coisa.
- `ai_agents`/`conversations`/`messages` com RLS por `location_id` (o webhook usa service role
  de propósito, como já faz pra gravar as mensagens recebidas).

## Testes / verificação

- Sem runner → gate `npx tsc --noEmit` + `npm run build`.
- Manual (com o 3408 conectado + `OPENAI_API_KEY` na Vercel):
  1. Em `/agentes-ia → Conversation AI`, deixar o agente principal **"Ativo"** com o config de
     redirect (personalidade/meta/infos).
  2. Mandar mensagem no 3408 de outro celular → o bot responde sozinho (redireciona pra Secretaria)
     e aparece no inbox das Conversas.
  3. Responder essa conversa pelo inbox (humano) → o bot **para** de responder ali (manda outra
     mensagem no número: o bot fica quieto naquela conversa).
  4. Trocar o agente pra "Sugestivo"/"Desativado" → o bot não responde mais.

## Ordem de dependência

Migração aplicada (Gabriel). `OPENAI_API_KEY` + `WHATSAPP_TOKEN` já na Vercel (pré-requisitos que
já estão no ar). Sem aprovação externa.
