# Email Marketing — Design Spec

> Módulo **Marketing → E-mails** do Lito CRM, tornado real sobre Supabase + Resend.
> Data: 2026-08-10. Convenções do repo: `AGENTS.md`. Mapa funcional: `MAPA_FUNCIONALIDADES.md` (seção 10.1).

## Objetivo

Transformar a aba **Marketing → E-mails** (hoje mock) em um sistema real de campanhas
de e-mail: criar uma campanha, escolher um segmento de contatos, compor o e-mail num
editor rico, disparar de verdade via Resend em escala, e acompanhar métricas reais de
entrega/abertura/clique — com descadastro em conformidade.

## Não-objetivos (v1)

- A/B test e drip de campanha (YAGNI — foco em campanha única bem feita).
- Upload próprio de imagens (storage) — imagens entram por **URL** no editor. Fica
  para o backlog de "Mídia/storage".
- Reescrita das outras abas do módulo Marketing (Planejador Social, Anúncios etc.).

## Decisões aprovadas (brainstorming)

1. **Escopo:** envio real **+** métricas de abertura/clique (via webhook do Resend).
2. **Escala/envio:** campanha vira fila; processada por **pg_cron** a cada minuto em
   lotes de **100** via **Resend Batch API**. Rota e cron **separados** das automações,
   reusando o segredo máquina-a-máquina (`AUTOMATION_SECRET`).
3. **Descadastro:** flag **dedicada** `contacts.marketing_opt_out` — não afeta
   e-mails transacionais (convites, automações), que continuam checando só `dnd`.
4. **Composer:** **editor rico (Tiptap)** com variáveis (`{{nome}}` etc.), trechos
   reutilizáveis (snippets já no banco) e 3–4 modelos prontos.

## Arquitetura

Espelha o motor de Automações (fila no Postgres + tick chamado pelo pg_cron + execução
em TypeScript com a service role). Peças:

```
Publicar/agendar campanha ─► materialize_recipients() ─► fila de recipients (pending)
                                                              │
pg_cron (1/min) ─► POST /api/marketing/tick ─► Resend Batch (100) ─► recipients=sent
                                                              │
Resend eventos ─► POST /api/marketing/resend-webhook ─► apply_email_event() ─► métricas
Link no rodapé ─► GET /api/marketing/unsubscribe ─► marketing_opt_out = true
```

## Modelo de dados (migração `0010_email_marketing.sql`)

Mesmo padrão de RLS/tenant da `0001`: `location_id` em tudo, RLS habilitada,
`revoke ... from anon`, políticas `TO authenticated` via `private.user_locations()`.
Escrita de status/contadores fica com a **service role** (tick + webhook).

### `public.email_campaigns`
- `id uuid pk`, `location_id uuid not null → locations`
- `name text`, `subject text`, `from_email text` (default `nao-responder@news.litoaviation.com`), `reply_to text`
- `body_html text`, `body_text text`
- `audience jsonb` — `{ "type": "all" | "tag" | "smart_list", "value": <tag|smart_list_id|null> }`
- `status text` check in (`draft`,`scheduled`,`sending`,`sent`,`paused`,`failed`) default `draft`
- `scheduled_at timestamptz`
- contadores int default 0: `total`, `sent`, `delivered`, `opened`, `clicked`, `bounced`, `failed`, `unsubscribed`
- `created_at`, `updated_at`
- RLS: membros da location leem/gerenciam (select/insert/update/delete); status/contadores só a service role altera durante o envio.

### `public.email_campaign_recipients`
- `id uuid pk`, `campaign_id uuid → email_campaigns on delete cascade`, `location_id uuid`, `contact_id uuid → contacts`, `email text`
- `status text` check in (`pending`,`sent`,`delivered`,`opened`,`clicked`,`bounced`,`failed`,`skipped`) default `pending`
- `resend_id text` (id do e-mail no Resend — casa eventos do webhook), `error text`
- `sent_at`, `delivered_at`, `opened_at`, `clicked_at` timestamptz
- `unique (campaign_id, contact_id)` — anti-duplicado
- índices: `(campaign_id, status)`, `(resend_id)`
- RLS: membros leem; escrita só service role.

### `public.contacts`
- nova coluna `marketing_opt_out boolean not null default false`.

### Funções (schema `private`, `security definer set search_path = ''`)
- `private.materialize_recipients(p_campaign_id uuid)` — resolve o `audience` em contatos
  elegíveis (com e-mail, `marketing_opt_out = false`, `dnd = false`), insere em
  `email_campaign_recipients` com `on conflict do nothing`, e grava `email_campaigns.total`.
- `private.apply_email_event(p_resend_id text, p_type text, p_at timestamptz)` — idempotente:
  avança o status do recipient (não regride; não conta abertura duas vezes) e incrementa
  o contador correspondente na campanha. `bounced`/`complained` também setam
  `marketing_opt_out = true` no contato.

## Pipeline de envio

1. **Publicar/agendar** — rota autenticada `POST /api/marketing/campaigns/[id]/send`
   (valida `getUser()` + membership da location; body `{ mode: 'now' | 'scheduled', scheduledAt? }`).
   Chama `materialize_recipients()` e seta `status = 'sending'` (agora) ou `'scheduled'` + `scheduled_at`.
2. **`POST /api/marketing/tick`** — protegida por header `x-automation-secret`
   (= `AUTOMATION_SECRET`); **fora do matcher do `proxy.ts`** (chamada máquina-a-máquina).
   - Seleciona campanhas `sending`, ou `scheduled` com `scheduled_at <= now()` (vira `sending`).
   - Pega até **100** recipients `pending` da campanha.
   - Monta cada e-mail: shell HTML da marca + `renderTemplate(body_html, vars)` +
     rodapé com link de unsubscribe; header `List-Unsubscribe` + `List-Unsubscribe-Post`.
     `tags: { campaign_id, recipient_id }` para reforço no casamento de eventos.
   - `resend.batch.send([...])` (até 100). Grava `resend_id` e `status='sent'` por recipient;
     erros → `status='failed'` + `error`.
   - Sem `pending` restante → `status='sent'` na campanha.
3. **`0011_marketing_cron.sql`** — tabela `private.marketing_config` (tick_url + secret,
   espelhando `private.automation_config`), função `private.marketing_tick()` e job
   `lito-marketing-tick` (`* * * * *`) chamando a rota via `net.http_post`, mesmo padrão
   do `0009`. O secret é o mesmo `AUTOMATION_SECRET`.

## Métricas (webhook do Resend)

- Ativar **tracking de abertura/clique** no domínio do Resend (painel).
- **`POST /api/marketing/resend-webhook`** — público, **verificado por assinatura Svix**
  com `RESEND_WEBHOOK_SECRET` (lib `svix`); fora do matcher do `proxy.ts`.
- Eventos tratados: `email.sent`, `email.delivered`, `email.opened`, `email.clicked`,
  `email.bounced`, `email.complained`. Casa por `resend_id` (fallback: `tags.recipient_id`).
- Cada evento → `apply_email_event()` (idempotente).

## Descadastro (unsubscribe)

- Rodapé de toda campanha: `GET /api/marketing/unsubscribe?c=<contactId>&s=<hmac>`.
  `hmac = HMAC_SHA256(contactId, AUTOMATION_SECRET)` — impede descadastrar terceiros.
- A rota valida o HMAC, seta `contacts.marketing_opt_out = true`, incrementa
  `unsubscribed` da campanha (quando `campaign_id` vier no link) e mostra página simples
  de confirmação.
- Header `List-Unsubscribe: <mailto+https>` e `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.
- **Transacionais não são afetados**: convites e automações checam só `dnd`.

## UI (aba Marketing → E-mails)

Repo real `src/lib/data/repos/db/campaigns.ts` (padrão dos repos db: store Zustand
carregado do Supabase + ações otimistas). Componentes em `src/components/marketing/`.

1. **Lista de campanhas** — tabela real (nome, status, destinatários, % abertura,
   % clique, data) + "Nova campanha".
2. **Composer** (`campaign-composer.tsx`, Tiptap):
   - Assunto, remetente (default da marca), reply-to.
   - Editor rico → `body_html` (negrito, itálico, listas, link, imagem por URL, botão/CTA).
   - Inserir **variáveis** (`{{nome}}`, `{{email}}`, campos personalizados) e **trechos**.
   - **3–4 modelos prontos** com o shell da marca (boas-vindas, newsletter, oferta, reengajamento).
   - **Público:** Todos / por Tag / Lista inteligente, com **contagem ao vivo** de elegíveis
     (descontando opt-out/dnd/sem e-mail).
   - **Prévia ao vivo** + botão **"Enviar teste pra mim"**.
   - Ações: Salvar rascunho · Agendar · Enviar agora.
3. **Detalhe da campanha** — KPIs (enviados, entregues, % abertura, % clique, bounces,
   descadastros) + tabela de destinatários com status individual + botão **Pausar**.

Estética do guia: h1 `text-lg font-bold text-slate-900`, cards `rounded-xl border bg-white`,
tabelas `text-xs`, botões `h-8 text-xs`, primário indigo, badge sucesso esmeralda.
Base UI (sem `asChild`; `SelectValue` com children; `Accordion` sem `type`). Zustand:
selecionar cru + derivar com `useMemo`.

## Infra, env e libs

- **Migrações:** `0010_email_marketing.sql` (tabelas + coluna + RLS + funções),
  `0011_marketing_cron.sql` (job pg_cron).
- **Libs:** `@tiptap/react` + extensões (`starter-kit`, `link`, `image`); `svix` (webhook).
- **Env novas:** `RESEND_WEBHOOK_SECRET` (do painel do Resend). Reuso de `AUTOMATION_SECRET`
  para o tick de marketing e para assinar links de unsubscribe. Adicionar em `.env.local`,
  `.env.example` e Vercel (production+preview+development).
- **Resend (passos manuais):** criar **webhook** → `https://lito-crm.vercel.app/api/marketing/resend-webhook`;
  **ativar tracking** de abertura/clique no domínio. Dependem da rota publicada em produção.

## Segurança / conformidade

- Envio e escrita de status só via service role (server-side). RLS protege leitura por tenant.
- Todo e-mail carrega unsubscribe + `List-Unsubscribe`. `bounced`/`complained` → opt-out
  automático (protege reputação de envio).
- HMAC nos links de unsubscribe (sem expor dados pessoais na URL além do id).
- Webhook sempre com verificação de assinatura Svix.

## Testes / verificação

- **Local:** `POST /api/marketing/tick` sem header → 401; header certo → `{processed:...}`.
  Criar campanha para um público de teste (uma tag com 1–2 contatos), publicar, rodar o
  tick e conferir recipients `sent` + envio real (id do Resend).
- **Webhook:** usar o "Send test event" do Resend e conferir contadores atualizando.
- **Unsubscribe:** abrir o link do rodapé e conferir `marketing_opt_out = true` +
  contador `unsubscribed`.
- `npm run build` limpo ao fim de cada tarefa.

## Ordem de dependência (produção)

Igual à Tarefa 4 das automações: webhook e cron só funcionam com a rota **publicada em
produção** + `RESEND_WEBHOOK_SECRET` na Vercel + tracking/webhook criados no Resend.
