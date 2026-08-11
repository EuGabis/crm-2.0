# WhatsApp (Meta Cloud API) — Design Spec

> Módulo **WhatsApp** do Lito CRM: canais de atendimento (números) via **Meta Cloud API**,
> com inbox 2 vias nas Conversas + envio por template. Data: 2026-08-11.
> Convenções: `AGENTS.md`. Mapa: `MAPA_FUNCIONALIDADES.md` (seção 18).

## Objetivo

Transformar o WhatsApp num **canal real** do CRM via **Meta Cloud API (oficial)**:
receber mensagens no inbox (Conversas) ao vivo, responder (texto livre dentro da janela
de 24h ou template fora dela), e gerenciar os **canais de atendimento** (números) num
painel estilo "Canais de atendimento".

## Não-objetivos (v1)

- **Bot / triagem automática** por canal (é um sistema próprio — conecta com Automações/
  Agentes de IA num projeto à parte). Coluna aparece como "—".
- **Coexistência** (recurso específico da Meta). Coluna "—".
- **Criar/submeter templates** pela API (aprovação de template). A v1 **lista** os templates
  já aprovados e **envia** com eles; a criação continua no painel da Meta.
- **Múltiplas WABAs com tokens diferentes** — v1 usa 1 token/WABA (env). Vários números da
  MESMA WABA já funcionam; WABAs diferentes ficam pra v2.
- Migrar mais de 1 número agora (o painel já suporta adicionar depois).

## Decisões aprovadas (brainstorming)

1. **Meta Cloud API (oficial)** — não a Evolution/QR não oficial.
2. Usuário **já tem** número WhatsApp Business + token (Cloud API).
3. v1 = **inbox 2 vias + envio por template**.
4. **Migrar 1 número** do RVOPS para o Lito (o webhook do número passa a apontar pro Lito;
   ⚠️ o RVOPS deixa de receber nesse número).
5. UI = painel **"Canais de atendimento"** (multi-canal, começa com 1 número).

## Arquitetura

Meta Cloud API + reaproveita as **Conversas** (inbox real com Realtime). Um webhook recebe
mensagens/status; as respostas saem por uma rota autenticada que chama a Cloud API.

```
Cliente WhatsApp ──► webhook Meta ──► POST /api/whatsapp/webhook ──► Conversas (contato/conversa/mensagem, ao vivo)
Inbox (responder) ──► POST /api/whatsapp/send ──► Cloud API ──► cliente     (texto livre <24h | template fora)
Status (entregue/lido) ──► webhook ──► atualiza a mensagem pelo wa_message_id
```

**Escopo de credencial:** 1 token/WABA por env. Cada canal guarda seu `phone_number_id`;
o webhook resolve o canal pelo `phone_number_id` da mensagem recebida.

## Config (env — você pega no painel da Meta)

- `WHATSAPP_TOKEN` — token permanente (System User)
- `WHATSAPP_APP_SECRET` — segredo do app Meta (valida assinatura do webhook)
- `WHATSAPP_VERIFY_TOKEN` — string aleatória (handshake do webhook GET)
- `WHATSAPP_GRAPH_VERSION` — opcional, default `v21.0`

Segredos **nunca** com prefixo `NEXT_PUBLIC_`; em `.env.local`, `.env.example` e Vercel.

## Modelo de dados (migração `0017_whatsapp.sql`)

**`public.whatsapp_channels`** — os canais/números
- `id`, `location_id` (RLS), `name` (nome interno, ex.: "Lito Academy Vendas"),
  `meta_name` (nome na Meta), `phone_e164` (número), `phone_number_id` (id na Meta, **único**),
  `waba_id`, `sector` (setor, ex.: "Comercial Principal"), `daily_limit int default 1000`,
  `active boolean default true`, `created_at`
- RLS padrão membership; `revoke ... from anon`.

**`public.messages`** — novas colunas
- `wa_message_id text` — id da mensagem no WhatsApp (casa os status do webhook)
- `status text` — `sent | delivered | read | failed` (nulo para não-WhatsApp)
- `channel_id uuid references whatsapp_channels` (qual número; nulo p/ outros canais)
- índice em `wa_message_id`.

A **janela de 24h** é calculada da **última mensagem `direction='in'`** da conversa (sem coluna).

## Cliente Cloud API (`src/lib/whatsapp/client.ts`)

- `sendText(phoneNumberId, to, body)` → `POST /{phoneNumberId}/messages` type=text
- `sendTemplate(phoneNumberId, to, name, lang, components)` → type=template
- `listTemplates(wabaId)` → `GET /{wabaId}/message_templates?status=APPROVED`
- `getNumberInfo(phoneNumberId)` → qualidade/status do número
- `markRead(phoneNumberId, messageId)` (opcional)
- Base: `https://graph.facebook.com/{GRAPH_VERSION}/…`, `Authorization: Bearer WHATSAPP_TOKEN`.

## Webhook — receber (`/api/whatsapp/webhook`)

Fora do matcher do `proxy.ts`; service role.
- **GET**: verificação (`hub.mode=subscribe`, confere `hub.verify_token`, devolve `hub.challenge`).
- **POST**: valida `X-Hub-Signature-256` (HMAC do corpo com `WHATSAPP_APP_SECRET`). Lê
  `entry[].changes[].value`:
  - `messages[]` (entrada): identifica o canal por `metadata.phone_number_id`; acha/cria
    **contato pelo telefone** (nome via `contacts[].profile.name`); acha/cria **conversa**
    (canal=whatsapp, canal_id, contato); insere **mensagem** (`direction='in'`, body do texto).
    → aparece no inbox ao vivo (Realtime já publicado).
  - `statuses[]`: atualiza `messages.status` casando por `wa_message_id`.
- Idempotência: ignora `wa_message_id` já visto.

## Enviar — responder + template (`/api/whatsapp/send`)

Rota autenticada (`getUser()` + membership). Body `{ conversationId | contactId, channelId, text? | template? }`.
- **Dentro da janela de 24h**: envia **texto livre** (`sendText`).
- **Fora / iniciar**: exige **template aprovado** (`sendTemplate` com nome/idioma/variáveis).
- Respeita `daily_limit` do canal (conta `direction='out'` do dia; se estourar → erro claro).
- Grava a mensagem de saída (`direction='out'`, `wa_message_id`, `status='sent'`).
- Rota `GET /api/whatsapp/templates?channelId=` lista os aprovados (via `listTemplates`).

## UI

**Módulo WhatsApp — "Canais de atendimento"** (`src/app/(app)/whatsapp/page.tsx` + `components/whatsapp/`):
- Tabela de canais: **Nome do canal · Nome na Meta · Número · Status · Qualidade · Setor ·
  Disparos hoje · Limite diário · Criado em** (+ colunas "Bot"/"Coexistência" como "—").
  Qualidade/status vêm ao vivo da Meta (`getNumberInfo`); disparos hoje contados no banco.
- Botão **"Criar canal"**: form (nome, setor, número, `phone_number_id`, `waba_id`, limite) →
  cria a linha em `whatsapp_channels`. (Conectar de verdade = apontar o webhook na Meta — passo manual.)
- Repo `src/lib/data/repos/db/whatsapp.ts` (padrão dos repos db).

**Inbox (Conversas):**
- Conversa de WhatsApp já aparece (canal existe). Composer:
  - Dentro de 24h → texto livre (envia real via `/api/whatsapp/send`).
  - Fora de 24h → aviso "janela fechada" + **seletor de template**.
- Status entregue/lido no balão (do `messages.status`).
- **Nova conversa por WhatsApp**: escolher contato + template → inicia.

## Passos manuais na Meta (você)

1. Env vars (`WHATSAPP_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`) no `.env.local` + Vercel.
2. **Deploy** (webhook precisa estar no ar).
3. Meta App → WhatsApp → **Configuration → Webhook**: callback
   `https://lito-crm.vercel.app/api/whatsapp/webhook`, verify token = `WHATSAPP_VERIFY_TOKEN`,
   assinar o campo **`messages`**. ← **aqui o número sai do RVOPS e entra no Lito.**
4. Criar o canal no painel do Lito (nome, número, `phone_number_id`, `waba_id`).

## Segurança

- Webhook sempre com verificação de assinatura (`X-Hub-Signature-256`); GET só com verify token.
- Envio e webhook rodam server-side (token nunca no cliente). Rota de envio valida sessão + membership.
- RLS por location nos canais/conversas/mensagens.

## Testes / verificação

- **Local/prod:** `GET /api/whatsapp/webhook?...` handshake → devolve o challenge.
- Mandar mensagem do celular pro número → aparece no inbox (mensagem `in`).
- Responder pelo inbox → chega no celular; status vira entregue/lido.
- Fora de 24h → composer exige template; enviar template aprovado → chega.
- `npm run build` limpo ao fim de cada tarefa.

## Ordem de dependência (produção)

Igual ao pg_cron/Guru: webhook só funciona com a rota **publicada** + env vars na Vercel +
webhook configurado na Meta apontando pro Lito.
