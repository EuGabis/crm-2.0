<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

---

# Lito CRM — Guia do projeto (leia antes de mexer)

## Trabalho em paralelo (dois Claudes) — LEIA PRIMEIRO

Há **DOIS assistentes Claude** neste mesmo repo (EuGabis/crm-2.0) e no mesmo banco
Supabase, em máquinas/contas diferentes. Eles **não conversam** — a única coordenação
é via git e Supabase. Siga SEM EXCEÇÃO para não sobrescrever nem quebrar o trabalho do outro:

1. **Fonte única = `main` no GitHub.** Todo código vive no git (nada "só no disco" ou
   "só na Vercel"). Ao começar: `git fetch && git checkout main && git pull --ff-only`.
   Ao terminar: `git status` limpo e tudo **commitado e pushado** (deixar mudança sem
   commit já causou perda de trabalho).
2. **Produção = `main` via integração GitHub↔Vercel. NUNCA `vercel deploy` local** —
   sobrescreve a produção com código atrasado e apaga os fixes do outro. Subir à
   produção = **merge na `main`**. Produção errada = Promote to Production do commit
   certo na Vercel (nunca deploy local).
3. **Uma branch por tarefa** a partir da `main` atualizada; PR + **squash merge rápido**;
   depois delete a branch. Nada de branch gigante.
4. **Divisão de áreas** (não editem os mesmos arquivos):
   - Claude A — pagamentos: `pagamentos`, `assinaturas`, Guru (`api/webhooks/guru`,
     `api/integrations/guru`, `lib/integrations/*`, `db/payments.ts`).
   - Claude B — marketing/automações/UI: `marketing`, `automacoes`, `components/ui/*`,
     shell (`layout`, `sidebar`, `topbar`).
   - **Alta colisão (edição só ADITIVA + `git pull --rebase` antes do push):**
     `AGENTS.md`, `src/proxy.ts`, `package.json`, `package-lock.json`, `.env.example`.
5. **Migrações** (um banco só): antes de criar `supabase/migrations/00NN_*.sql`, `git pull`
   e use o **próximo número livre** (nunca reutilize). Toda migração **idempotente**
   (`... if not exists`, `drop policy if exists`). Diga no commit o que aplicar no SQL Editor.
6. **Sincronize sempre:** `git pull --rebase origin main` antes de push e antes de tocar
   arquivo compartilhado. Conflito = mantenha AS DUAS contribuições, nunca descarte a do outro.
7. **Segredos** nunca no git → `.env.example` (placeholder) + Vercel + nota aqui.

**Checklist ao encerrar:** `git status` limpo e pushado · `npm run build` passou ·
produção só via merge na `main` · branch mesclada deletada.

## O que é

CRM all-in-one ("Lito CRM") inspirado no GoHighLevel (engenharia reversa de um vídeo
de demonstração — ver `MAPA_FUNCIONALIDADES.md`, a especificação funcional canônica).

**Backend Supabase em migração módulo a módulo.** Módulos já reais: Contatos,
Leads/Pipelines, Conversas (Realtime), Dashboard, Calendários, Equipe/permissões,
Configurações (empresa/perfil), Checklist de ativação e Pagamentos (via Guru — ver
seção própria abaixo). Os demais ainda usam os repositórios mock sobre Zustand — ver
"Padrão de migração módulo a módulo" abaixo.

Documentos importantes:
- `MAPA_FUNCIONALIDADES.md` — mapa funcional completo extraído do vídeo de referência
- `docs/superpowers/specs/2026-08-06-crm-frontend-design.md` — spec de design aprovada
- `docs/superpowers/plans/2026-08-06-lito-crm-frontend.md` — plano de implementação executado

## Como rodar

```bash
npm install
npm run dev      # http://localhost:3000 (redireciona para /dashboard)
npm run build    # build + type check — deve passar sem erros
```

## Produção

- **App no ar:** https://lito-crm.vercel.app (projeto Vercel `lito-crm`, escopo
  `gabriels-projects-fa9c86e6`).
- **Deploy = merge na `main`** — a integração GitHub↔Vercel builda e publica sozinha.
  **NÃO rode `vercel deploy` / `vercel --prod` local**: isso sobe seu código local
  (talvez atrasado) por cima da produção e apaga fixes do outro. Produção errada?
  Promova o deploy do commit certo da `main` na Vercel (Promote to Production).
  Ver "## Trabalho em paralelo (dois Claudes)" no topo deste arquivo.
- Env vars configuradas na Vercel (production+preview+development):
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
  `RESEND_API_KEY`, `EMAIL_FROM`, `NEXT_PUBLIC_APP_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `AUTOMATION_SECRET`, `GURU_SYNC_SECRET`.
  Ao criar variável nova, adicionar na Vercel **e** no `.env.local`.
- Supabase Auth → URL Configuration precisa conter a URL de produção em
  Site URL e Redirect URLs (senão a confirmação de e-mail cai em localhost).

## Stack

Next.js (App Router) · TypeScript · Tailwind CSS 4 · shadcn/ui (**variante Base UI,
NÃO Radix**) · Zustand · dnd-kit (kanban) · Recharts (gráficos) · date-fns (ptBR) ·
lucide-react · sonner (toasts) · Tiptap (editor rich text do Marketing) · svix
(verificação de webhook do Resend).

## Estrutura

```
src/
  app/(app)/           # 19 módulos, cada pasta = 1 item da sidebar
    dashboard/  conversas/  calendarios/  contatos/ (+[id])  leads/
    pagamentos/  ai-studio/  agentes-ia/  marketing/  automacoes/ (+[id] builder)
    sites/  assinaturas/  midia/  reputacao/  relatorios/  marketplace/
    whatsapp/  configuracoes/ (layout próprio + 16 sub-páginas)  ativacao/
  app/api/
    automations/tick/    marketing/{tick,resend-webhook,unsubscribe,campaigns/[id]/*}
    webhooks/guru/       integrations/guru/sync/    team/invite/
  components/
    layout/            # Sidebar, Topbar, SubNav, SupportPanel, WebphonePanel
    shared/            # DataTable, FilterDrawer, KpiCard, SlaBadge, ChannelIcon, EmptyState
    dashboard/ inbox/ contacts/ pipeline/ automations/ marketing/ modules/   # por domínio
    ui/                # shadcn (Base UI)
  lib/
    config/brand.ts    # ÚNICA fonte do nome/marca ("Lito CRM") — nunca hardcodar
    config/nav.ts      # itens da sidebar (ordem espelha o mapa)
    data/types.ts      # Contact, Conversation, Message, Opportunity, Pipeline, Workflow...
    data/fixtures/     # dados mock pt-BR (50 contatos, 80 oportunidades, 20 conversas...)
    data/store.ts      # Zustand store + ações (moveOpportunity, sendMessage, addContact...)
    data/repos/        # A UI SÓ importa daqui (contacts, opportunities, conversations,
                       # workflows, appointments) — trocar mock por backend = mexer só aqui
    integrations/guru*.ts  # cliente REST + mapeamento de payload da Digital Manager Guru
    marketing/         # motor de e-mail marketing (engine, types, unsubscribe HMAC)
```

## Regras que já causaram bugs (não repita)

1. **Base UI ≠ Radix**: `PopoverTrigger`/`DropdownMenuTrigger`/`TooltipTrigger`
   NÃO aceitam `asChild`. Use `render={<Button ... />}` com children fora do render.
2. **`SelectValue` não resolve label do value**: passe children explícito
   `<SelectValue>{label}</SelectValue>`. `onValueChange` recebe `string | null`.
3. **`Accordion` (Base UI)**: sem prop `type`; só `defaultValue={[...]}`.
4. **Zustand**: NUNCA filtrar/mapear dentro do selector
   (`useCrmStore(s => s.x.filter(...))` = loop infinito de render).
   Selecione o array cru e derive com `useMemo` (ver `useOpportunitiesByContact`).
5. **lucide-react não tem ícones de marca** (Facebook/Instagram) — `ChannelIcon`
   usa badges de texto para essas redes.
6. Páginas são client components (`"use client"`) — ícones Lucide não podem ser
   passados de Server para Client component como prop.

## Convenções

- Todo texto de UI em **pt-BR**; datas mock fixas em 2026; moeda via `formatBRL`.
- Ações que dependem de backend: `toast.info("<ação> chega com o backend")`.
- Estilo: h1 `text-lg font-bold text-slate-900`; cards `rounded-xl border bg-white`;
  tabelas `text-xs`; botões `h-8 text-xs`; badge de sucesso
  `bg-emerald-100 text-emerald-700`; primário indigo (#6366f1); sidebar grafite
  (tokens `--lito-*` em `globals.css`).
- Commits em português, convenção `feat(modulo): descrição`.

## Backend (Supabase) — em andamento

Projeto Supabase dedicado (supabase.com, ref `boykcuhxmndlkjhojxhl`). Credenciais em
`.env.local` (NUNCA commitar; modelo em `.env.example`).

- Clientes em `src/lib/supabase/{client,server}.ts` (@supabase/ssr, chave publishable)
  e `src/lib/supabase/admin.ts` (service role — só em rotas server-side sem sessão de
  usuário: motor de automações, motor de marketing, webhook/sync de pagamentos da Guru).
- Schema em `supabase/migrations/0001_initial_schema.sql` — **aplicado em 2026-08-06
  via SQL Editor** e verificado: 11 tabelas, RLS deny-by-default, `REVOKE` total do
  `anon` (confirmado por teste REST: 42501 em todas as tabelas), políticas
  `TO authenticated` com checagem de tenant via `private.user_locations()`
  (SECURITY DEFINER em schema não exposto), UPDATE com USING+WITH CHECK,
  trigger de onboarding (signup → perfil + location + pipeline padrão com 9 fases).
- Migrações seguintes, todas com o mesmo padrão de RLS/políticas da 0001:
  `0002` (smart_lists, tasks, contact_fields, bulk_logs), `0003` (snippets +
  publicação realtime), `0004` (equipe: invitations, permissions, sees_all,
  protect_last_admin, convite no signup), `0005` (activation_steps), `0006` (cadastro
  por convite), `0007` (automações — schema + captura), `0008` (pagamentos: webhook da
  Guru), `0009` (pg_cron do motor de automações), `0010` (e-mail marketing), `0011`
  (pg_cron do marketing), `0012`/`0013` (assinaturas e sincronização ativa da Guru).
- Novas migrações: criar `supabase/migrations/000N_nome.sql` e aplicar via SQL Editor
  (ou `scripts/apply-migration.mjs`, que exige o CA do projeto em
  `scripts/supabase-ca.crt` — TLS sempre verificado, nunca desabilitar).
- Multi-tenant: TODA tabela de domínio tem `location_id`; toda política nova segue o
  padrão membership. Campo `location_members.only_assigned` reservado para o modo
  "ver apenas dados atribuídos" (ainda não aplicado nas políticas).

## E-mail transacional (Resend)

Convites de equipe saem com template próprio do Lito CRM (nada de e-mail padrão do
Supabase). Peças:

- `src/lib/email/invite-template.ts` — HTML com estilo inline (tabelas), pt-BR,
  cores da marca; exporta `renderInviteEmail()` com versões HTML e texto.
- `src/app/api/team/invite/route.ts` — cria o convite E envia o e-mail. Valida a
  sessão com `getUser()` e exige papel admin **no servidor**; a RLS reforça.
  Se `RESEND_API_KEY` faltar ou o envio falhar, o convite é criado e a resposta
  traz `warning` (a UI mostra aviso e o admin copia o link manualmente).
- Env: `RESEND_API_KEY` (privada), `EMAIL_FROM`, `NEXT_PUBLIC_APP_URL`.
  Provisionado via Vercel Marketplace (`vercel integration add resend/resend-email`);
  `vercel env pull` traz a chave. Projeto Vercel: `lito-crm`.
- **Domínio `news.litoaviation.com` verificado no Resend** (Hostinger DNS, região
  São Paulo, desde 2026-08-10) — entrega para qualquer destinatário. Remetente
  padrão: `Lito CRM <nao-responder@news.litoaviation.com>` (setado em `EMAIL_FROM`).
  O `onboarding@resend.dev` só era necessário antes da verificação (entregava só ao
  dono da conta) e não deve mais ser usado.

## Automações — EM CONSTRUÇÃO (leia antes de continuar)

Spec: `docs/superpowers/specs/2026-08-07-automacoes-design.md`
Plano: `docs/superpowers/plans/2026-08-07-automacoes.md` (8 tarefas)

**Arquitetura aprovada (híbrida):** triggers no Postgres capturam eventos e
enfileiram em `automation_runs`; `pg_cron` chama a cada minuto (via `pg_net`) a rota
protegida `/api/automations/tick` do Next; a rota executa os passos em TypeScript
com a service role e grava `automation_logs`.
Motivo de não usar Vercel Cron: no plano Hobby ele roda só 1×/dia.

### Estado (2026-08-10)

- ✅ **Tarefa 1+2** — migração `0007_automations.sql` **aplicada**: tabelas
  `automation_runs` / `automation_logs`, colunas `workflows.trigger_key|trigger_config|steps`,
  função `private.enqueue_automation(...)` (idempotência por `event_key` + anti-loop de
  5 min) e os triggers de captura em contacts, opportunities, messages, appointments
  + job diário `lito-aniversarios`.
- ✅ **Tarefa 3 — executor implementado**:
  - `src/lib/supabase/admin.ts` — cliente service role (lança se faltar env).
  - `src/lib/automations/types.ts` — `ActionKey`, `Step`, `RunContext`, `parseSteps()`,
    teto de 50 passos e backoff `[1, 5, 15]` minutos.
  - `src/lib/automations/actions.ts` — as 15 ações + `renderTemplate()` (`{{nome}}`,
    `{{email}}`, campos personalizados pelo próprio nome). `enviar-whatsapp`/`enviar-sms`
    retornam `skipped` (canal não conectado); `enviar-email` respeita `contacts.dnd`.
  - `src/lib/automations/engine.ts` — `processDueRuns()`: claim do run por update
    condicional (dois ticks simultâneos não pegam o mesmo run), log por passo,
    `waiting` na espera, `cancelled` se o workflow foi despublicado.
  - `src/app/api/automations/tick/route.ts` — POST protegido por `x-automation-secret`.
  - **`src/proxy.ts`: `api/automations` saiu do matcher** — a chamada é máquina-a-máquina
    (pg_cron), não tem sessão; sem isso o middleware redirecionava para /login (307).
  - **Verificado com as chaves reais:** sem header → 401; header errado → 401; header
    certo → `200 {"processed":0,"errors":0}` (motor conectou na service role e
    consultou a fila).
- ✅ **Tarefa 4 — pg_cron aplicado**: migração `0009_automation_cron.sql` — tabela
  `private.automation_config` (guarda `tick_url` + `secret` fora do alcance da API),
  função `private.automation_tick()` (chama a rota via `net.http_post`) e job
  `lito-automation-tick` (a cada minuto). Ativo em produção.
- ⏳ Tarefas 5–7 — builder configurável, aba de execuções/logs com teste manual,
  galeria de 5 modelos prontos.
- ⏳ Tarefa 8 — teste ponta a ponta, doc final.

### Como pausar/retomar o motor

```sql
select cron.unschedule('lito-automation-tick');  -- pausa
select jobname, active from cron.job;            -- conferir jobs
select * from public.automation_runs order by created_at desc limit 20;
```

## Email Marketing — CÓDIGO PRONTO (faltam passos manuais de produção)

Spec: `docs/superpowers/specs/2026-08-10-email-marketing-design.md`
Plano: `docs/superpowers/plans/2026-08-10-email-marketing.md`

Torna real a aba **Marketing → E-mails**. Arquitetura **espelha o motor de Automações**:
a campanha vira fila de destinatários; `pg_cron` chama `/api/marketing/tick` a cada minuto;
a rota envia em lotes de 100 via **Resend Batch** com a service role e grava status.

**Implementado (branch `feat/email-marketing`):**
- Migração `0010_email_marketing.sql` **aplicada** (tabelas `email_campaigns`,
  `email_campaign_recipients`, coluna `contacts.marketing_opt_out`, funções
  `materialize_recipients`/`apply_email_event` + wrappers públicos `publish_campaign`,
  `add_campaign_recipients`, `ingest_email_event`).
- Motor `src/lib/marketing/{engine,types}.ts`; template `src/lib/email/marketing-template.ts`;
  unsubscribe HMAC `src/lib/marketing/unsubscribe.ts`.
- Rotas: `POST /api/marketing/tick` (x-automation-secret; fora do matcher do proxy),
  `POST /api/marketing/campaigns/[id]/{send,test}` (autenticadas),
  `POST /api/marketing/resend-webhook` (Svix), `GET|POST /api/marketing/unsubscribe`.
- Repo `db/campaigns.ts`; UI `src/components/marketing/` (lista, composer Tiptap, detalhe).
  A **lista inteligente** é resolvida no client (mesmo `matchesConditions` da tela de
  Contatos) e enviada como `contactIds` para `add_campaign_recipients`.
- Migração `0011_marketing_cron.sql` (job `lito-marketing-tick`, `private.marketing_config`).
- Libs: `@tiptap/*`, `svix`. Verificado local: tick sem header → 401; com header → 200.

**Passos manuais que FALTAM para ligar em produção:**
1. `RESEND_WEBHOOK_SECRET` no `.env.local` e na Vercel (production+preview+development).
2. Resend → **Webhooks** → criar endpoint `https://lito-crm.vercel.app/api/marketing/resend-webhook`
   (eventos email.delivered/opened/clicked/bounced/complained) e **ativar tracking** de
   abertura/clique no domínio; copiar o signing secret para `RESEND_WEBHOOK_SECRET`.
3. Aplicar `0011` no SQL Editor trocando o placeholder pelo `AUTOMATION_SECRET`.

**Fora da v1:** A/B test, drip, upload próprio de imagens (imagem por URL por enquanto),
inserção de trechos no composer (só variáveis por ora).

### Como pausar o envio de marketing

```sql
select cron.unschedule('lito-marketing-tick');   -- pausa o cron
update public.email_campaigns set status = 'paused' where id = '<id>';  -- pausa uma campanha
```

## Pagamentos — Guru (webhook + sincronização ativa a cada minuto)

A Guru é a central de pagamentos do Lito CRM (vendas, assinaturas). Aba **Pagamentos**
mostra dados mock só enquanto a Guru não estiver conectada; conectada, Pagamentos e
Assinaturas passam a mostrar dados reais.

**Duas fontes alimentando as mesmas tabelas** (upsert, não log — a mesma
venda/assinatura é vista de novo a cada mudança de status):
1. **Webhook** (`/api/webhooks/guru`) — a Guru envia em tempo real. Autenticado pelo
   `api_token` do corpo (= Account Token da conta, obtido em Minha Conta → API no
   painel da Guru), comparado com `payment_credentials.webhook_token`.
2. **Sincronização ativa** (`/api/integrations/guru/sync`) — `pg_cron` chama a cada
   minuto (migração `0013`); a rota consulta `digitalmanager.guru/api/v2/{transactions,subscriptions}`
   (header `Authorization: Bearer {user_token}` — o **User Token**, obtido em Meu
   Perfil → Tokens API, diferente do Account Token) pra cada empresa conectada e faz
   upsert. Primeira sincronização: assinaturas sem filtro de data (tudo) e vendas dos
   últimos 175 dias (máximo que a API da Guru permite por filtro de data); depois disso,
   só o que mudou desde o último sync. Protegida por `x-guru-sync-secret`.

**Peças:**
- `src/lib/integrations/guru.ts` — cliente REST (paginação por cursor, backoff em 429).
- `src/lib/integrations/guru-map.ts` — mapeamento Guru → nossas tabelas, com os nomes
  de campo confirmados na referência oficial (`api.docs.digitalmanager.guru`) —
  webhook e REST usam o mesmo shape de `Transaction`/`Subscription`, exceto que datas
  vêm como unix timestamp na API REST e string ISO no webhook.
- `src/lib/data/guru.ts` — `classifyGuruStatus`/`guruStatusLabel`, vocabulário exato
  de status (aprovada/atrasada/cancelada/reembolsada/chargeback/...) copiado da doc.
- `src/lib/data/repos/db/payments.ts` — repo real (`useGuruIntegration`,
  `usePaymentEvents`, `usePaymentSubscriptions`), Realtime nas duas tabelas.
- Migrações: `0008` (`payment_credentials`, `payment_events`, webhook), `0012`
  (`payment_subscriptions`), `0013` (colunas de sync + `last_synced_at`/`sync_started_at`
  como trava anti-corrida + `cron.schedule('lito-guru-sync', '* * * * *', ...)`).
- Env: `GURU_SYNC_SECRET` (privada, gerada por sessão — não é a mesma coisa que o
  Account/User Token da Guru, que ficam por empresa em `payment_credentials`).

**Conectar:** Pagamentos → Integrações → card Guru → cola a URL do webhook no painel
da Guru + os dois tokens no diálogo do CRM. Sem o User Token, só o webhook funciona
(sem a sincronização de 1 minuto).

### Como pausar a sincronização

```sql
select cron.unschedule('lito-guru-sync');
select * from public.payment_credentials where provider = 'guru';
```

## Padrão de migração módulo a módulo (IMPORTANTE)

A estratégia é deixar **uma tela inteira funcional por vez**. Repos reais ficam em
`src/lib/data/repos/db/` (store Zustand carregado do Supabase + ações otimistas);
os módulos ainda não migrados continuam importando dos repos mock em
`src/lib/data/repos/`. Repos db existentes:

- `db/contacts.ts` — contatos, equipe (profiles+membership), CRUD, import em massa
- `db/contacts-module.ts` — smart lists, tarefas, campos personalizados, bulk_logs
  (`logBulk()` registra qualquer ação em massa)
- `db/pipeline.ts` — pipelines/fases/oportunidades, drag&drop persistente,
  gestão de pipelines e fases, mover/excluir em massa
- `db/conversations.ts` — conversas/mensagens + Realtime, trechos
- `db/appointments.ts` — compromissos do calendário
- `db/team.ts` — membros, convites, permissões; `useMyMembership().can(moduleKey)`
  é o guard de navegação (admin sempre true; usuário: só bloqueia se explicitamente
  `false` — membros antigos com `{}` continuam vendo tudo)
- `db/campaigns.ts` — campanhas de e-mail marketing
- `db/payments.ts` — integração Guru (vendas, assinaturas)

## Estado atual / próximos passos

- ✅ Front-end: 19 módulos navegáveis, todas as sub-abas com conteúdo.
- ✅ Backend F1: schema multi-tenant com RLS aplicado e verificado (migração 0001).
- ✅ Backend F2a: login/cadastro (/login, com vinheta animada) + proxy.ts protegendo
  todas as rotas (getUser server-side) + logout no avatar do topbar.
- ✅ Backend F2b: módulo **Contatos 100% funcional** com Supabase — lista/CRUD/edição,
  listas inteligentes, tarefas, empresas (derivadas), campos personalizados (aparecem
  no cadastro e detalhe), importação/exportação CSV, log real de ações em massa.
- ✅ Backend F2c: módulo **Leads/Pipelines 100% funcional** — kanban real com drag &
  drop persistente (status ganho/perda deduzido pela fase), criar oportunidade,
  vista lista com ações em massa, gestão completa de pipelines/fases,
  oportunidades reais no detalhe do contato.
- ✅ Backend F2d: módulo **Conversas 100% funcional com Realtime** (migração 0003:
  snippets + publicação realtime) — enviar/agendar/nota interna persistem, nova
  conversa por contato+canal, trechos reais usados no composer, estatísticas
  calculadas, badge "Ao vivo". Repo: `db/conversations.ts`. Ações manuais e links
  de acionamento = empty states (dependem de Automações real).
- ✅ Backend F2e: **Dashboard** com widgets calculando sobre dados reais
  (adapters `useDbPipelines/useDbOpportunities/useDbPipeline` em `db/pipeline.ts`).
- ✅ Backend F2f: módulo **Calendários** real — compromissos do banco (repo
  db/appointments.ts), grade semanal com navegação e "Hoje", criar/excluir
  compromisso (com contato vinculado), lista futuro/passado. Sync Google = futura.
- ✅ **Cadastro fechado** (migração 0006): só entra quem tem convite pendente — o
  trigger de signup aborta a transação, então nem chamando a API de auth direto
  a conta é criada. Reabrir: `update private.app_settings set signup_mode = 'open';`
- ✅ Backend F2h: **Calendários**, **Configurações** (empresa/perfil reais, sidebar
  mostrando a empresa do banco) e **Checklist de ativação** persistente (migração 0005).
- ✅ **Automações** — motor + pg_cron em produção (ver seção própria acima).
- ✅ Backend F2g: **Equipe e permissões** (migração 0004) — convites por e-mail
  (trigger de signup vincula à empresa que convidou em vez de criar nova),
  papéis admin/usuário, permissões por módulo (jsonb em `location_members`),
  modo "ver apenas dados atribuídos" aplicado nas políticas RLS de contacts e
  opportunities via `private.sees_all()`, trigger `protect_last_admin` impedindo
  a empresa ficar sem administrador. Sidebar respeita permissões; a tela
  /configuracoes/equipe é restrita a admins.
- ✅ **Pagamentos** — integração real com a Guru, webhook + sincronização a cada
  minuto (ver seção própria acima).
- ⏳ **Email Marketing** — código pronto, faltam passos manuais de produção (ver
  seção própria acima).
- ⏳ Próximo: Automações reais (Edge Functions) tarefas 5–8, Agentes de IA.
- ⏳ Backlog: personalizar template/remetente dos e-mails de auth do Supabase
  (pedido do Gabriel), storage (Mídia Drive/arquivos), dark mode, mobile,
  WhatsApp (Cloud API / Evolution API).
