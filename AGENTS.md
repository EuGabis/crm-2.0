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
5. **Migrações** (um banco só): o nome é **`AAAAMMDDHHMM_nome.sql`**, e antes de
   aplicar rode **`npm run db:apply <arquivo>`** (ou no mínimo `npm run db:check`).
   Toda migração **idempotente** (`... if not exists`, `drop policy if exists`).
   Diga no commit o que aplicar no SQL Editor.
   ⚠️ **A regra que estava aqui — "`git pull` e use o próximo número livre" — ERA
   O BUG**, não a solução: o número saía de um contador COMPARTILHADO que os dois
   Claudes leem antes de qualquer um escrever. Os dois puxam, os dois veem 0085
   como o maior, os dois escolhem 0086. Resultado medido: **12 números
   duplicados** (0014, 0015, 0016, 0019, 0056, 0078, 0079, 0080, 0086, 0087,
   0089, 0090). Data-hora não tem contador para ler. Ver "## Guarda das
   migrações" abaixo.
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
Configurações (empresa/perfil) e Pagamentos (via Guru — ver
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
  app/(app)/           # 18 módulos, cada pasta = 1 item da sidebar
    dashboard/  conversas/  calendarios/  contatos/ (+[id])  leads/
    pagamentos/  ai-studio/  agentes-ia/  marketing/  automacoes/ (+[id] builder)
    sites/  assinaturas/  midia/  reputacao/  relatorios/  marketplace/
    whatsapp/  configuracoes/ (layout próprio + 16 sub-páginas)
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
7. **O PostgREST corta a resposta no "Max rows" do projeto (1000) sem erro e sem
   aviso.** `select("*")` numa tabela que cresceu devolve UMA PÁGINA e o app acha
   que é tudo. Foi o que apagou o nome do contato em TODAS as conversas depois da
   importação do CRM antigo (365 → 5.615 contatos: o `order by created_at desc`
   trouxe os 1000 importados e nenhum dos antigos, que são os que têm conversa;
   `contacts.find(...)` no inbox caía no fallback "Contato"). Ao carregar tabela
   que pode passar de mil linhas, pagine com `.range()` — e **desempate a ordem
   por `id`**: importação grava 500 linhas por transação, então as 500 saem com o
   MESMO `created_at` e ordem instável faz a paginação pular linhas. Ver
   `fetchAllContacts` em `db/contacts.ts`.
8. **Importação em massa vai em LOTES.** O papel `authenticated` tem
   `statement_timeout = 8s`: um `insert` único com dezenas de milhares de linhas
   morre em 57014 (a RLS roda o `with check` linha a linha). Ver `bulkInsert`
   (lotes de 500, sem `.select()`, lote que falha reparte ao meio).

## Revalidação ao trocar de página (`RouteRevalidator`)

As stores carregam **uma vez por sessão** (`if (loaded || loading) return`) —
decisão certa para não repetir consulta a cada navegação, e que virou problema
quando passou a existir quem escreve no banco sem ser o usuário: o **bot** criou
um lead e o card só aparecia depois de um F5.

`components/layout/route-revalidator.tsx` mora no shell e, ao mudar o
`pathname`, chama o `reload()` das stores daquela rota (`/leads` e `/dashboard` →
funil; `/contatos` → contatos + módulo; `/calendarios` → agenda).

- Num lugar só, e não um `useEffect` de reload por página: espalhado, a próxima
  tela nasceria sem revalidação e ninguém lembraria do porquê.
- **`reload()` ≠ `load()`**: não toca em `loading`/`loaded`, então nenhuma tela
  volta para "Carregando..." — e ignora erro de rede, porque dado velho na tela é
  melhor do que tela vazia.
- A **primeira montagem não revalida**: o `load()` da página acabou de buscar, e
  ler de novo no mesmo instante é desperdício.
- **Conversas fica de fora** de propósito: já tem Realtime + `useInboxLiveSync`.
- Ao criar store nova com guard de `loaded`, considere expor `reload()` e
  registrar aqui.

## Conversas: refresh silencioso (por que Realtime não bastava)

Queixa real: "para alguns usuários a conversa não atualiza, preciso dar F5".

Causa: o `.subscribe()` do canal `lito-inbox` só tratava `SUBSCRIBED`. Quando o
websocket morre — notebook suspenso, wi-fi trocando de rede, proxy corporativo
cortando conexão ociosa, token expirando — o canal fica em
`CLOSED`/`CHANNEL_ERROR`, **ninguém reinscrevia**, e o selo continuava dizendo
"Ao vivo" enquanto nada chegava. Só o F5 resolvia.

Duas peças, em `db/conversations.ts`:

1. **`subscribeInbox()`** virou função chamável de novo. Estado final que não
   seja `SUBSCRIBED` marca `realtime: "off"` (o selo "Ao vivo" apaga — o usuário
   precisa saber que a lista pode estar velha) e reagenda a reinscrição em 5 s
   (esperar importa: reinscrever em rajada durante queda de rede multiplica o
   erro).
2. **`useInboxLiveSync()`** — montado SÓ em `/conversas`. Varre a cada 15 s, ao
   VOLTAR PARA A ABA (o navegador congela timers em aba oculta, então o
   intervalo não é confiável em segundo plano) e no evento `online`. Em aba
   oculta a varredura é pulada de propósito.

`syncInboxDelta()` é o que faz o refresh ser **imperceptível**: busca só o que
chegou depois do cursor e **acrescenta** — nunca troca a lista, nunca toca em
`loading`. Sem isso haveria piscada, spinner e salto de scroll. Depois emenda
apenas as conversas afetadas (prévia/não lidas/reabertura moram na linha da
conversa, não na mensagem).

⚠️ O cursor tem **sobreposição de 30 s**: com `created_at > cursor`, duas
mensagens gravadas no mesmo instante fariam a segunda ser pulada para sempre. As
repetidas que a janela traz são descartadas pelo filtro de id. E o cursor compara
sempre `at` (created_at) — misturar `dispatchedAt` o empurraria além da coluna
consultada, criando o salto que se quer evitar.

## Barra superior — Suporte, Webphone e o botão verde SAÍRAM

Os três primeiros elementos da tela (2026-08-24, a pedido do Gabriel) eram os
três que menos entregavam: **Suporte** abria um painel de contato que não abre
ticket nenhum, **Webphone** é um teclado sem provedor de voz (não completa
chamada) e o **botão verde** só reabria o MESMO popover do Webphone.

- O **painel do webphone continua** em Configurações → Telefonia — é onde ele
  volta a ser oferecido no dia em que houver VoIP. `SupportPanel` e
  `WebphonePanel` continuam no repositório; só deixaram de ser montados na
  topbar.
- Quem **ligava pelo popover** — o botão "Ligar" do card do funil e o do
  cabeçalho da conversa — passou a abrir o **discador do aparelho**
  (`telHref()`, em `src/lib/phone.ts`). Não é degradação: é o único caminho que
  hoje completa a ligação. O helper mora em `lib/` porque os dois botões
  normalizariam o telefone digitado à mão (parênteses, hífen, "+55") cada um do
  seu jeito.
- `useWebphone` mantém `open`/`setOpen`/`callContact` mesmo sem quem chame de
  fora: o estado é global justamente por causa desses gatilhos remotos, e
  removê-los agora seria refazer tudo quando o provedor de voz entrar.

## Sidebar minimizável

Botão **"Minimizar menu"** no pé da barra (junto de Configurações — é ajuste de
tela, não navegação; no topo competiria com o bloco da empresa). Fechada fica com
64 px: só os ícones, com o rótulo no tooltip. **Não é `w-0`** de propósito —
sumir com a navegação obrigaria a reabrir para trocar de módulo, o oposto do
ganho.

- A preferência é por DISPOSITIVO (`localStorage`, chave
  `lito.sidebar.collapsed`): num notebook de 13" se quer fechada, no monitor
  grande aberta; guardar "na conta" imporia a mesma decisão nos dois.
- Minimizada, o nome de cada item aparece em **tooltip** ao passar o mouse, com
  o ícone crescendo um pouco (a resposta ao mouse vem antes do rótulo chegar).
  ⚠️ Duas coisas que fizeram a primeira versão NÃO mostrar o rótulo:
  1. **Base UI não é Radix** (regra nº 1 aqui): o elemento vai em `render` SEM
     filhos e os filhos são passados ao `TooltipTrigger`. A v1 fez o contrário
     (`render={link}` com os filhos dentro do `Link`).
  2. Sem `TooltipProvider`, cada tooltip usa o atraso padrão e a barra parece
     travada. O provider entra **só no modo minimizado**, envolvendo a barra:
     o atraso passa a ser compartilhado — o primeiro rótulo espera 150 ms (não
     pisca ao atravessar a barra com o mouse) e, percorrendo os ícones, os
     seguintes aparecem na hora.
  O tooltip é **portal**, e é isso que o faz funcionar aqui: o `<nav>` tem
  `overflow-y-auto`, então um rótulo posicionado ao lado com CSS seria recortado
  pela própria barra.
- Lida com **`useSyncExternalStore`**, não `useState` + efeito: o servidor não
  tem localStorage (o snapshot do servidor é "aberta" e o React reconcilia na
  hidratação, sem mismatch), `setState` dentro de efeito dispara renderização em
  cascata, e de graça o evento `storage` **sincroniza duas abas** do CRM. O
  evento nativo não dispara na aba que escreveu — daí o conjunto de ouvintes no
  módulo.

## Confirmação de ação (nunca `window.confirm`)

Toda ação que pede confirmação usa o diálogo DO CRM:
`src/components/shared/confirm.tsx`, com o `ConfirmProvider` montado no shell
(`(app)/layout.tsx`).

```tsx
const confirm = useConfirm();           // no corpo do componente
if (!(await confirm({ title: `Excluir "${nome}"?`, description: "Não tem desfazer.",
                      confirmLabel: "Excluir", destructive: true }))) return;
```

- A API é **promise** de propósito: no ponto de uso a troca é linha por linha a
  partir do `if (!window.confirm(x)) return;`, sem espalhar estado de diálogo
  pelos 13 arquivos que pediam confirmação.
- `destructive: true` pinta o botão de vermelho e põe o ícone de alerta —
  exclusão, desconexão, cancelamento. O `window.confirm` dava o mesmo botão para
  "Salvar" e para "Excluir 12 contatos".
- **Título diz O QUE, `description` diz o RISCO.** Não empilhe "Essa ação não
  pode ser desfeita" no título.
- Fora do provider o hook cai no `window.confirm` — componente reaproveitado em
  tela sem provider continua funcionando em vez de quebrar em runtime.
- ⚠️ **Não volte a usar `window.confirm`**: além do visual do navegador ("o site
  X diz"), ele não distingue ação destrutiva e não aceita formatação.
- Ainda restam **8 `window.prompt`/`alert`** (ex.: "Nome da nova pasta") — mesma
  cara de navegador, ainda não convertidos.

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
- ⚠️ **`supabase_migrations.schema_migrations` NÃO é a lista do que foi aplicado**:
  ela só registra o que passou por CLI/MCP; migração colada no SQL Editor não
  aparece lá. Para saber se o banco está em dia, **confira o OBJETO** de cada
  migração (`to_regclass('public.<tabela>')`, `information_schema.columns`,
  `pg_policies`, `pg_proc`), não o histórico. Foi assim que se descobriu, em
  2026-08-17, que a **0036** (view `payment_integration_status`) nunca tinha sido
  aplicada, embora o `AGENTS.md` a desse como pronta desde a criação — o app não
  quebrava porque `db/payments.ts` tem a rede de segurança do `hasGuruData`.
  Aplicada e conferida como usuário comum: vê o estado da integração, não vê token.
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

## Logo da empresa (Whitelabel)

Logo customizável da empresa, exibido no topo da sidebar, perfil e e-mail de convite.

**Peças:**
- Bucket público `branding` + coluna `locations.logo_url` (migração `0034_company_logo.sql`).
- Upload em `/configuracoes/perfil` via `accountActions.uploadCompanyLogo` (valida PNG/JPG/WEBP/SVG ≤2MB, caminho `{location_id}/logo-*`, admin-only pela RLS de locations).
- Exibido no perfil, no topo da sidebar (no lugar do símbolo, mantendo `brand.name`) e no e-mail de convite (`InviteEmailData.logoUrl`).
- Sem env nova.

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
   minuto (`private.guru_sync_tick()`, migração `0014`); a rota consulta
   `digitalmanager.guru/api/v2/{transactions,subscriptions}` (header
   `Authorization: Bearer {user_token}` — o **User Token**, obtido em Meu Perfil →
   Tokens API, diferente do Account Token) pra cada empresa conectada e faz upsert.
   Primeira sincronização: assinaturas sem filtro de data (tudo) e vendas dos
   últimos 3 dias (175 dias — o máximo que a API da Guru permite por filtro de
   data — estourava os 60s do Vercel numa conta com histórico grande; ver
   `MAX_BACKFILL_DAYS` na rota); depois disso, só o que mudou desde o último
   sync. Protegida por `x-guru-sync-secret`.
3. **Backfill histórico** (retroativo, além dos 3 dias iniciais) — a partir de
   onde o incremental já cobre, anda pra trás 7 dias por tick
   (`HISTORY_CHUNK_DAYS`) até `HISTORY_START` (01/06/2024, fixo no código —
   ajustar lá se precisar de outra data). Progresso em
   `payment_credentials.history_backfill_cursor`/`history_backfill_done`
   (migração `0017`), visível no card da Guru na aba Integrações.

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
  como trava anti-corrida), `0014` (**mesmo padrão de `private.automation_config`** —
  `private.guru_sync_config` guarda `sync_url`/`secret` fora de qualquer arquivo
  versionado; `private.guru_sync_tick()` lê de lá e chama a rota via `net.http_post`;
  o `cron.schedule('lito-guru-sync', ...)` só referencia a função, sem segredo em texto
  puro no SQL. **Segredo real setado à mão** via
  `update private.guru_sync_config set secret = '<valor>';` no SQL Editor — nunca commitar.
- Env: `GURU_SYNC_SECRET` no Next (Vercel) — precisa ser **o mesmo valor** salvo em
  `private.guru_sync_config.secret`; se um lado rotar sem o outro, o sync volta a
  falhar com 401 (já aconteceu — checar `net._http_response.status_code` no Supabase
  ao investigar "dados da Guru não atualizam").

**Conectar:** Pagamentos → Integrações → card Guru → cola a URL do webhook no painel
da Guru + os dois tokens no diálogo do CRM. Sem o User Token, só o webhook funciona
(sem a sincronização de 1 minuto).

**Detalhe do produto** (aba Produtos → clicar num card) — espelha o painel da Guru:
Detalhe (dados do produto + KPIs de `payment_sales_monthly`), Ofertas (ao vivo,
`GET /api/v2/products/{id}/offers`, só quando a aba abre) e Vendas (do nosso
`payment_events`, casando `product_name` EXATO — o `ilike` do filtro livre arrastaria
produtos de nome prefixo). Spec: `docs/superpowers/specs/2026-08-14-produto-detalhe-design.md`.

⚠️ **Rotas que leem `payment_credentials`** usam `resolveGuruUserToken()`
(`src/lib/integrations/guru-token.ts`): a sessão do usuário AUTORIZA (membership) e a
service role LÊ o token. A tabela é admin-only desde a 0008 — ler com a sessão do
usuário faz a tela responder "Guru não conectada" para todo usuário não-admin (já
aconteceu duas vezes, em camadas diferentes).

### Como diagnosticar a sincronização

```sql
-- Cada chamada do cron e o status HTTP que a rota respondeu:
select status_code, created, content from net._http_response order by created desc limit 5;
-- Deve ser 200. 401 quase sempre é GURU_SYNC_SECRET (Vercel) != guru_sync_config.secret (Supabase).
```

### Como pausar a sincronização

```sql
select cron.unschedule('lito-guru-sync');
select * from public.payment_credentials where provider = 'guru';
```

## Detalhe do lead (Leads → clicar no card) — cruzamento com a Guru

Clicar no card do funil (ou na linha, na vista lista) abre **Detalhe do lead**
(`src/components/pipeline/lead-detail-dialog.tsx`) com três abas: **Resumo**
(contato + lead + outros leads do contato + tarefas + compromissos),
**Pagamentos** (histórico do mesmo comprador na Guru — só para quem tem acesso
ao módulo, via `useMyMembership().can("pagamentos")`) e **Comentários** (as
notas internas do contato + escrever outra).

**Cruzamento CRM ↔ Guru** (migração **0048**, aplicada em 2026-08-17): a ordem é
**CPF/CNPJ → telefone → e-mail → nome**, a primeira chave que acha algo ganha, e
a tela mostra QUAL casou (casamento por nome vem com aviso de chave fraca —
homônimo existe). Nada casou? o vazio diz quais chaves foram tentadas, em vez de
sugerir que o cliente nunca comprou.

- Quem decide é o banco: `public.lead_payment_profile(location, doc, phone,
  email, name, limit)` devolve `{match_key, guru_contact, sales, subscriptions,
  totals}` numa chamada. No client, cada passo seria uma ida e volta e o rótulo
  poderia sair de uma consulta com as vendas vindo de outra.
- ⚠️ **A função é `security definer` (migração 0049) e a checagem de empresa é
  a primeira linha dela** (`p_location not in (select private.user_locations())`
  → devolve vazio). Ela NASCEU sem definer, para a RLS de cada tabela valer
  sozinha — e a tela morria com `canceling statement due to statement timeout`.
  Motivo: sob RLS, um `where` que chama função **não-leakproof**
  (`private.phone_key`, `private.doc_key`, `lower`) não pode ser avaliado antes
  das políticas, então sai de baixo do índice funcional e vira **Seq Scan** nas
  ~25 mil vendas calculando jsonb + regexp linha a linha (medido como
  `authenticated`: 7,7 s; como `postgres`, com RLS desligada, 0,2 ms — foi por
  isso que passou no primeiro teste). Depois da 0049: 102 ms, e passar o
  `location_id` de outra empresa devolve vazio (conferido como `authenticated`).
  Mesmo padrão de `public.find_contact_by_phone` (0047). **Ao mexer nesta
  função, mantenha a checagem de membership no topo** — sem ela, `security
  definer` significa "qualquer autenticado lê o pagamento de qualquer empresa".
- **Sem coluna nova em `payment_events`/`payment_subscriptions`**: documento e
  telefone do comprador não existem como coluna (0008/0012) mas estão em
  `raw->'contact'` em 100% das linhas — a migração indexa a EXPRESSÃO que lê do
  `raw` (0,2 ms por busca; ~20 ms a chamada inteira). Coluna exigiria backfill e
  mais um lugar para o mapeamento da Guru esquecer de preencher.
- `private.phone_key` (0047, da deduplicação por telefone) é **reusada como
  está**; o documento ganhou a irmã `private.doc_key` (só dígitos), porque o CRM
  recebe o CPF pontuado e a Guru devolve sem pontuação.
- `contacts.doc` é coluna de primeira classe (não campo personalizado): é a
  chave principal e precisa de índice. Aparece no cadastro e no detalhe do
  contato.
- Comentário continua sendo **mensagem interna da conversa** (`messages.internal`)
  — é onde a nota já é gravada pela ação `nota-interna` das automações e pelo
  botão "Nota" do card. Tabela nova faria a nota de um lugar não aparecer no
  outro. A listagem (`db/notes.ts`) usa consulta própria e enxuta: o store de
  Conversas carrega todas as mensagens da empresa.
- Os totais somam o histórico inteiro, não o array exibido (limitado a 200).
- ⚠️ O corpo do card é o punho do arrasto. O `click` do navegador dispara mesmo
  depois de um arrasto que voltou para perto do início, então o card guarda onde
  o ponteiro desceu e só abre o detalhe se soltou a menos de 6 px de lá.
- `GuruStatusBadge`/`guruStatusBadgeClass` saíram de `pagamentos/page.tsx` para
  `src/components/payments/status-badge.tsx` (duas cópias da tabela de cores
  divergiriam).
- **O documento se prende ao contato sozinho** quando o cruzamento identifica o
  comprador: `contacts.doc` vazio + casamento por chave FORTE (documento,
  telefone ou e-mail) → grava. Não é cosmética: o documento é a chave principal
  da cascata, e uma vez preso o cruzamento deixa de depender de telefone/e-mail,
  que mudam. ⚠️ Casamento por **nome não grava sozinho** — homônimo existe, e
  carimbar o CPF de outra pessoa é pior que o campo vazio, porque a partir dali
  a cascata usaria a chave errada como se fosse a mais confiável; nesse caso a
  tela oferece o botão "Vincular ao contato". Documento já preenchido nunca é
  sobrescrito. A fonte é o contato da Guru e, quando ele está atrasado na
  sincronização, a própria venda (`raw->contact->doc`) — conferido: de 8 leads
  reais, 2 só tinham o documento na venda.
- **Onde o mesmo cruzamento aparece** (tudo em
  `src/components/payments/lead-payments-panel.tsx`, um componente só para não
  divergirem): `PaymentsProfileView` (visão larga) no detalhe do lead,
  `ContactPaymentsPanel` no cadastro do contato e `ContactPaymentsSummary` na
  **barra lateral das Conversas** (seção "Resumo pagamentos", abaixo de Campos
  personalizados) — esta última é enxuta de propósito: a barra tem ~300 px, e a
  grade de 4 KPIs com tabela de 4 colunas vira um amontoado ilegível ali.
  Mostra assinaturas + as 3 compras mais recentes + "Ver detalhes completos".
- O acordeão da barra lateral é **controlado**: "Resumo pagamentos" só monta (e
  só consulta a Guru) quando o usuário abre a seção — senão seria uma consulta
  por conversa aberta, o dia inteiro.
- **`/pagamentos` aceita `?tab=<aba>&busca=<termo>`** (a aba só é aceita se
  existir em `TABS`; URL torta não pode deixar a página em branco). É o destino
  do "Ver detalhes completos", que manda o e-mail do comprador — sem isso o
  atalho cairia numa lista de 7 mil contatos para o usuário procurar à mão.
  `useSearchParams` obrigou o limite de `Suspense` na página (mesmo padrão de
  `/leads`).
- Sem env nova. Spec: `docs/superpowers/specs/2026-08-17-lead-detalhe-design.md`.

## Painéis da barra lateral das Conversas (Tarefas/Observações/Compromissos/Arquivos)

Os quatro ícones do trilho à direita eram decoração (empty state fixo,
"Adicionar" respondendo `toast.info`). Hoje mexem no dado real, em
`src/components/inbox/contact-side-panels.tsx`, sem backend próprio:
Tarefas → `tasks` (0002) · Observações → mensagem interna da conversa ·
Compromissos → `appointments` · Arquivos → anexos das conversas do contato
(bucket da 0019).

- **Indicadores:** cada ícone do trilho leva um selo com a contagem, e o painel
  Contato abre com um bloco âmbar de pendências (tarefas em aberto + próximo
  compromisso). Tarefas conta só as **pendentes** — selo que nunca zera vira
  enfeite. Tarefas/compromissos saem de stores já carregadas; comentários e
  arquivos vêm de `useContactActivityCounts`, duas contagens `head: true` (o
  Postgres devolve o total, nenhuma linha trafega) — o painel monta em toda
  conversa aberta, baixar 200 notas para escrever "3" seria caro à toa.
- **Lembrete de tarefa** (migração **0050**, aplicada): `tasks.reminder_minutes`,
  irmã da 0042. O popup do shell virou `components/calendar/reminders.tsx`
  (`<Reminders />`) e cobre compromisso E tarefa — um componente só porque a
  mecânica é a mesma e dois popups independentes abririam um por cima do outro
  no mesmo canto. Tolerância de atraso da tarefa é de **12h** (a do compromisso
  é 15 min): reunião passa, tarefa continua pendente o dia inteiro, e com 15 min
  quem abrisse o CRM às 9h20 nunca veria o lembrete das 9h. O "já avisei" da
  tarefa usa a chave `task-<id>` no mesmo `localStorage` (compromisso mantém o
  id puro, que é o que já está gravado na máquina de quem usa o CRM).
- O **sino** também lista tarefa pendente vencendo em 24h — e a **vencida entra
  de propósito**, é justamente a que não pode ser esquecida.
- ⚠️ `conversationActions.sendMedia` tem `internal` (padrão false): o upload do
  painel Arquivos **não despacha nada** para o cliente — quem entrega no
  WhatsApp é a rota `send-media` chamada pelo composer. Sem essa marca o arquivo
  apareceria no thread com cara de enviado.
- **Excluir observação** (migração **0051**, aplicada): `messages.created_by` +
  policy `autor exclui a propria nota`. A 0040 tinha deixado DELETE em
  `messages` só para admin — certo para mensagem de cliente, atrito puro para a
  nota que o próprio atendente acabou de escrever com erro de digitação. A
  policy nova exige `internal is true` E `created_by = auth.uid()`, então
  mensagem de cliente segue intocável para quem não é admin; a da 0040 continua
  valendo por cima (policies permissivas somam). Notas anteriores à migração têm
  `created_by` nulo e seguem admin-only — não dá para adivinhar o autor depois.
  Conferido como `authenticated`: própria nota apaga (1 linha), nota alheia 0,
  mensagem de cliente 0, e admin apaga qualquer uma.
  ⚠️ `conversationActions.removeMessage` confere as LINHAS devolvidas, não o
  `error`: DELETE recusado pela RLS não vem com erro, e a tela diria "excluída"
  com a nota ainda no banco.
- A seção **"Campos personalizados" saiu** da barra lateral: era um cabeçalho
  com nada embaixo em toda empresa que não criou campo. Os campos que existirem
  aparecem junto do bloco Contato (nada de dado se perdeu); criar/editar campo
  continua em Configurações e no cadastro do contato.

## WhatsApp — Meta Cloud API (número real, inbox de 2 vias)

Módulo **`/whatsapp`** ("Canais de atendimento") integrado à Cloud API oficial da
Meta (não é Evolution API/QR code). Fluxo: mensagem do celular → webhook → grava em
Conversas → aparece no inbox via Realtime; resposta pelo inbox → rota de envio →
Cloud API → celular.

**Peças:**
- `POST /api/whatsapp/webhook` — recebe mensagens/status da Meta. Fora do matcher
  do proxy (chamada máquina-a-máquina, sem sessão). GET faz o handshake
  (`hub.verify_token` = `WHATSAPP_VERIFY_TOKEN`); POST valida a assinatura HMAC do
  corpo cru (`x-hub-signature-256`, chave `WHATSAPP_APP_SECRET`), resolve o canal
  pelo `phone_number_id` do payload, cria/atualiza contato e conversa e grava a
  mensagem com a service role — idempotente (índice único parcial em
  `wa_message_id`). Eventos de status (`sent`/`delivered`/`read`) atualizam
  `messages.status` pelo mesmo `wa_message_id` (a tabela é `replica identity full`
  pra isso chegar ao vivo no inbox).
- `POST /api/whatsapp/send` — autenticada (RLS garante membership). Texto livre
  só dentro da janela de 24h (última mensagem de entrada); fora dela responde 409
  `needsTemplate` e exige `template`. Respeita `whatsapp_channels.daily_limit`
  (conta saídas do canal no dia).
- `GET|POST /api/whatsapp/templates` — lista/consulta templates aprovados na Meta.
- `src/lib/whatsapp/client.ts` — cliente da Cloud API (`sendText`, `sendTemplate`).
- Repo `db/whatsapp.ts`; UI do módulo `/whatsapp` (criar/editar canal) e composer
  do inbox (envia de verdade, mostra tique de status, pede template fora da janela).
- Migração `0022_whatsapp.sql` — tabela `whatsapp_channels` (RLS padrão membership;
  `phone_number_id` único), colunas `messages.wa_message_id|status|channel_id` e
  `conversations.channel_id`. Migração 0023 = Google Ads, 0024 = Formulários,
  0025 = atribuição de conversas, 0026 = `ai_logs`, 0027 = rail das conversas,
  0028 = mensagens agendadas, 0029 = finalizar/arquivar conversas,
  0030 = `ai_agents`, 0031 = template tracking, 0032 = autoreply,
  0033 = departamentos, 0034 = logo da empresa,
  0035 = conversas por número, 0036 = view de estado da integração de pagamentos,
  0037 = painéis do dashboard (por usuário e por departamento),
  0038 = `type='video'` em `messages` (ver mídia real abaixo),
  0039 = segmentação dos pipelines,
  0040 = só admin exclui conversa/mensagem,
  0041 = compromisso vinculado a lead, 0042 = lembrete do compromisso,
  0043 = agenda por usuário, 0044 = mídia drive (bucket + pastas/arquivos),
  0045 = conexões de mídia (tabela ainda existe; o OAuth saiu junto com o
  Canva), 0046 = arquivos do Drive via Picker,
  0047 = deduplicação de contato por telefone (`private.phone_key`),
  0048 = detalhe do lead / cruzamento com a Guru (`private.doc_key`,
  `contacts.doc`, `public.lead_payment_profile`),
  0049 = `lead_payment_profile` vira `security definer` (RLS + função
  não-leakproof = Seq Scan, ver seção do detalhe do lead),
  0050 = lembrete de tarefa (`tasks.reminder_minutes`, irmã da 0042),
  0051 = autor exclui a própria nota interna (`messages.created_by`),
  0052 = painel pessoal volta a ser privado (policy de leitura da 0037),
  0053 = conversa visível/atribuída, 0054 = bot conversacional,
  0055 = editor do bot (`bot_flows`) — as três do outro Claude,
  0056 = view `payment_new_sales` (o que conta como VENDA NOVA);
  **próxima migração livre: 0086** (0078 = busca de contatos no servidor,
  0079 = SLA de atendimento, 0080 = avisos de segurança, 0085 = transcrição de
  áudio, 0086 = transcrição em parágrafos; as 0080–0084 do outro Claude são de
  setor/rodízio).
- Env (privadas, nunca `NEXT_PUBLIC_`): `WHATSAPP_TOKEN`, `WHATSAPP_APP_SECRET`,
  `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_GRAPH_VERSION` (default `v21.0`).
- **Mídia real (imagem/áudio/vídeo)** — helpers em `src/lib/whatsapp/client.ts`
  (`getMediaInfo`/`downloadMedia`/`uploadMedia`/`sendMediaMessage`); o webhook baixa
  a mídia recebida para o bucket privado `conversation-media` e grava `media_path`;
  o envio acontece pela rota `POST /api/whatsapp/send-media`, acionada pelo composer
  do inbox logo após o `sendMedia` local (otimista); o thread (`src/components/inbox/thread.tsx`,
  `MediaContent`) renderiza imagem/áudio/vídeo por URL assinada (`useMediaUrl`) —
  vídeo usa `<video controls>`. Áudio gravado no navegador prefere `ogg/opus`
  (WhatsApp não aceita `webm`). Sem env nova.

**Passos manuais que FALTAM para ligar em produção (Gabriel):**
1. Envs acima na Vercel (production+preview+development) + confirmar que
   `SUPABASE_SERVICE_ROLE_KEY` já está lá (o webhook depende dela).
2. Meta App → WhatsApp → Configuration → Webhook: callback
   `https://lito-crm.vercel.app/api/whatsapp/webhook`, verify token =
   `WHATSAPP_VERIFY_TOKEN`, assinar o campo `messages`. ⚠️ Isso tira o número do
   RVOPS — a partir daí ele recebe no Lito, não mais lá.
3. Criar o canal em `/whatsapp` com `phone_number_id`/`waba_id` (painel da Meta →
   WhatsApp → API Setup) e testar ponta a ponta (mensagem do celular → inbox;
   resposta pelo inbox → celular; template fora da janela de 24h).

## WhatsApp — Auto-Responder (Bot de IA)

Motor de resposta automática de IA para mensagens de entrada do WhatsApp. Acionado
pelo webhook após gravar uma mensagem de TEXTO (mídia é ignorada). Best-effort: 
falhas nunca quebram o 200 do webhook.

**Arquitetura:**
- `src/lib/whatsapp/auto-reply.ts` (`maybeAutoReply`) — chamado pelo webhook (service role)
  após gravar mensagem de entrada de texto. Regras: só responde o agente principal
  (`ai_agents.is_primary=true`) com `status='ativo'`; não responde se a conversa tem
  `bot_paused=true` (handoff manual via `/api/whatsapp/send`); respeita o `daily_limit`
  do canal (conta saídas de hoje); usa as últimas ~10 mensagens como contexto (ordem
  cronológica).
- IA: chama OpenAI (`chat()`) com a personalidade, objetivo e info extra do agente;
  gera resposta em tempo real; envia via Cloud API.
- Registro: grava a mensagem de saída + `ai_logs` com feature `"whatsapp-auto"` e
  `created_by=null` (máquina). Modelo e token counts capturam uso real.
- Migração `0032_whatsapp_autoreply.sql` — coluna `conversations.bot_paused`
  (boolean, default false) para controlar handoff manual.
- Env: reusa `OPENAI_API_KEY` da fundação de IA. Sem nova variável.
- **Fora do proxy:** a chamada é máquina-a-máquina (webhook), sem sessão.

## Google Ads — leitura (KPIs/gráfico/campanhas em Relatórios)

Integração somente leitura com a API oficial do Google Ads. Fica na guia **Google Ads**
do módulo **Relatórios** (`src/components/reports/google-ads-report.tsx`) — espelha
a Visão geral: KPIs (Cliques, Conversões, Custo/conv., Custo) + gráfico Cliques×Conversões
+ tabela de campanhas. A aba "Gerenciador de anúncios" saiu do Marketing.

**Peças:**
- OAuth por empresa: `GET /api/google-ads/oauth/start` (gera state assinado + cookie
  httpOnly anti-CSRF, redireciona pro consentimento Google) e
  `GET /api/google-ads/oauth/callback` (valida state+cookie, troca o code por tokens,
  grava a conexão e redireciona de volta pra `/relatorios`).
- `GET /api/google-ads/overview` — consulta GAQL via `searchStream` (somente leitura),
  devolve `kpis/series/campaigns` já convertido de micros pra moeda.
- Token guardado por `location_id` em `google_ads_connections` (migração
  `0023_google_ads.sql`); coluna `refresh_token` **revogada do cliente** (só
  service-role lê — mesmo padrão de proteção do resto do backend).
- Cliente `src/lib/google-ads/client.ts`; repo `src/lib/data/repos/db/google-ads.ts`
  (`googleAdsActions.overview/disconnect/startConnectPath`).
- Envs (privadas, nunca `NEXT_PUBLIC_`): `GOOGLE_ADS_DEVELOPER_TOKEN`,
  `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_ADS_API_VERSION`
  (default `v18`).

**Passos manuais que FALTAM para ligar em produção (Gabriel):**
1. Google Cloud: criar projeto → ativar **Google Ads API** → tela de consentimento
   OAuth (External; escopo `.../auth/adwords`; adicionar seu e-mail como test user
   enquanto não verificado) → OAuth client (Web) com redirects
   `http://localhost:3000/api/google-ads/oauth/callback` e
   `https://lito-crm.vercel.app/api/google-ads/oauth/callback` → copiar Client ID/Secret.
2. Developer token: conta administradora (MCC) → API Center → gerar token (acesso a
   conta de teste imediato; solicitar **Basic access** para produção).
3. Envs acima na Vercel (production+preview+development) + `.env.local`.
4. Conectar em `/relatorios` → guia Google Ads → **Conectar Google Ads**; validar
   KPIs/gráfico/campanhas com a conta de teste. Quando o Basic access sair,
   reconectar apontando pra conta real (sem mudança de código).

## Formulários (Sites → Formulários)

Construtor de formulários embutíveis em qualquer site (do módulo Sites ou externo),
capturando lead como Contato real + tag, pronto pra e-mail marketing.

**Peças:**
- Builder em `/sites` → aba **Formulários**: lista + editor de campos
  (`src/components/sites/forms/forms-tab.tsx`, `form-editor.tsx`) e botão
  **Copiar embed**.
- Repo `src/lib/data/repos/db/forms.ts` — CRUD (`formActions.create/update/remove/
  toggleActive`), `useForms`, `embedSnippet(slug)` (gera o `<script>` de embed).
- Migração `0024_forms.sql` — tabelas `forms` (campos, slug, tag, mensagem de
  sucesso) e `form_submissions` (histórico de envios), RLS padrão membership.
- Rotas **públicas** (fora do matcher do `proxy.ts` — chamada do site do cliente,
  sem sessão — service role + CORS liberado):
  - `GET /api/forms/[slug]/embed.js` — devolve o JS que renderiza o formulário
    **sem estilo próprio** (herda o CSS do site onde é colado).
  - `POST /api/forms/[slug]/submit` — cria/atualiza o Contato e aplica a tag do
    form; honeypot anti-spam (campo oculto que, se preenchido, descarta o envio
    silenciosamente).
- Ao criar um form, nasce junto uma **Lista Inteligente** com a condição
  `{ field: "Tag", operator: "contém", value: tag }` — os leads capturados já
  caem prontos numa lista pra campanha de e-mail marketing mirar por `tag` ou
  `smart_list`.
- Sem env nova, sem serviço externo. Embed = colar
  `<script src="https://lito-crm.vercel.app/api/forms/{slug}/embed.js"></script>`
  no HTML da página.

## Mídia Drive (arquivos reais + Google Drive pelo Picker)

Módulo **`/midia`**: armazenamento próprio da empresa mais os arquivos que a
pessoa escolhe no Google Drive. Spec:
`docs/superpowers/specs/2026-08-17-midia-drive-design.md`.

- Migração **0044** — bucket PRIVADO `media-drive` + `media_folders`/`media_files`
  (RLS padrão membership; policies de `storage.objects` pelo primeiro segmento
  do caminho, `{location_id}/{uuid}.{ext}`). Pastas são TABELA, não prefixo do
  caminho (com prefixo, renomear viraria mover N objetos e pasta vazia não
  existiria). Excluir pasta **não** exclui arquivo (`on delete set null` → volta
  pra raiz). Upload que falha no metadado remove o binário (órfão contaria no
  espaço usado sem aparecer em tela).
- 🗑️ **Canva REMOVIDO** (2026-08-17, a pedido do Gabriel). Como o Google Drive
  já tinha migrado para o **Picker** (0046) — a rota `/api/media/oauth/start`
  respondia **410** para `google_drive` —, o Canva era o ÚNICO consumidor vivo
  de toda a pilha de OAuth de mídia. Saíram junto, por serem código morto:
  `/api/media/{oauth/start,oauth/callback,files,disconnect}`,
  `src/lib/integrations/media-oauth.ts` e `src/lib/data/repos/db/media-connections.ts`,
  mais as envs `CANVA_CLIENT_ID`/`CANVA_CLIENT_SECRET`. Tudo está no histórico
  do git se algum dia voltar.
  A tabela `media_connections` e a view `media_integration_status` (0045) **ficam
  no banco**: dropar é irreversível e não há ganho. A migração também não foi
  reescrita — já foi aplicada.
  ⚠️ Se um dia entrar OUTRO provedor por OAuth, vale reler a 0045 antes: a
  tabela é admin-only (como `payment_credentials`), então quem lê o token tem
  que ser a **service role**, com a sessão só autorizando; ler com a sessão do
  usuário faz a tela dizer "não conectado" para todo não-admin — o mesmo bug que
  a Guru já teve duas vezes.
- **Passo manual pendente:** ativar a Google Drive API e a Picker API no projeto
  do Google Cloud (as migrações 0044/0045/0046 já estão aplicadas).

## Fundação de IA (OpenAI)

Base genérica de geração via IA, sem feature específica embutida — outras features
(Content AI, Conversation AI, base de conhecimento) entram por cima dela, cada uma
com spec própria.

**Peças:**
- `src/lib/ai/openai.ts` — cliente OpenAI do lado servidor; chave nunca chega ao
  client. Modelo por `OPENAI_MODEL` (default `gpt-4o-mini`) se a chamada não
  especificar outro.
- `POST /api/ai/generate` — rota autenticada (RLS via sessão do usuário), motor
  genérico de geração; grava cada chamada em `ai_logs` (modelo, prompt, resposta,
  tokens, `feature`).
- Repo `src/lib/data/repos/db/ai.ts` — `aiActions.generate`, `useAiLogs`,
  `useAiUsage` (KPIs de uso a partir de `ai_logs`).
- Migração `0026_ai_logs.sql` — tabela `ai_logs` (modelo, prompt, resposta,
  `prompt_tokens`/`completion_tokens`, `created_by`), RLS padrão membership.
- **AI Studio** (`/ai-studio`) já usa a fundação: playground gera de verdade e a
  aba de uso mostra KPIs/lista reais vindos de `ai_logs`. **Agentes de IA**
  (`/agentes-ia`) continua **MOCK** — vem depois, em cima dessa base.
- Env (privadas, nunca `NEXT_PUBLIC_`): `OPENAI_API_KEY`, `OPENAI_MODEL`
  (default `gpt-4o-mini`).

## Conversation AI (aba de `/agentes-ia`)

**Peças:**
- Agentes reais em `ai_agents` (migração `0030_ai_agents.sql`), aba **Conversation AI** do módulo **Agentes de IA** (`src/components/ai/conversation-ai-tab.tsx`).
- Repo `src/lib/data/repos/db/ai-agents.ts` — CRUD (`aiAgentActions.create/update/remove/setPrimary`), `useAiAgents`, chat (`aiAgentActions.chat`).
- Botão **Testar seu bot** usa `POST /api/ai/chat` (monta o system prompt do agente + histórico de conversa → OpenAI; grava `ai_logs` feature "agent-test").
- Ainda MOCK nessa aba: KPIs, aba Logs (histórico de testes), IA de voz, Base de Conhecimento, execução das ações do agente na conversa, e auto-responder em conversas reais de clientes (depende da Meta/WhatsApp estar conectado — fase seguinte).
- Sem env nova; reusa `OPENAI_API_KEY` da fundação.

## Contatos: a lista sai do store e vira consulta (41 mil linhas)

A importação do CRM antigo levou a empresa de 365 para **41.532 contatos** e a
tela de Contatos passou a demorar dezenas de segundos. A causa não era a tabela:
era a tela ler `useDbContacts()` — o array INTEIRO — para desenhar 12 linhas.
Carregar tudo é ~42 requisições (o PostgREST corta em 1000, regra nº 7) e ~20 MB.

Migração **0078**: `public.search_contacts(...)` faz busca, filtro, ordenação,
paginação e **contagem** no Postgres; `public.contact_companies(...)` agrega a
aba Empresas; `public.existing_contact_keys(...)` responde o dedupe da
importação. Medido como `authenticated`: busca por nome 22–81 ms, página sem
busca 205 ms, empresa alheia devolve vazio.

- **`security definer` com a checagem de empresa na PRIMEIRA LINHA** — padrão da
  0049. Sob RLS, um `where` que chama função não-leakproof (`lower`) não pode
  ser avaliado antes das políticas, sai de baixo do índice funcional e vira Seq
  Scan. ⚠️ Ao mexer na função, mantenha o guard no topo: sem ele, `security
  definer` significa "qualquer autenticado lê o contato de qualquer empresa".
- ⚠️ **O guard fica FORA da consulta.** Escrito como CTE no `from`, ele virava um
  join opaco e o planner desistia do índice de trigramas: 153 ms com a CTE
  contra 81 ms com `if ... then return; end if;` antes do `return query`.
- O índice é **GIN de trigramas** (`pg_trgm`, que NÃO estava instalado — e no
  Supabase mora no schema `extensions`, senão o `create index` falha com
  "operator class gin_trgm_ops does not exist"). ⚠️ A expressão indexada tem que
  ser IDÊNTICA à do `where`, senão o índice é ignorado e ninguém avisa.
- `tags` ficou **fora da busca livre**: `array_to_string` não é immutable e não
  entra em índice. Tag continua nos filtros avançados e nas listas inteligentes.
- Os filtros avançados são avaliados com `jsonb_array_elements`, **não com SQL
  montado em texto** — valor digitado pelo usuário não vira SQL. A semântica é a
  do antigo `matchesConditions`: "é" e "contém" são os dois SUBSTRING, "não é" é
  a negação. Mudar isso mudaria o resultado das listas já salvas.
- `count(*) over ()` conta o filtro inteiro (a janela roda antes do `limit`) —
  é o selo "41.532 contatos", que não pode virar "12". É também o que faz a
  página sem busca custar 205 ms: sem filtro, contar é varrer tudo.

**No app** (`db/contacts-search.ts`): `useContactsSearch` (uma página, com
debounce de 300 ms só no que é DIGITADO — clique em página/ordem não espera),
`fetchAllMatching` (exportação, em páginas de 1000), `countMatching` (selo das
listas), `useContactCompanies`, `useContactsByIds` (resolve nome por id, em
lotes de 200). O `DataTable` ganhou a prop opcional **`server`**: com ela, `data`
já é a página pronta e a tabela só desenha — sem ela, nada muda para Leads,
Automações e Conversas.

⚠️ **Duas armadilhas que a mudança abriu, e como foram fechadas:**
1. **`load()` baixava os 41 mil só para descobrir a empresa.** Vinte e quatro
   repos faziam `await useDbStore.getState().load()` e usavam apenas
   `locationId`. Agora existe **`ensureSession()`** (duas consultas leves) e
   **`loadTeam()`** (a equipe são dezenas de perfis; `useDbTeam` arrastava os 41
   mil junto). `load()` continua para quem realmente usa a lista.
   `ensureSession` compartilha **a mesma promessa** entre chamadas simultâneas —
   com um `if (loading) return`, a segunda voltava na hora, o chamador lia
   `locationId` nulo e cacheava lista vazia como carregada (o bug da aba Canais).
2. **O dedupe da importação era um `Set` do array do store.** Com a tela sem
   carregar a lista, o array vive vazio e a checagem sumiria EM SILÊNCIO —
   reimportar o mesmo arquivo duplicaria o histórico inteiro. Agora quem
   responde é `existing_contact_keys` (documento, telefone normalizado, e-mail),
   em lotes de 5000 linhas do arquivo.

Também: `/contatos` **saiu do `RouteRevalidator`** (revalidar ali voltaria a
baixar os 41 mil a cada entrada na rota) e `reload()` agora não faz nada se
`loaded` for false. Criar contato e ação em massa chamam `refresh()` da página —
a lista veio de uma consulta e não se corrige sozinha.

**Ainda leem o array inteiro** (decisão do Gabriel de manter o escopo na tela de
Contatos): Conversas (`conversation-list`, `views-rail`, `conversations-report`),
Calendários, `reminders`, o drilldown do painel, o composer de campanha e o
diálogo de oportunidade. Nessas telas `useDbContacts()` segue baixando tudo — o
caminho é `useContactsByIds` (nome por id) e `ContactPicker` (busca no servidor,
`components/contacts/contact-picker.tsx`), que já existem.

## Análise de atendimento (SLA) — Relatórios → Atendimento

Aba nova (`components/reports/service-sla-report.tsx` + rota
`/api/relatorios/atendimento`), admin-only como as outras de gestão. Mede o
tempo até a **primeira resposta humana**. Migração **0079**.

**Definições do Gabriel:** expediente **seg–sex, 8h–19h** (America/Sao_Paulo) e
meta de **15 minutos** úteis.

⚠️ **O "tempo médio de resposta" da aba Agentes era ficção em quatro camadas** —
tudo medido neste banco, 30 dias. Não repita nenhuma delas em métrica nova:

1. **Descartava tudo acima de 24h** (`MAX_RESPONSE_MIN` em
   `lib/reports/snapshot.ts`): escondia justamente as piores respostas.
2. **Média, não mediana.** A média era 675 min (11h) e a mediana, 14 min. A
   atendente que a tela mostrava com "1h 59min" tem mediana de **1,8 min** e 68%
   na meta — era a melhor da equipe retratada como a pior.
3. **Não contava quem nunca foi respondido.** 55 das 245 conversas com mensagem
   de cliente (23%) não tiveram UMA resposta humana e não entravam em métrica
   alguma: o pior caso de atendimento era invisível. Por isso as não respondidas
   entram no DENOMINADOR do cumprimento — medir só entre as respondidas
   premiaria abandonar a conversa.
4. **Media tempo corrido.** Com o expediente aplicado, o p90 caiu de **45h para
   2h33**: dos 25 casos que passavam de 24h, 21 eram de sexta ou sábado
   respondidos na segunda. Sem congelar o relógio, a tela acusa a equipe de
   violar SLA por não trabalhar no domingo.

**Peças:**
- `private.business_minutes(t0, t1)` — minutos dentro do expediente, em horário
  LOCAL (a janela é 8h–19h no relógio de quem atende). Laço por dia com teto de
  400 voltas: conversa esquecida há anos não pode virar dez mil iterações dentro
  de uma consulta de tela. Conferido com 8 casos de borda (vira a noite, sábado
  → segunda, domingo inteiro = 0, t1 antes de t0 = 0).
- `public.sla_conversations(location, de, ate, meta)` — uma linha por conversa
  com espera útil, espera corrida, respondida, dentro da meta, fechada e se **só
  o bot respondeu**. `security definer` com a checagem de empresa na primeira
  linha (padrão da 0049 — `business_minutes` não é leakproof). 14–26 ms para
  qualquer período até 90 dias.
- A rota agrega KPIs, série diária, faixas de distribuição, por responsável, por
  canal e a **fila de ação** (quem espera agora primeiro, depois as violações).

⚠️ **A resposta do BOT não conta como atendimento.** O auto-responder responde em
segundos; contando como primeira resposta, o SLA ficaria perfeito sem ninguém
ter atendido. As conversas em que só o bot falou aparecem marcadas ("só o bot
respondeu") — são 8 hoje.

⚠️ **O recorte por pessoa usa `conversations.assigned_to`, NÃO
`messages.created_by`** — e isso levou à correção da causa raiz: **86% das saídas
estavam com autor nulo** (906 de 1.416 saídas humanas). O `created_by` vinha de
`useDbStore.getState().userId`, que só existia depois do `load()` do store — o
mesmo `load()` que baixava os 41 mil contatos e levava uma dezena de segundos.
Quem respondia rápido depois de abrir as Conversas gravava a mensagem **sem
autor, em silêncio**; daí os 8 de 10 atendentes com "sem dados", e daí também a
nota interna que o próprio autor não conseguia mais excluir (a policy da 0051
exige `created_by = auth.uid()`). `conversationActions.send`/`sendMedia` agora
resolvem o autor com `await autor()`, que chama `ensureSession()` se preciso.
**As mensagens antigas seguem sem autor** — não dá para adivinhar quem enviou.
Conversa sem responsável aparece agrupada como "Sem responsável" (188 de 245, e
46 delas nunca respondidas): é informação de gestão, não erro a esconder.

### Baixar relatório (CSV)

Botão "Baixar relatório" no topo da aba, ao lado de "Mais filtros".

- **Uma linha por conversa, não os totais.** Quem baixa relatório de SLA vai
  montar tabela dinâmica, cruzar com a planilha da equipe ou procurar caso a
  caso; os KPIs a planilha recalcula a partir das linhas — o contrário não.
- ⚠️ **Exporta o RECORTE ATIVO**, não o período inteiro. A tela toda reflete o
  filtro (chips, gráficos, tabelas); um arquivo que ignorasse os filtros não
  bateria com nada do que está em tela. O nome do arquivo carrega o período e um
  `-filtrado` quando há recorte — dois downloads do mesmo dia com filtros
  diferentes não podem virar o mesmo nome.
- ⚠️ Detalhes que fazem o Excel em pt-BR abrir direito, os mesmos da exportação
  de Contatos: separador **`;`**, **BOM** na frente (sem ele os acentos viram
  "AtendÃ­vel") e **decimal com vírgula** — com ponto, o Excel lê `14.5` como
  texto e a coluna deixa de somar.
- A coluna `situacao` já vem resolvida ("dentro da meta" / "fora da meta" /
  "esperando agora" / "sem resposta (finalizada)"), para a planilha não precisar
  reproduzir a regra do SLA em fórmula.
- `csvDeAtendimentos` fica em `lib/reports/sla.ts`, junto da agregação — foi
  conferida com dados de teste (aspas no nome do contato, decimal, fuso de São
  Paulo, conversa sem responsável).

A tela usa as classes claras de sempre (`bg-white`, `text-slate-900`) e o dark
mode vem dos overrides de `globals.css` — não espalhe `dark:` aqui.

### Gráficos clicáveis, filtros e o widget do painel

**A agregação saiu da rota e foi para o navegador** (`lib/reports/sla.ts`). A
rota devolve UMA LINHA POR CONVERSA (245 em 30 dias, ~40 KB) e quem soma é o
client, dentro de `useMemo`. Motivo: com os gráficos clicáveis, recontar no
servidor a cada clique tiraria a resposta imediata do filtro. O dia em que
245 virar 20 mil é o dia de voltar a agregar no servidor.

Ganho de projeto: o recorte que o clique cria e o do painel de filtros passam
pelo MESMO caminho (`aplicarFiltros`) — não existe "filtro que o gráfico entende
e a tabela não". `faixaDe()` é a mesma função que desenha a barra e que filtra.

- **Tudo alterna**: clicar no que já está ativo remove o recorte. Clicáveis: os
  4 KPIs, as barras da distribuição, os dias da linha, as linhas de responsável
  e as de canal. Chips no topo mostram o recorte e removem item a item.
- ⚠️ **O clique da linha vem do GRÁFICO (`activeLabel`), não do ponto**: acertar
  um `dot` de 4 px com o mouse é difícil, e a área do dia já identifica qual foi.
- ⚠️ **Faixa fora do recorte fica com `opacity 0.3`, não desaparece** — ver o
  tamanho relativo dela é metade da informação.
- Os seletores listam o PERÍODO, não o recorte: encolhendo junto com o filtro,
  trocar de responsável exigiria limpar o filtro antes.
- O eixo do gráfico é o do período (`dias_do_periodo` vem da rota): filtrando por
  um responsável, os dias em que ele não atendeu aparecem como zero em vez de
  encurtar a linha e mudar a escala.
- Recorte vazio mostra um aviso com "limpar filtros" — quatro zeros e dois
  gráficos vazios sem explicação parecem defeito.
- Trocar de período limpa o recorte, e isso é feito **no clique, não num efeito**
  sobre `dias`: o efeito rodaria também na primeira montagem.
- ⚠️ `const linhas = useMemo(() => dados?.linhas ?? [], [dados])` — com o
  literal `?? []` direto, o array nasce novo a cada render e invalida todos os
  `useMemo` abaixo.

**Widget no painel** (`dashboard/service-widgets.tsx`, chave `atendimento-sla`,
span 2): quatro números de 7 dias + faixa âmbar quando há alguém esperando +
link para a análise completa. Enxuto de propósito — gráficos clicáveis, filtros e
a fila num card de meia linha viram um amontoado ilegível (mesmo raciocínio do
"Resumo pagamentos" na barra das Conversas). `/relatorios` passou a aceitar
**`?tab=<aba>`** (com o limite de `Suspense` que o `useSearchParams` exige) para
o link cair na aba certa.

⚠️ **A rota deixou de ser admin-only e passou a valer a permissão do módulo
`relatorios`** (`requires: "relatorios"` no catálogo do widget) — pedido do
Gabriel de que a análise apareça para quem tem acesso liberado. A aba Atendimento
também aparece para não-admin. **A checagem que vale é a do SERVIDOR**: como
`sla_conversations` é `security definer`, esconder o widget na tela não seria
proteção. Para isso, `canAccess` saiu de `db/team.ts` (que é `"use client"` e não
pode ser importado numa rota) para **`lib/auth/module-access.ts`**; `team.ts`
reexporta de lá, então a ordem de resolução do acesso continua existindo em UM
lugar. O widget trata 403 devolvendo `null` — se o acesso mudou depois de o
painel ter sido salvo com ele, a resposta certa é desaparecer, não um cartão de
erro no painel de quem não pode ver mesmo.

## Avisos do linter de segurança do Supabase (migração 0080)

O painel apontava dois **"Security Definer View" como CRITICAL**. Rodando a
lista completa (`get_advisors`), o achado mais grave era outro.

⚠️ **Seis funções `security definer` eram chamáveis SEM LOGIN** — a causa é o
padrão do Postgres: `create function` já concede EXECUTE a **PUBLIC**, e elas
não tinham o `revoke`. Conferido como `anon` ANTES de mexer:
`public.contact_conversation('<uuid de contato>', 'whatsapp')` devolvia o id da
conversa e o atendente atribuído, de qualquer empresa, para quem não estava
autenticado. As seis: `contact_conversation`, `claim_conversation`,
`transfer_conversation`, `touch_presence`, `publish_campaign`,
`add_campaign_recipients`. Depois da 0080, `anon` recebe
`42501 permission denied for function`.

⚠️ **Ao criar função em `public`, faça SEMPRE o par**
`revoke execute ... from public, anon` + `grant execute ... to authenticated`.
Só o `grant to authenticated` não basta: ele não tira o EXECUTE que o PUBLIC
ganhou de graça.

🔴 **CORREÇÃO (2026-08-27): a frase que estava aqui era falsa.** Este parágrafo
afirmava que "as funções das 0047/0048/0078/0079 já fazem o par, e é por isso
que nunca apareceram nessa lista". A guarda de migração
(`npm run db:audit`) varreu as 103 migrações e diz o contrário:
**17 das 26 funções criadas em `public` recebem `grant execute` e NUNCA
`revoke ... from public, anon`** — incluindo justamente
`find_contact_by_phone` (0047), `lead_payment_profile` (0049),
`search_contacts`/`contact_companies` (0078), `existing_contact_keys` (0078) e
`sla_conversations` (0079). A 0080 revogou 6; as outras 17 nunca foram tocadas.

⚠️ **Isto é leitura ESTÁTICA do repositório, não do banco** — não houve como
conferir contra o Postgres (falta `DATABASE_URL` no `.env.local` e o CA em
`scripts/`). Antes de agir, confirme com:
```sql
select p.proname, pg_get_function_identity_arguments(p.oid) as args,
       has_function_privilege('anon', p.oid, 'execute') as anon_executa
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' order by 1;
```
O dano provável é menor do que na 0080 porque essas funções têm a checagem de
empresa na primeira linha (padrão 0049), então `anon` — cujo
`private.user_locations()` é vazio — recebe conjunto vazio em vez de dado. Mas
"não vaza porque a guarda interna segura" é rede única: quem escrever a próxima
função sem guarda ganha o vazamento inteiro. ⏳ **Falta a migração que fecha as
17.**

**`contact_conversation` ganhou checagem de empresa.** Ela nasceu sem checagem
nenhuma, e ignorar a RLS é o propósito dela (o botão "Abrir conversa" do card
precisa achar a conversa mesmo sendo de outro atendente). Mas "de outro
atendente" e "de outra empresa" são coisas diferentes: sem o filtro, um membro da
empresa A resolvia conversa de contato da empresa B. O guard preserva a intenção
e fecha o vazamento.

### As duas views — e por que a receita do linter NÃO servia para as duas

No Postgres 15+ a view roda com os privilégios de quem a criou, a menos que
`security_invoker` esteja ligado. É disso que o linter reclama.

- `media_integration_status` (0045): **`security_invoker = true`** e pronto. Não
  tem um consumidor no app desde que o Canva saiu (2026-08-17) e o Drive passou
  ao Picker. O objeto fica no banco, como a 0045 decidiu.
- ⚠️ `payment_integration_status` (0036): ligar o invoker aqui **REINTRODUZ um
  bug que este projeto já teve DUAS VEZES**. `payment_credentials` é admin-only
  desde a 0008, e a view existe exatamente para o usuário comum ver o ESTADO da
  integração sem alcançar o token; com invoker, a policy admin-only volta a valer
  e todo não-admin vê "Guru não conectada" numa empresa conectada.
  **`grant` por coluna também não resolve**: admin e usuário comum são o MESMO
  role (`authenticated`), e quem os separa é a RLS, que é por linha, não por
  coluna.
  A saída foi a view virar uma **casca com invoker ligado sobre a função definer
  `payment_integration_status_rows()`**, que faz a checagem de empresa
  explicitamente. O linter fica satisfeito, `db/payments.ts` continua com
  `.from("payment_integration_status")` (nenhuma mudança no app) e a proteção do
  token deixa de depender da lista de colunas da view. Conferido como usuário
  comum: vê 1 linha de estado, vê 0 linhas de `payment_credentials`.

### O que sobrou na lista, de propósito

- **`rls_enabled_no_policy` em `private.app_settings` / `automation_config` /
  `marketing_config`** (INFO): é o desenho. O schema `private` não é exposto na
  API e RLS ligada sem policy nenhuma significa "ninguém acessa pela API" — que é
  exatamente o objetivo de guardar segredo de cron ali.
- **`authenticated_security_definer_function_executable`** (WARN, ~14 funções):
  esperado. São as funções que existem para dar ao usuário autenticado um recorte
  que a RLS sozinha não daria; todas checam a empresa na primeira linha. O aviso
  é um lembrete de revisar, não um defeito.
- **Leaked Password Protection** (WARN): é chave no painel do Supabase
  (Authentication → Policies), não código — **passo manual do Gabriel**, se
  quiser ligar a checagem contra o HaveIBeenPwned.

### Os fiapos de gráfico dos KPIs (interativos desde 2026-08-25)

Os quatro sparklines da faixa não respondiam a nada: passar o mouse não mostrava
valor nenhum e não havia como saber que período um ponto representava.

- **A leitura aparece NO LUGAR do hint**, não num balão flutuante. O card tem
  `overflow-hidden` (a faixa de cor no topo depende disso para arredondar nas
  pontas) e um tooltip do Recharts sairia **cortado pela borda**. Sob o mouse, a
  linha "204 ainda em aberto" vira "29 de ago · 3 novas · 12 até aqui".
- ⚠️ **O `<Tooltip content={() => null} />` não é resto de código.** É ele que
  faz o Recharts desenhar o `activeDot` no ponto sob o cursor. Sem o Tooltip
  montado, não há ponto marcado.
- ⚠️ **O índice sob o cursor é medido pela POSIÇÃO DO MOUSE no container**, não
  lido do estado do Recharts. A primeira versão usava o `onMouseMove` do gráfico
  e o `activeTooltipIndex` — e **não funcionava**: no Recharts 3 esse campo é
  `TooltipIndex = string | null`, não `number`, então a checagem `typeof i ===
  "number"` descartava todo hover EM SILÊNCIO. O sintoma engana: o ponto e a
  linha do cursor apareciam (isso é interno do Recharts, não depende do
  handler) e só o texto nunca trocava. Medir no container não depende de detalhe
  interno de versão.
  `Math.round(p * (n - 1))` e não `Math.floor`: é o ponto MAIS PRÓXIMO do
  cursor, o mesmo critério do `activeDot` — com `floor` os dois discordariam nas
  bordas e o texto falaria de um ponto diferente do marcado.
- ⚠️ **A linha é ACUMULADA**, então o tooltip mostra os dois números: o que
  entrou na fatia (`inc`) e o acumulado (`v`). Só com o acumulado, o número do
  ponto contradiz a intuição de "quantas nesse dia".
- **As fatias eram 12 fixas** — num mês, 2,5 dias cada, impossível de rotular.
  Agora a fatia é o DIA enquanto o período couber em 31 leituras, e só além disso
  agrupa (o rótulo então vira "1 a 3 de set"). Foi essa mudança que tornou o
  tooltip escrevível.
- **O card virou botão**: clicar abre o mesmo `DrilldownDialog` dos outros
  widgets. Com o mouse sobre um ponto, abre só aquele intervalo; fora dele, o
  período inteiro.

⚠️ **`DrilldownDialog` usava `useDbContacts()`** e fica montado no painel mesmo
fechado — abrir o Dashboard baixava os 41 mil contatos para escrever o nome de
dez linhas *caso* alguém clicasse num gráfico. Passou a usar
`useContactsByIds` (só os contatos das oportunidades em tela).

Dois defeitos do mesmo tipo, corrigidos junto: a rosca de **Distribuição de
fases** tinha `<Tooltip />` sem `formatter` e mostrava `value: 12` (nome de
coluna do banco na tela), e o eixo de **Receita por mês** dividia por mil com
`toFixed(0)` — com receita abaixo de R$ 1.000 escrevia "R$0K" em todos os
traços, o mesmo defeito que Valor de Oportunidade já tinha tido. Agora usa
`shortBRL`.

## Conversas: horário na lista e transcrição dos áudios (migração 0085)

**Horário da última mensagem na lista** (`conversation-list.tsx`, sem migração):
antes era preciso ABRIR a conversa para saber se a última mensagem foi de agora
ou do mês passado. A escala é a do WhatsApp e é proposital: hoje mostra a HORA
(o que importa é "há quanto tempo"), ontem e a semana mostram o DIA (a hora
exata já não muda a decisão), e o resto mostra a data — com o ano quando é de
outro ano, senão "12/03" enganaria. O horário foi para a linha do NOME e o
contador de não lidas desceu para a linha da prévia: juntos no mesmo canto, o
nome do contato truncava cedo.

**Transcrição dos áudios.** Áudio no atendimento obriga a parar e ouvir, com
fone, no ritmo de quem falou. Transcrito, ele entra na **busca global do inbox**
(que já procura no corpo das mensagens) e é lido de relance.

- Colunas `messages.transcription`, `transcription_status`
  (`pendente|ok|falhou|ignorado`) e `transcription_error`.
- ⚠️ **Quem enfileira é um TRIGGER**, não um `default` nem quem insere: áudio
  entra por quatro caminhos (webhook do WhatsApp, `sendMedia` do composer, painel
  Arquivos, disparo de mídia) e o quinto que alguém criar amanhã esqueceria de
  marcar.
- ⚠️ **Quem transcreve é o TICK QUE JÁ EXISTE** (`/api/automations/tick`), como
  as mensagens agendadas da 0028 — segundo cron significaria segundo segredo,
  segunda migração de agendamento e mais um passo manual em produção. Lote de 5
  por rodada, **mais novos primeiro**: a conversa de agora é a que alguém está
  lendo; o histórico pode esperar as próximas rodadas.
- **O que decidiu transcrever TUDO automaticamente foi a medida do volume:** 30
  dias deste banco = 63 áudios recebidos (~13 min) e 137 enviados (~62 min). A
  ~US$ 0,006/min dá menos de US$ 0,50/mês. Com volume alto, valeria exigir o
  clique.
- ⚠️ **O modelo default é `whisper-1`, não o mais novo.** `gpt-4o-mini-transcribe`
  custa ~metade, mas um nome de modelo que a conta não tem faz TODA transcrição
  falhar; na diferença real deste volume a economia é de centavos. Trocar é só
  `OPENAI_TRANSCRIBE_MODEL` na Vercel, sem mexer no código.
- ⚠️ **O nome do arquivo importa** no `FormData`: a API decide o formato pela
  EXTENSÃO, e o WhatsApp manda ogg/opus. Sem extensão, ela recusa o arquivo. E
  `language=pt` fica fixo — em áudio curto e com ruído a detecção automática às
  vezes escolhe espanhol.
- **`ignorado` não é `falhou`**, e a diferença é o que evita laço infinito:
  áudio sem arquivo (o composer grava a mensagem otimista e o upload pode falhar
  depois), acima de 25 MB (teto da API) ou sem fala reconhecida saem da fila em
  vez de serem retentados a cada minuto para sempre.
- **A prévia da conversa passa a mostrar a transcrição** quando o áudio é a
  última mensagem (`🎤 <texto>`). ⚠️ Só se NENHUMA mensagem mais nova chegou nesse
  meio tempo — senão a lista mentiria sobre qual foi a última mensagem.
- ⚠️ **O balão pede a transcrição ao ver um áudio `pendente`**, sem esperar o
  tick: o tick roda a cada minuto e existe para o histórico; quem está com a
  conversa aberta não deveria esperar um minuto pelo áudio que acabou de chegar.
  Os pedidos saem **em série e com teto de 12 por carregamento de página** —
  uma conversa cheia de áudio antigo dispararia uma requisição por balão, todas
  ao mesmo tempo; o que passar do teto fica para a fila.
- ⚠️ **`useState(message.transcription)` NÃO funciona aqui** e foi o motivo de a
  transcrição só aparecer depois de recarregar a página. O `useState` usa o
  argumento apenas na primeira montagem, então quando o texto chegava pelo
  Realtime (o inbox já assina UPDATE de `messages`, e a tabela é `replica
  identity full`) o componente seguia exibindo o valor congelado. Hoje o valor
  do BANCO tem prioridade e o estado local é só ponte para a resposta do clique.
- ⚠️ **O corte da fila é por TEMPO** (20 s), não só por quantidade. Lote fixo
  obriga a escolher entre esvaziar devagar (5 por rodada = mais de meia hora nas
  170 gravações do histórico) e arriscar o timeout da rota — que abortaria o
  tique INTEIRO, junto com as automações e as mensagens agendadas, que moram no
  mesmo lugar.
- **Parágrafos, não bloco corrido.** A primeira versão gravava o texto como a
  API devolvia: um áudio de dois minutos virava um parágrafo de 1.800
  caracteres, que é justamente o que ninguém lê. Hoje o pedido usa
  `response_format=verbose_json` e a quebra sai dos SEGMENTOS com tempo — onde a
  pessoa pausou (0,7 s é o que separa "respirar no meio da frase" de "terminei a
  ideia"). O limite de 320 caracteres é rede para quem fala sem respirar, e só
  corta DEPOIS de um fim de frase, para não partir a oração no meio.
  ⚠️ Na tela precisa de **`whitespace-pre-line`**: no HTML, quebra de linha conta
  como espaço, e sem isso o texto volta a ser um bloco corrido mesmo estando
  quebrado no banco.
- **Cortado em 2 linhas, com "ver mais"** (2026-08-26): um áudio de dois minutos
  transcrito ocupa mais espaço que a conversa inteira, e o balão empurra o fio
  para fora da tela. Duas linhas dão o assunto; o resto é sob demanda.
  ⚠️ O botão só aparece quando o texto REALMENTE passa de duas linhas, medido no
  elemento (`scrollHeight > clientHeight`) e não estimado por contagem de
  caracteres: a largura do balão muda com a janela, e um "ver mais" que não
  revela nada é pior que não ter botão. A medição roda em
  `requestAnimationFrame` (precisa do layout pronto, e assim o `setState` sai do
  corpo síncrono do efeito) e escuta `resize`.
  A migração **0086** reenfileirou as transcrições longas já gravadas (47 de 89)
  para ganharem as quebras — as curtas não, porque não há o que quebrar e seria
  pagar de novo pelo mesmo resultado.
- **Velocidade de reprodução** (1×, 1,25×, 1,5×, 2×) no player, sem 0,5x: em
  áudio de atendimento a necessidade é sempre ouvir MAIS RÁPIDO.
  ⚠️ **A escolha é DE CADA ÁUDIO, não uma preferência do usuário.** A primeira
  versão guardava em `localStorage` (copiando o padrão da sidebar minimizável) e
  o efeito foi o oposto do esperado: acelerar um áudio acelerava todos os outros
  da conversa junto. Quem clica ali está decidindo sobre AQUELE áudio — não
  configurando o CRM. Cada balão nasce em 1×.
  ⚠️ `playbackRate` é propriedade do ELEMENTO, não atributo controlado pelo
  React: sem aplicá-la no `onPlay` E na troca, o áudio volta a 1× (aplicar na
  troca é o que faz a mudança valer no meio da reprodução, sem pausar).
- Rota `POST /api/messages/transcribe` para transcrever na hora (o áudio que
  acabou de chegar, ou o que falhou). **A sessão AUTORIZA e a service role
  EXECUTA** (padrão do `resolveGuruUserToken`): o `select` passa pela RLS, então
  quem não vê a conversa recebe 404 e não gasta uma chamada; a escrita precisa da
  service role porque UPDATE em `messages` é admin-only (0040). Já transcrito
  devolve o cache em vez de pagar de novo.
- Env nova: `OPENAI_TRANSCRIBE_MODEL` (opcional). Reusa `OPENAI_API_KEY`.

⚠️ **A migração marcou os ~200 áudios existentes como `pendente`** — o histórico é
justamente o que ninguém vai voltar para ouvir. A 5 por minuto, a fila leva ~40
min para esvaziar depois do deploy.

**Confirmado em produção** (2026-08-25): `OPENAI_API_KEY` ESTÁ na Vercel — 35
áudios transcritos e nenhuma falha na primeira leva. A qualidade do `whisper-1`
com `language=pt` é boa até em nome próprio e jargão do negócio ("mecânico de
aeronaves", "o instrutor, o Júnior"). Para acompanhar:
`select transcription_status, count(*) from messages where type='audio' group by 1;`

## 🗑️ Sistema telefônico / webphone REMOVIDO (2026-08-26)

A pedido do Gabriel: não há provedor de VoIP integrado, então a tela prometia
uma capacidade que o CRM não tem. Saíram **Configurações → Sistema telefônico**
(`/configuracoes/telefonia`), o item do menu, `layout/webphone-panel.tsx` e
`layout/webphone-store.ts`.

O painel já vinha morrendo em etapas: virou popover da barra superior, saiu de lá
em 2026-08-24 por prometer ligação e não completar nenhuma, e ficou só como uma
tela de configuração que ninguém usava. Removido junto porque a página era o
ÚNICO consumidor dos dois arquivos — mesma decisão do Canva: código morto sai, o
histórico do git guarda.

O botão verde **"Ligar" saiu também do cabeçalho da conversa** (2026-08-26): sem
provedor de voz, o CRM não tem o que oferecer ali. Ele nunca dependeu do
webphone — usava `telHref()` para abrir o discador do aparelho.

⚠️ **Ainda existe um botão de ligar no CARD DO FUNIL** (`opportunity-card.tsx`),
pelo mesmo `telHref()`. Foi mantido porque o pedido foi sobre a barra da
conversa; se ele também sair, `src/lib/phone.ts` fica sem nenhum consumidor e
pode ir junto.

Se um dia entrar provedor de voz, é `git revert` nesses commits — mas repare que
o que faltava nunca foi a interface, era o provedor.

## Análise IA: histórico das perguntas (sem migração)

A aba respondia e esquecia: trocar de pergunta apagava a anterior da tela e nada
ficava gravado. Como a análise responde sobre um RETRATO dos dados que muda a
cada consulta, reler a pergunta antiga junto com a resposta daquele momento é a
única forma de comparar dois instantes da operação.

- **Sem tabela nova**: `ai_logs` (migração 0026) já existia com prompt, resposta,
  modelo, tokens e `created_by`. A rota `/api/relatorios/analise` simplesmente
  **não gravava** — nenhuma linha com `feature = 'reports-analysis'` existia no
  banco. Agora grava, e a chave da feature é o que separa este histórico dos
  testes de agente e do Content AI, que dividem a mesma tabela.
- ⚠️ **Grava a PERGUNTA, não o snapshot.** O JSON do retrato tem centenas de KB e
  muda a cada consulta: guardá-lo encheria a tabela sem acrescentar nada ao que a
  pessoa quer rever.
- ⚠️ **O log é best-effort.** Falha ao gravar vira `console.warn` e a resposta
  segue: perder a linha do histórico é ruim, perder a análise que a pessoa
  acabou de esperar é pior.
- ⚠️ **A lista é só do PRÓPRIO usuário** (`created_by`). A policy de leitura de
  `ai_logs` é por location, então sem esse filtro dois administradores veriam as
  perguntas um do outro embaralhadas — e o que se quer reler é o que EU perguntei.
- **`recarregar()` no hook não é enfeite**: quem grava é a ROTA, no servidor,
  então o client não fica sabendo do insert e a análise recém-feita só apareceria
  na lista depois de um F5.
- Clicar numa linha traz pergunta e resposta de volta para a área principal;
  clicar na mesma linha fecha (senão a lista fica empurrada para fora da tela
  pela resposta aberta).

De passagem: `useLocationId` em `db/ai.ts` chamava `load()` e baixava os 41 mil
contatos só para descobrir a empresa — trocado por `ensureSession()`.

## Resumo do atendimento na finalização e na transferência (migração 0087)

O que aconteceu no atendimento ficava só na cabeça de quem atendeu. Quem assume
a conversa depois — ou atende o mesmo cliente quando ele volta a chamar semanas
mais tarde — tinha que rolar o histórico inteiro para descobrir o que já foi
tratado.

**Decisões do Gabriel:** resumo **opcional**, com **rascunho de IA**, e exibido
numa **faixa no topo da conversa**.

- ⚠️ **É NOTA INTERNA marcada, não tabela nova**: `messages.handoff_kind`
  (`finalizacao` | `transferencia`; NULL = nota comum). A nota interna já é onde
  vivem os comentários da conversa (botão "Nota" do card, ação `nota-interna` das
  automações, painel Observações) — tabela separada faria o resumo escrito aqui
  não aparecer lá, e o comentário de lá não contar como resumo.
- ⚠️ **Gravado por `public.save_handoff_summary` (SECURITY DEFINER)**, espelhando
  `log_conversation_event` (0084) pelo MESMO motivo: ao transferir, a conversa
  deixa de ser minha no instante seguinte e o `insert` direto é barrado pela RLS
  — justamente no caso em que o resumo mais importa. O autor vem de `auth.uid()`,
  nunca de parâmetro.
- `public.last_handoff_summary(conv)` alimenta a faixa. Lê por FUNÇÃO e não da
  lista de mensagens do store porque quem abre a conversa pode não ter
  visibilidade das mensagens antigas (atendente que só vê as suas, conversa de
  outro setor) — e é exatamente essa pessoa que precisa do resumo.
- **O rascunho é o que torna o opcional viável.** Com ~150 finalizações/mês
  (medido), um campo vazio ficaria vazio; e obrigar produziria uma fileira de
  "ok"/"resolvido" — preenchido e sem informação, pior que vazio porque dá
  aparência de histórico. "Finalizar sem resumo" é botão visível, não um X no
  canto.
- ⚠️ **O rascunho inclui a TRANSCRIÇÃO dos áudios** (0085). Sem isso, uma
  conversa toda em áudio chegaria à IA como uma pilha de "(áudio)" e o resumo
  sairia sem conteúdo.
- ⚠️ **Falha da IA não trava a finalização**: o campo continua editável, a pessoa
  escreve à mão ou segue sem resumo. Um `toast.info`, não um erro.
- **Arquivar NÃO pede resumo** — arquivar é tirar da vista, não encerrar um
  atendimento, então não há o que contar ao próximo. Só finalizar e transferir.
- **Transferir só pede resumo ao passar para OUTRA pessoa.** Assumir para si ou
  devolver à caixa do grupo não pede: não há "próximo atendente" a quem contar.
- O resumo é gravado ANTES do `close`/`assign`: a nota pertence ao atendimento
  que está sendo encerrado, e assim ela fica acima do evento "transferida para X"
  no fio.
- Rota `POST /api/conversations/summary` gera o rascunho (feature
  `handoff-summary` em `ai_logs`). A sessão do usuário lê as mensagens, então a
  RLS decide o que entra no resumo e quem não vê a conversa recebe 404 sem gastar
  chamada.

## "Lita ajuda" e o resumo na barra lateral (aba Resumo das Conversas)

O resumo do atendimento (0087) **saiu da faixa no topo do thread** e virou a aba
**Resumo** da barra lateral, ao lado de "Todos os campos", "DND" e "Ações" —
junto de Contato e Resumo pagamentos, que é onde o atendente já olha esse tipo de
informação.

⚠️ **Por que sair da faixa:** como faixa, o resumo empurrava a conversa para
baixo em TODA abertura, mesmo depois de lido, e competia com a faixa de estado
("Finalizada por X") logo abaixo — duas tarjas antes da primeira mensagem. Na
lateral ele fica disponível sem custar espaço do fio.

**Lita ajuda** (`/api/conversations/assist`, feature `lita-assist` em `ai_logs`)
é a outra metade da aba: a IA lê o atendimento e ajuda QUEM ESTÁ ATENDENDO.
Diferente do resumo, que conta o passado para o próximo atendente, aqui a
pergunta é "e agora?".

- ⚠️ **A classificação do tipo vem PRIMEIRO no prompt, e isso é o cerne.** Um
  chamado de VENDAS e uma dúvida de ALUNO pedem condutas opostas: no primeiro o
  objetivo é avançar para a matrícula, no segundo é resolver e **não** empurrar
  venda. Sem classificar, a IA devolve o mesmo conselho genérico para os dois.
  Tipos: `vendas`, `aluno`, `cobranca`, `suporte`, `outro`.
- Devolve `situacao`, `proximo_passo` (destacado — é a única coisa que o
  atendente precisa decidir agora), `sugestoes` e `atencao` (riscos, promessas
  não cumpridas, pedido do cliente sem resposta). Lista vazia é resposta válida:
  inventar ponto de atenção onde não há treina a pessoa a ignorar a seção.
- **Lê a transcrição dos áudios** (0085) e **o resumo anterior** (0087) junto das
  mensagens. Sem a transcrição, conversa em áudio chega como pilha de "(áudio)";
  sem o resumo, o combinado de um atendimento anterior fica fora da análise.
- O rodapé diz em quantas mensagens ela se baseou e se havia resumo — é o que
  permite calibrar a confiança: análise de 4 mensagens vale menos que a de 60.
- ⚠️ **Só roda no clique**, e o painel só monta quando a aba está aberta: uma
  chamada de IA por conversa aberta seria caro e inútil (o atendente abre dezenas
  por dia).
- O prompt proíbe inventar valor, prazo, nome de curso ou política da empresa, e
  manda dizer o que PERGUNTAR quando falta informação. `chat()` ganhou
  `json: true` (o `response_format` da OpenAI): pedir JSON só no texto do prompt
  funciona quase sempre e quebra justamente quando o modelo resolve explicar
  antes — e aí o `JSON.parse` estoura em produção. O parse continua defensivo.

## Mídia com legenda: o texto que se perdia (2026-08-26)

Foto ou arquivo enviado COM mensagem junto: a mídia aparecia e o texto
desaparecia. O balão renderizava `MediaContent` e **descartava o
`message.body`** — quem mandava uma foto escrevendo "tento clicar e aparece
essa informação" via só a foto, e a pergunta sumia da conversa. O texto sempre
esteve gravado (o webhook guarda `caption` em `body`); só não era exibido.
Eram 17 imagens e 1 vídeo neste banco.

⚠️ **`body` NÃO significa a mesma coisa em toda mídia** — foi por isso que a
correção precisou ser por tipo:
- `audio`: é a **duração** ("1:59"), consumida pelo player. Mostrar repetiria o
  tempo embaixo da onda.
- `file`: no que o atendente ENVIA, o composer grava o nome do arquivo; no que o
  cliente MANDA, é a legenda. Como o nome já aparece no bloco do arquivo, a
  legenda só é exibida quando difere de `mediaName`.
- `image` / `video`: é sempre legenda.

**O mesmo defeito, do outro lado:** o webhook gravava
`last_message_preview: body` direto, então mídia sem legenda deixava a linha da
conversa **em branco** na lista — 30 conversas. Agora usa `previaDeMidia`, com a
MESMA convenção de ícones que o composer já usava no envio (`📷 Imagem`,
`🎤 Áudio`, `📎 <arquivo>`): receber e enviar não podem descrever a mesma coisa
de dois jeitos na mesma lista.

A migração **0089** recompõe as prévias já gravadas em branco (12 recuperadas).
Só toca em prévia VAZIA — prévia preenchida pode ter vindo da transcrição do
áudio (0085) e sobrescrever com rótulo genérico perderia informação. As 18 que
continuaram vazias são conversas **sem nenhuma mensagem**, onde vazio é o certo.

## Dark mode: o tom de texto que faltava no remapeamento

Sintoma: no painel **"Lita ajuda"**, o bloco "Próximo passo" ficava com texto
invisível no dark — e o resumo do atendimento, ilegível.

A causa é o desenho do dark mode deste projeto, que remapeia CLASSE POR CLASSE
em `globals.css` (`.dark .bg-indigo-50 {...}`) em vez de espalhar `dark:` pelas
telas. É uma boa decisão — telas novas ganham dark de graça — mas com uma
armadilha: **o que não está na lista fica com o valor claro**. O bloco usava
`bg-indigo-50` + `text-indigo-900`; o FUNDO tinha override e o TEXTO não, então
sobrou texto escuro sobre fundo escuro.

⚠️ **Ao usar uma cor nova em texto, confira se ela está no remapeamento.** Não é
o Tailwind que erra: sem a regra, ele mantém o tom claro, que no fundo escuro
desaparece. Vale para todo tom fora dos 600/700, que eram os únicos cobertos em
indigo.

Os tons acrescentados (aditivo, no fim do arquivo) são os que o app realmente
usa e não estavam cobertos: `indigo-500/800/900`, `red-500`, `rose-700/800`,
`amber-500`, `emerald-500/800/900`, `sky-500/800/900`, `blue-500`. Não era só a
Lita — **`text-red-500` sozinho aparece em 24 lugares** do app.

Conferido no CSS COMPILADO (`.next/static/chunks/*.css`), não só no fonte: as
regras `.dark .text-indigo-500,...{color:#a5b4fc}` estão lá.

## ⚠️ `contacts.owner_id` NÃO é o atendente responsável (bug de 2026-08-26)

Sintoma: um ADMIN começou a receber conversas novas na caixa dele, sem ter
assumido nada. Não era o rodízio.

**Causa:** `contacts.owner_id` guarda quem INSERIU o contato — e a importação do
CRM antigo deixou os admins como donos de quase toda a base (32.018 contatos de
um, 8.947 do outro). O webhook do WhatsApp tratava "dono do contato" como
"atendente responsável":

```ts
...(ownerId ? { assigned_to: ownerId, bot_paused: true } : {}),
```

Ou seja: **qualquer um daqueles 32 mil contatos que mandasse mensagem caía direto
na caixa do admin** — e com `bot_paused`, então nem o bot atendia nem o rodízio
distribuía. O lead ficava parado ali.

A intenção original é boa (o cliente volta e cai com quem já o atendia), mas só
vale para quem ATENDE. Hoje o webhook confere o papel do dono e só usa
`assigned_to` quando ele é `role = 'user'`; sem dono elegível, a conversa segue o
caminho normal (bot → rodízio → fila do setor).

**Sobre limpar o `owner_id`** (feito depois, na 0091): a preocupação inicial era
que a coluna entrasse na visibilidade. Fui conferir as policies de `contacts`
antes de mexer, e o quadro é este:
- **SELECT: `location_id in private.user_locations()` — NÃO usa `owner_id`.** Todo
  membro já via todos os contatos da empresa. Zerar não muda nada aqui.
- **DELETE: `private.sees_all(location_id) or owner_id = auth.uid()`.** Os admins
  têm `only_assigned = false`, logo `sees_all` é true e continuam podendo
  excluir; e quem tem `only_assigned = true` já não podia excluir esses contatos,
  porque o dono era o admin.
- INSERT/UPDATE: só `location_id`.

Conferido como o usuário de risco (o único com `only_assigned = true`) DEPOIS da
limpeza: continua vendo os 41.401 contatos. ⚠️ Só ADMIN foi limpo —
`owner_id` de atendente é atribuição real de trabalho (Cibelle tem 186), e zerar
tiraria dela o direito de excluir os próprios contatos pela policy de DELETE.

⚠️ **A origem também foi corrigida:** a rota `/api/contacts/import` NÃO grava mais
`owner_id`. Carga de base não define proprietário — era isso que transformava
quem importava em "dono" de 41 mil pessoas que nunca atendeu. O cadastro
individual (`dbContactActions.add`) continua gravando: ali é uma ação deliberada
de quem está criando o contato.

A migração **0090** devolveu para a fila as conversas que já tinham caído assim,
com critério ESTREITO — as três condições juntas: atribuída a admin que é o dono
do contato, **sem nenhum evento** (evento = alguém assumiu ou transferiu à mão, e
decisão humana não se desfaz) e **sem nenhuma resposta humana** (se já
respondeu, o atendimento começou; tirar de quem está atendendo é pior que o bug).
Das 3 conversas afetadas, 2 voltaram para a fila e 1 ficou onde estava.
`bot_paused` continua `true` de propósito: liberar o bot agora faria ele disparar
mensagem automática para clientes que escreveram horas antes.

## Áudio "falhou" sem dizer por quê (2026-08-27)

Relato: "alguns usuários do CRM estão tentando enviar áudio e está falhando" —
o balão mostrava a palavra **falhou** e mais nada. O áudio aparecia gravado,
com onda e transcrição, o que já dizia que gravação, upload e transcrição
funcionaram: o que quebrou foi a **entrega**.

⚠️ **O motivo nunca era gravado.** `/api/whatsapp/send-media` fazia
`update({ status: "failed" })` e devolvia o texto do erro na resposta HTTP, que
virava um toast e sumia. `messages.error_detail` **existe desde a 0031** e o
webhook já o preenche para falha de ENTREGA — a falha de ENVIO simplesmente não
escrevia nele. E `graphError` (em `lib/whatsapp/client.ts`) já monta a mensagem
com código e subcódigo da Meta: a informação existia e era jogada fora. Sem ela
não há como distinguir "janela de 24h fechada" de "formato recusado", e a
conduta do atendente é oposta nos dois casos.

⚠️ **`Message` nem tinha o campo.** `mapMessage` mapeava `delivered_at` e
`read_at` e não `error_detail`, então a tela não conseguiria mostrar o motivo
nem quando o webhook o gravava. (O `select` é `*`, a coluna sempre vinha.)

⚠️ **A causa do "ALGUNS usuários": a escrita usava a SESSÃO e a RLS a recusava
em silêncio.** A policy `membros editam` de `messages` (última versão na
**0074**) exige `private.conv_assigned_to_me(conversation_id)` — ou ver tudo,
sem bot e sem atribuição. Um atendente que manda áudio numa conversa atribuída a
OUTRA pessoa (ou com bot) não gravava status nenhum, e **UPDATE recusado pela
RLS não vem com erro**: afeta 0 linhas, calado. Mesma armadilha já documentada
em `conversationActions.removeMessage`. Hoje a rota segue o padrão do projeto —
**a sessão AUTORIZA, a service role ESCREVE** (igual `resolveGuruUserToken` e a
rota de transcrição); quem não pode ver a conversa levou 404 muito antes.

⚠️ **Por que o texto não sofria do mesmo problema:** `/api/whatsapp/send`
**INSERE** a mensagem depois de a Cloud API aceitar, e INSERT recusado pela RLS
**devolve erro**. A rota de mídia **ATUALIZA** uma mensagem que o cliente já
inseriu de forma otimista — e é o UPDATE que falha calado. Era a assimetria que
fazia parecer "problema de áudio".

**Também corrigido:** o composer dava `toast.success("Áudio enviado")` **antes**
de tentar a entrega. O atendente lia "enviado" e só depois via o erro — ou nem
via, se o toast já tinha sumido. Gravar no inbox não é entregar ao cliente.

**Onde o motivo aparece agora:** numa faixa DENTRO do balão (`AlertTriangle` +
texto), não só no `title` do "falhou". Tooltip que exige descobrir que há algo
para passar o mouse em cima não comunica uma falha de entrega.

Todo caminho de recusa da rota agora grava o motivo — inclusive os antecipados
(janela de 24h, limite diário, mídia ausente, canal inativo, contato sem
telefone), via o helper `recusar()`. A janela de 24h em particular **passou a
marcar falha de propósito**: antes o balão nascia sem indicador nenhum e o
atendente não tinha como saber que o áudio não saiu.

⏳ **Falta:** botão de reenviar no balão que falhou (hoje é preciso gravar de
novo), e as falhas ANTERIORES a esta correção seguem sem motivo gravado — não dá
para reconstruir. Para ver o que as que passaram pelo webhook registraram:
```sql
select m.created_at, m.type, m.status, m.error_detail
  from public.messages m
 where m.direction = 'out' and m.status = 'failed'
 order by m.created_at desc limit 30;
```

## Áudio recusado pela Meta: era ESTÉREO (2026-08-27)

Continuação direta da seção acima. Com o motivo passando a ser gravado, o balão
finalmente disse qual era: **"Não foi entregue: Media upload error"**.

⚠️ **Esse texto veio do WEBHOOK, não da rota** — é `st.errors[0].title` em
`webhook/route.ts`, e não o `graphError` da rota (que sempre anexa
`· HTTP N · em upload /media`, ausente no balão). A diferença é o diagnóstico
inteiro: **a Meta ACEITOU o upload**, devolveu id de mensagem, e só recusou
DEPOIS, ao processar a mídia, reportando o erro 131053 de forma assíncrona. Ou
seja, o problema é o ARQUIVO, não a chamada.

⚠️ **A Cloud API aceita `audio/ogg` só com OPUS e só MONO** ("Mono input only",
na doc da Meta). E o `opus-media-recorder` tira o número de canais do
MICROFONE, não de opção nossa — em `start()`:
```js
this.channelCount = t[0].getSettings().channelCount || 1;
this.processor = this.context.createScriptProcessor(4096, this.channelCount, this.channelCount);
```
Então quem usa microfone/headset que reporta 2 canais gravava Opus **estéreo**, e
a Meta descartava. **É a explicação de "ALGUNS usuários": dependia do aparelho.**

⚠️ **Taxa de amostragem foi descartada como suspeita, não ignorada**: a lib
embute um reamostrador Speex (`_speex_resampler_init` em `OggOpusEncoder.js`),
então os 44,1 kHz de algumas máquinas não são o problema.

Também engana no diagnóstico o fato de o áudio **tocar no navegador e ser
transcrito pelo Whisper** — os dois aceitam Opus estéreo sem reclamar. Só a
Meta não.

**A correção tem duas camadas em `microfoneMono()`**, porque a primeira não é
garantia:
1. pedir mono na constraint (`channelCount: { ideal: 1 }`) — a maioria dos
   navegadores atende e não sobra trabalho;
2. se o track AINDA reportar mais de um canal, misturar para mono no Web Audio
   (`MediaStreamAudioDestination` com `channelCount 1` + `channelCountMode
   "explicit"` + `channelInterpretation "speakers"`, que SOMA os canais em vez de
   descartar um lado).

⚠️ **`{ exact: 1 }` resolveria em uma linha e foi rejeitado de propósito**: lança
`OverconstrainedError` no aparelho que não sabe abrir em mono, e aí o atendente
perde a gravação inteira em vez de perder um canal.

**`canaisDoOpus()` confere o resultado** lendo o byte 9 do `OpusHead` do arquivo
gravado (magia de 8 bytes + 1 de versão). "Deveria bastar" não é conferência:
quem decide os canais é o microfone, o navegador e o encoder, e nenhum dos três é
nosso. A magia é PROCURADA nos primeiros 200 bytes, não lida em posição fixa,
porque antes dela vem o cabeçalho da página Ogg, cujo tamanho varia com a tabela
de segmentos. Testado com 7 casos sintéticos (mono/estéreo/6 canais, tabela de
segmentos de tamanhos diferentes, lixo, buffer curto).

⚠️ **O aviso de estéreo NÃO bloqueia o envio.** O mono é a explicação mais
provável da recusa, não uma certeza — travar por hipótese tiraria o áudio de
quem talvez estivesse funcionando. O aviso dá o sinal, e o motivo real, se houver
recusa, agora fica gravado no balão.

De passagem: o microfone ficava ABERTO se a construção do gravador estourasse
depois do `getUserMedia` (o `catch` não parava o track), deixando o indicador de
gravação do navegador aceso sem nada gravando.

## Áudio: "Media upload error" é CATEGORIA, não motivo (2026-08-27)

Terceira rodada no mesmo sintoma, e a lição é sobre diagnóstico. O print do
atendente trouxe dois fatos que fecharam o cerco:

1. **o toast VERDE "Áudio enviado" apareceu** — e ele só aparece quando `wa.ok`,
   logo a rota devolveu 200: upload E envio ACEITOS pela Meta;
2. **o aviso de estéreo NÃO apareceu** — o arquivo estava mono.

Ou seja: a hipótese do estéreo (seção acima) **não era a causa**. A correção do
mono fica porque mono é o certo para recado de voz e a Meta exige, mas não era
ela.

⚠️ **`errors[0].title` é a CATEGORIA do erro, não o motivo — e era só ele que o
webhook guardava.** "Media upload error" (131053) cobre arquivo vazio, codec
errado, canais demais e tamanho, sem distinguir nenhum. O motivo específico vem
em **`error_data.details`**, e era exatamente esse campo que se perdia. Isso
custou rodadas de investigação: cada correção parecia não funcionar porque a
mensagem de erro era a mesma para causas diferentes. O webhook agora grava
`details · title · message · #código`, do mais específico para o mais genérico.

⚠️ **Furo na minha própria checagem, que mascarava o caso mais provável.** A
verificação no navegador era `if (canais !== null && canais > 1)`: o `null` —
"não achei o cabeçalho OpusHead" — passava CALADO, **indistinguível de mono**. Um
arquivo WebM ou WAV (que é o que sai se o codificador Opus não carregar) não
disparava aviso nenhum, e eu li "sem aviso" como "está mono". Ausência de
resultado nunca deve ser tratada como resultado bom.

**`src/lib/whatsapp/audio.ts`** (`inspecionarAudio`) passa a nomear cada caso:
vazio · contêiner ≠ ogg · ogg sem OpusHead · canais > 1 · aceitável. O contêiner
sai dos BYTES DE ASSINATURA (OggS, EBML, RIFF/WAVE, ftyp, ID3), não do mime
declarado — que é justamente o que pode estar mentindo. Testado com 11 casos
sintéticos.

⚠️ **A rota confere ANTES de mandar** (`kind === "audio"` → 422 com motivo
específico) porque a Meta mente sobre o momento da recusa: aceitar o upload e
recusar depois faz o toast dizer "enviado" e o balão dizer "falhou" na mesma
tela. Conferindo aqui, o motivo é específico, verificável e não custa a viagem.
**Inconclusivo NÃO bloqueia** — `inspecionarAudio` só reprova o que dá para
afirmar pelos bytes.

O módulo é UM e serve os dois lados (rota e composer): duas cópias da tabela de
assinaturas divergiriam na primeira mudança.

### A causa, dita pela própria Meta

Com `error_data.details` sendo gravado, a recusa veio inteira:

> Audio file uploaded with mimetype as **audio/ogg; codecs=opus**, however on
> processing it is of type **application/octet-stream**. Please choose a
> different file. · Media upload error · #131053

⚠️ **O parâmetro `; codecs=opus` no mime era o problema.** A lista de tipos
aceitos da Cloud API tem `audio/ogg`, **sem parâmetro**; com ele a Meta não
reconhece o arquivo, cai em `application/octet-stream` e acusa divergência entre
o declarado e o conteúdo. E como o rótulo do erro é sempre o mesmo
("Media upload error"), isso sobreviveu a três rodadas de correção.

De onde vinha: `audio/ogg;codecs=opus` **era o código antigo**, do
`MediaRecorder` nativo, removido em 4cc5bab quando entrou o
`opus-media-recorder`. A Meta reportou a forma COM espaço
(`audio/ogg; codecs=opus`), que é como o Firefox normaliza `Blob.type` — ou seja,
bundle antigo em cache no navegador de quem reclamou. O valor não existe mais em
lugar nenhum do nosso código (conferido com `git log -S` em todo o histórico).

⚠️ **A correção não é tirar o parâmetro: é parar de confiar no mime do cliente.**
Enquanto o tipo declarado à Meta vier de `file.type` do navegador — guardado no
Storage e devolvido no corpo da requisição —, a divergência declarado × conteúdo
é sempre possível: bundle em cache, navegador que anota diferente, arquivo
renomeado à mão. `mimeParaUpload` tira os parâmetros SEMPRE e, quando a
assinatura de bytes é conclusiva, declara o tipo do conteúdo REAL. A divergência
deixa de ser um caso a consertar e passa a ser impossível por construção.

⚠️ **Furo que o teste pegou na primeira versão de `mimeParaUpload`:** a condição
para farejar era só `limpo.startsWith("audio/")`. Um OGG legítimo cujo mime
tivesse se perdido no caminho (corpo sem `mime`, Storage devolvendo genérico) era
enviado COMO `application/octet-stream` — a divergência exata que a Meta recusa.
Hoje também fareja quando o declarado é octet-stream/vazio e quando o `kind` da
mensagem é `audio`, que é a intenção do usuário e não depende de nenhum mime ter
sobrevivido à viagem. `webm` e `wav` ficam FORA do mapa de propósito: a Cloud API
não aceita nenhum dos dois em áudio, e mapeá-los trocaria a recusa da Meta por
outra recusa da Meta.

Só reescreve quando a assinatura é CONCLUSIVA — palpite nosso por cima de um mime
declarado correto trocaria um erro por outro.

### ⚠️ Falha antiga é indistinguível de falha nova (e isso custou uma rodada)

Depois da correção do mime, o mesmo texto de erro voltou. Conferindo o código no
ar: `mimeParaUpload` tem só dois retornos — um mime do mapa (sem parâmetro) ou o
valor já passado por `mimeSemParametros` —, então **não existe caminho no `main`
que entregue `audio/ogg; codecs=opus` à Meta**. O texto era de antes do deploy.

A causa da confusão é estrutural e vale lembrar em qualquer investigação de envio:
**a recusa da Meta chega pelo WEBHOOK, de forma assíncrona, e fica em
`error_detail` até alguém sobrescrever.** Um balão aberto hoje mostra o motivo da
tentativa que falhou semana passada, com a mesma cara de uma falha de agora.

Por isso `media_mime` passou a guardar **o mime REALMENTE enviado**, não o que o
cliente alegou. Serve de marcador de versão: sem parâmetro = passou pelo código
novo. E o motivo da falha da Cloud API passa a carregar `[enviado como <mime>]`,
que é o que separa "o CRM declarou errado" de "a Meta recusou o arquivo certo".

De quebra a coluna ficou verdadeira: ela guardava `file.type` do navegador, e foi
exatamente essa alegação que se provou errada.

⚠️ **A limpeza do mime foi repetida DENTRO de `uploadMedia`** (não só em
`mimeParaUpload`, na rota). Não é redundância descuidada: essa é a única função
que fala com o endpoint de mídia da Meta, então é ali que o contrato dela pode ser
garantido para QUALQUER chamador — inclusive o próximo, que não vai lembrar da
regra. Provado com teste que intercepta o `fetch` e lê o multipart: entrando
`audio/ogg; codecs=opus`, `audio/ogg;codecs=opus`, `AUDIO/OGG` ou vazio, o campo
`type` E o Content-Type da parte do arquivo saem sempre sem parâmetro (5/5).

⚠️ **O log do `send-media` carrega o COMMIT** (`VERCEL_GIT_COMMIT_SHA`). Esta
investigação voltou duas vezes ao mesmo ponto por não haver como saber, olhando o
log, se o código no ar já tinha a correção. Com o SHA na linha, "é velho ou é
novo?" deixa de ser dedução. ⚠️ **O log do WEBHOOK não serve para isso**: ele é o
mensageiro da recusa, não quem enviou — o log que importa é o do `send-media`,
alguns segundos ANTES.

**Para saber se uma falha é velha ou nova:**
```sql
select m.created_at, m.media_mime, m.status, left(m.error_detail, 80) as motivo
  from public.messages m
 where m.type = 'audio' and m.direction = 'out'
 order by m.created_at desc limit 20;
-- media_mime com "; codecs=" = tentativa ANTIGA, de antes da correção.
```

## `GET /api/version` — qual código está no ar

⚠️ **Nasceu de uma investigação que voltou CINCO vezes ao mesmo ponto.** O áudio
recusado pela Meta (#131053) foi corrigido, mesclado na `main`, e o erro continuou
aparecendo com o texto ANTIGO. Sem saber qual commit estava em produção, três
situações completamente diferentes ficavam indistinguíveis:

1. a correção não funcionou;
2. a correção **não foi para produção** — risco que este arquivo já documenta:
   `vercel deploy` local, ou "Promote to Production" de um commit atrasado,
   sobrescrevem a produção com código velho;
3. a falha lida na tela era **antiga** — a recusa da Meta chega pelo webhook, de
   forma assíncrona, e fica em `error_detail` até ser sobrescrita, então um balão
   aberto hoje mostra o motivo da tentativa de ontem.

Deduzir entre as três custou rodadas de ida e volta. Agora é uma conferência de
dois segundos: abra `https://lito-crm.vercel.app/api/version` logado.

⚠️ **404 ali JÁ É a resposta**: o código no ar é anterior a esta rota.

⚠️ **`GET /api/whatsapp/send-media` responde o mesmo SEM LOGIN**, e é o que serve
para depurar de fora. Motivo: `api/whatsapp` está fora do matcher do `proxy.ts`
(é onde a Meta bate), então sob o proxy TODO caminho responde 307 para /login —
inclusive um inexistente —, e o 307 não distingue "rota existe" de "rota não
existe". Fora do proxy, a diferença aparece: **404 = não existe, 405 = existe mas
o método está errado, JSON = a rota respondeu**. Foi essa sondagem que deu a
saída depois de seis rodadas deduzindo a versão.

O objeto traz `commit`, `branch`, `mensagem`, `ambiente` e um bloco `correcoes`
com marcadores LITERAIS (`true` fixo no arquivo) das correções cuja ausência é
difícil de perceber pela tela. Ao consertar algo que gere a dúvida "isso subiu?",
acrescente uma linha ali.

⚠️ **O log do WEBHOOK não responde essa pergunta** — ele é o mensageiro da
recusa, não quem enviou. E a sequência de chamadas externas do `send-media`
também não serve de pista: ela é IDÊNTICA no código antigo e no novo, porque a
inspeção de bytes acontece em memória e não gera chamada.

⚠️ **Sem log, o marcador por mensagem é `media_mime`** (ver a seção do áudio):
ele guarda o mime REALMENTE enviado, então `; codecs=` ali significa tentativa
feita pelo código antigo.

Exige sessão (está dentro do matcher do `proxy.ts`): commit e branch não são
segredo, mas também não precisam ficar abertos na internet.

## Áudio: cabeçalho válido NÃO é fluxo válido (2026-08-27)

Sexta rodada no mesmo erro. O que finalmente destravou foi **medir em vez de
deduzir**: `GET /api/whatsapp/send-media` respondeu, de produção,
`{"commit":"6435788","correcoes":{"audioMimeSemParametro":true,...}}` — o código
novo ESTAVA no ar. Ou seja, as três rodadas gastas com o mime perseguiram a
coisa errada.

⚠️ **A frase da Meta tem duas metades e eu li a errada.**
"Audio file uploaded with mimetype as **audio/ogg; codecs=opus**, however on
processing it is of type **application/octet-stream**". A primeira metade é
provavelmente a Meta se CITANDO — `audio/ogg; codecs=opus` é a forma canônica
dela para nota de voz —, não citando o que mandamos. A queixa real é a segunda:
**o farejador dela não conseguiu reconhecer o arquivo**. Com o commit confirmado
no ar e o mime saindo sem parâmetro (provado no multipart), só sobra o CONTEÚDO.

⚠️ **`inspecionarAudio` lia só os primeiros 400 bytes.** Confirmava `OggS` no
início e `OpusHead` dizendo 1 canal — e passava. Cabeçalho válido não garante
fluxo válido, e era exatamente esse o furo: o arquivo que a Meta recusa **passa**
por essa checagem.

**`analisarOgg`** percorre as páginas e verifica o que a RFC 7845 exige e o
cabeçalho não prova:
- página 1 com marca BOS e carga `OpusHead`;
- **página 2 com `OpusTags`** — obrigatória, e é o que alguns codificadores de
  navegador omitem;
- ao menos uma página de áudio;
- última página com marca **EOS** (fluxo fechado);
- nenhum byte fora de página (truncamento).

⚠️ **Navegador e Whisper toleram a falta de qualquer um desses** — foi por isso
que "o áudio toca e é transcrito" pareceu prova de arquivo bom durante cinco
rodadas. Parser estrito não tolera.

Testado com 5 fluxos sintéticos montados página por página (completo, sem
OpusTags, sem EOS, só cabeçalhos, truncado). O granule é lido como dois inteiros
de 32 bits em vez de BigInt: em 48 kHz nem áudio de horas passa de 2^53.

### O fluxo está ÍNTEGRO — e a Meta recusa de todo jeito

Conferido em produção: `GET /api/whatsapp/send-media` devolveu
`analiseDeFluxoOgg: true` (commit 976e2e5) e a rota respondeu **200**. Como
`analisarOgg` reprova qualquer fluxo com problema, isso é prova de que o arquivo
é um Ogg/Opus **mono, com OpusTags, com EOS, sem truncamento**. E a Meta continua
dizendo que ao processar virou `application/octet-stream`.

⚠️ **O dado que falta mora em `console.log`, num painel do Vercel que ninguém
acha na hora do problema.** Pedi o log três vezes e recebi o painel "Request"
(que não mostra stdout) três vezes — a culpa é do lugar onde eu pus a informação,
não de quem procurou.

**Agora o retrato do arquivo vai para o BALÃO.** No sucesso, `error_detail`
guarda `[diag] bytes=... head[v= ch= preskip= taxa= ganho= map=]
ogg[pag= tags= audio= eos= granule= sobra=]`, e o webhook **preserva** esse
prefixo ao escrever a falha em vez de sobrescrever. A frase da Meta descreve o
SINTOMA; o retrato, que só quem tem os bytes pode montar, é o que explica a
causa — juntar os dois numa linha só é o que torna a próxima tentativa
conclusiva.

⚠️ **Furo que quase anulou isso:** o webhook lia a mensagem com
`select("id, status, delivered_at")`. Sem `error_detail` no select,
`msg.error_detail` vinha `undefined` e o retrato seria descartado em silêncio —
o preservador funcionaria e não preservaria nada.

**Os campos novos são os candidatos que sobraram:** `map`
(`channel_mapping_family` ≠ 0 exige tabela de mapeamento e faz decodificador
estrito recusar) e `granule` (granule final ZERO num áudio de segundos é defeito
conhecido de codificador JS — sem ele o decodificador não determina a duração e
desiste, o que casa com "ao processar virou octet-stream"). 6/6 campos conferidos
em teste.

### Lição de método (a parte que mais custou)

Seis rodadas, e o gargalo nunca foi a correção — foi **não saber qual código
estava rodando**. Enquanto isso era dedução, cada retorno do mesmo texto de erro
tinha três explicações incompatíveis (não funcionou / não subiu / a falha era
antiga) e eu escolhia uma por palpite. Ao consertar algo cujo sintoma chega de
forma assíncrona (webhook, cron, fila), **construa o marcador de versão junto com
a primeira correção**, não na sexta.

## A causa do áudio recusado: `pre-skip = 0` (2026-08-27)

Sétima rodada, e o retrato do arquivo REAL — que só apareceu quando o diagnóstico
passou a ir para o balão em vez do `console.log` — deu a resposta em uma linha:

```
[diag] bytes=19915 head[v=1 ch=1 preskip=0 taxa=48000 ganho=0 map=0]
       ogg[pag=7 tags=true audio=5 eos=true granule=146880 sobra=0]
```

Tudo saudável: mono, OpusTags presente, EOS presente, sem truncamento, granule
coerente (146880/48000 = 3,06 s). **Uma única anomalia: `preskip=0`.**

⚠️ **`pre-skip = 0` é inválido para Ogg/Opus.** O Opus tem atraso algorítmico
inerente — o libopus a 48 kHz reporta 312 amostras (6,5 ms) de lookahead — e a
RFC 7845 exige que o muxer grave esse número no `pre-skip`, porque é com ele que
o decodificador converte granule em posição PCM (`granule - pre_skip`). O
`opus-media-recorder` grava zero: nunca consulta o encoder.

⚠️ **É por isso que "o áudio toca e o Whisper transcreve" enganou por seis
rodadas.** Navegador e Whisper ignoram o campo. Demuxer estrito (ffmpeg, que a
Meta usa) falha — e demuxer que falha é EXATAMENTE a frase dela: "on processing
it is of type application/octet-stream". Não era o mime, não era o estéreo, não
era a estrutura do fluxo.

**Corrigido no servidor** (`corrigirPreSkip`), não no navegador: o encoder é
WebAssembly de terceiro, e neste ponto o arquivo já está em mãos.

⚠️ **Mudar a carga da página obriga a REFAZER o CRC-32 dela.** Cada página Ogg
carrega um CRC sobre ela inteira (com o próprio campo zerado no cálculo).
Reescrever o `pre-skip` sem refazer o CRC trocaria um arquivo que o navegador
aceita por um que NADA aceita.

⚠️ **A correção se AUTOVALIDA e é a parte mais importante do desenho:** ela só
age se o CRC calculado por `crcOgg` conferir com o gravado em TODAS as páginas.
Se a minha implementação de CRC estivesse errada, ela não bateria com a do
codificador — e reescrever produziria arquivo pior do que o atual. Não
conferindo, devolve os bytes originais e diz por quê no diagnóstico.

O CRC é escrito **bit a bit, direto da especificação** (polinômio 0x04C11DB7,
início 0, sem reflexão, sem xor final): é lento — irrelevante para páginas de
dezenas de bytes — e obviamente correto, enquanto uma tabela esconderia um erro
de reflexão que só apareceria em produção. Conferido contra uma segunda
implementação, escrita com tabela: `crc("123456789") = 0x89a1897f` nas duas.

Testado: preskip=0 com CRC válido → corrige e o CRC segue conferindo 4/4;
preskip=312 → não mexe; CRC corrompido → **recusa** mexer; sem OpusHead → não
mexe.

⏳ Se um dia o `opus-media-recorder` for trocado ou corrigido, `corrigirPreSkip`
vira no-op sozinha (só age quando o campo é 0) — não precisa ser removida.

## Áudio por LINK: tirando o nosso upload da equação (2026-08-27)

O `pre-skip` foi corrigido e conferido — o balão devolveu
`head[... preskip=312 ...] ogg[... crc=8/8] preskip 0->312 (crc refeito, 8
paginas conferidas)` — e a Meta **seguiu recusando** com #131053.

Nesse ponto o arquivo está impecável por toda medida calculável: mono,
`pre-skip` da RFC, OpusTags, EOS, CRC de todas as páginas conferindo, sem
truncamento, granule coerente. **Oito hipóteses sobre o ARQUIVO, oito erradas.**
A pergunta muda: o problema é o arquivo ou a nossa TRANSMISSÃO dele?

⚠️ **`sendMediaMessage` passou a aceitar `{ link }` além de `{ id }`.** Com
link, a Meta baixa o arquivo direto do nosso Storage e o multipart sai do
caminho. Ou funciona — e o problema era o upload — ou falha igual, e aí a causa
não está em nada que o CRM controla (número, WABA, permissão de nota de voz).
Isso é bisseção, não mais um palpite.

**Só ÁUDIO muda de caminho.** Imagem, vídeo e documento nunca deram problema, e
trocar o caminho deles seria arriscar o que funciona para investigar o que não
funciona.

⚠️ **O objeto é REGRAVADO antes de a URL ser assinada, e sem isso o link seria
um tiro no pé** — os dois motivos anulariam o teste:
1. o link serve os bytes ARMAZENADOS, que são os originais, com `pre-skip = 0`;
   assinar sem regravar desfaria em silêncio a correção feita alguns passos
   antes;
2. o link serve o `content-type` ARMAZENADO, gravado pelo navegador no upload. Se
   ele tiver o parâmetro (`audio/ogg; codecs=opus` — o que um bundle antigo em
   cache produz), a Meta veria exatamente a string da qual reclama desde a
   primeira rodada.

`upsert` no mesmo caminho, não arquivo temporário: o áudio do próprio inbox passa
a ser a versão corrigida (melhor, não pior) e não sobra lixo para limpar.

⚠️ A URL assinada vale **10 minutos**: o bucket é privado e URL de mídia de
cliente não pode ficar pública nem valer para sempre. A Meta busca em segundos —
a validade só cobre reprocessamento dela.

O diagnóstico do balão passa a dizer `via=link` ou `via=upload`, então qual
caminho foi usado deixa de ser suposição.

⏳ **Se falhar por link também**, o CRM está fora de suspeita e o próximo passo é
o painel da Meta (número, WABA, permissão de mensagem de voz) — não código.

## Áudio: MP4/AAC no lugar do Ogg/Opus (2026-08-27) — o fim da novela

⚠️ **A bisseção por `link` deu a resposta, e ela invalidou nove rodadas de
leitura da mensagem de erro.** Enviando por `link` (a Meta baixando o arquivo do
nosso Storage), o multipart sai do caminho e **nós não declaramos mimetype
nenhum**. A recusa voltou IDÊNTICA, palavra por palavra, inclusive a parte
"uploaded with mimetype as audio/ogg; codecs=opus".

Conclusão: **aquele texto é modelo fixo da Meta, não medição.** Usá-lo como pista
foi o que produziu as rodadas de mime, estéreo, contêiner, fluxo e `pre-skip`. Em
mensagem de erro de API, "a frase menciona X" não é evidência de que X seja o
problema — e essa é a lição transferível daqui.

O que ficou provado, somando tudo:
- o arquivo é um Ogg/Opus impecável (mono, `pre-skip` 312, OpusTags, EOS,
  `crc=8/8`, sem truncamento, granule coerente);
- a nossa transmissão não é o problema (falha igual por upload e por link);
- **a Cloud API simplesmente não processa o Ogg/Opus do `opus-media-recorder`.**

**A saída é trocar o formato**, não continuar agradando o decodificador dela.
`formatoDeGravacao()` no composer prefere **`audio/mp4` (AAC)** pelo
`MediaRecorder` NATIVO — Chrome 111+ e Safari suportam, e o usuário que relatou
está em Chrome 151. MP4/AAC é formato de primeira classe na lista da Cloud API, e
isso tira da jogada o encoder WebAssembly de terceiro, que era o único componente
ainda não eliminado.

O Ogg/Opus fica como **reserva** para navegador sem MP4: continua tocando no
inbox e sendo transcrito, mesmo que a Meta o recuse. Não foi removido porque
remover deixaria esses navegadores sem gravação nenhuma.

⚠️ **`inspecionarAudio` passou a aceitar `mp4` e `mp3`.** Ela exigia OGG, e
manter essa exigência bloquearia justamente a saída encontrada. As checagens de
`OpusHead`/páginas/EOS continuam valendo **só para OGG** — sobre MP4 não há o que
conferir por bytes sem escrever um parser de caixas MP4, e não vale escrever um
para checar o que a Meta aceita sem reclamar.

⚠️ **O mime gravado no arquivo é sempre a forma SEM parâmetro** (`audio/mp4`),
mesmo quando o `isTypeSupported` só aceitou `audio/mp4;codecs=mp4a.40.2`. O
servidor limpa de novo, mas sujar na origem seria reintroduzir de propósito a
confusão que custou rodadas.

**Áudio voltou ao caminho de UPLOAD**: o `link` era o experimento, e concluído o
experimento vale o caminho documentado, que tem menos dependências (sem URL
assinada, sem a Meta precisar alcançar o nosso Storage). `{ link }` continua
suportado e testado em `sendMediaMessage` — custa nada manter e evita reescrever
se a bisseção precisar ser repetida.

⏳ Se o MP4 também for recusado, o CRM está fora de suspeita: arquivo válido, dois
caminhos de transmissão, dois formatos. O próximo passo passa a ser o painel da
Meta (número, WABA, permissão de mensagem de voz), não código.

## Áudio, rodada 10: o que a Meta RECEBEU (2026-08-27)

⚠️ **Correção da conclusão anterior.** A seção acima afirma que o texto do erro é
"modelo fixo, não medição". **Está errado.** Ao enviar MP4, a mensagem mudou para
"uploaded with mimetype as **audio/mp4**" — ou seja, ela ESPELHA o que
declaramos. A base daquela conclusão era o envio por `link`, em que não
declaramos mimetype e a Meta citou `audio/ogg; codecs=opus`; a explicação
provável é que ela leu o `Content-Type` do nosso Storage (o `upsert` do
Supabase talvez não atualize o content-type de objeto existente — não confirmado).

Com o texto sendo medição de verdade, a segunda metade também é: **o farejador da
Meta genuinamente não identifica o nosso arquivo.**

⚠️ **E aqui está o fato que reorienta tudo:** ela responde
`application/octet-stream` tanto para um OGG com `OggS` no byte 0 quanto para um
MP4 com `ftyp` no byte 4. **Nenhum farejador erra as duas** — são as duas
assinaturas mais triviais que existem. Isso empurra a suspeita para fora do
arquivo e para cima dos BYTES QUE ELA RECEBE.

**Teste que nunca havia sido feito:** subir, **baixar de volta da Meta**
(`getMediaInfo` + `downloadMedia`, ambos já existiam) e comparar tamanho e hash
com o que enviamos. Responde de vez:
- **DIVERGENTE** → o nosso upload corrompe (multipart / Blob / undici) e o
  conserto é no CRM;
- **IDENTICO** → a Meta recebeu exatamente o nosso arquivo e recusa por conteúdo;
  o CRM sai de suspeita e o caminho passa a ser o painel dela.

O resultado entra no diagnóstico do balão como
`meta[bytes=.../... mime=... enviei=... hash=.../... IDENTICO|DIVERGENTE]`.

⚠️ **Best-effort de propósito:** é diagnóstico, e falhar aqui não pode impedir o
envio — a mensagem já foi aceita pela Meta nesse ponto do fluxo.

### Lição de método, agora com dez rodadas de evidência

1. **Mensagem de erro de API não é diagnóstico.** "A frase menciona X" não é
   evidência de que X seja a causa. Nove rodadas (mime, estéreo, contêiner,
   fluxo, pre-skip) saíram de ler a frase como se fosse medição — e a décima
   mostrou que ela é medição de uma coisa DIFERENTE do que eu supunha.
2. **Diagnóstico de falha assíncrona tem que aparecer onde a falha aparece.** O
   dado que resolveu ficou três rodadas num `console.log` que eu mandei procurar.
3. **Marcador de versão junto com a primeira correção**, não na sexta.
4. **Quando duas hipóteses independentes sobre o mesmo componente falham, o
   componente provavelmente está certo.** Dois formatos e dois caminhos de
   transmissão recusados é sinal de olhar para fora, não de tentar o terceiro
   formato.

## Áudio: era REGRESSÃO, e eu levei 11 rodadas para perguntar isso

⚠️ **A informação que reorientou tudo: "ontem os áudios eram enviados
normalmente e hoje parou".** Onze rodadas tratando como defeito estático — nove
hipóteses sobre o arquivo, duas sobre a transmissão — quando a primeira pergunta
devia ter sido **"quando parou de funcionar?"**. Regressão e defeito antigo pedem
investigações opostas: uma olha o que mudou, a outra olha o que está errado.

**A linha do tempo aponta um candidato:**

| horário | evento |
|---|---|
| 27/08 **10:08** | deploy de `b36f0fe` — "abrir conversa escolhe canal do departamento do usuário" |
| 27/08 **10:46** | primeiro relato de áudio falhando |

`b36f0fe` mudou **qual canal (qual número) a conversa usa**: antes `open()` pegava
o canal ativo MAIS ANTIGO, agora escolhe um vinculado ao departamento do usuário.
Mídia é enviada em duas etapas contra o MESMO `phone_number_id`
(`POST /{pnid}/media` e depois `POST /{pnid}/messages`), e a mídia fica **escopada
nesse número** — #131053 é justamente o erro dessa família.

⚠️ **O que a evidência JÁ descarta**, e isso vale para não reabrir becos sem
saída:
- **o arquivo**: válido byte a byte, em dois formatos independentes;
- **a nossa transmissão**: round-trip com hash IDÊNTICO, e a Meta tipa a mídia
  guardada como `audio/mp4`;
- **o plano do Supabase**: não afeta o que a Meta faz com um arquivo que já está
  íntegro na mão dela.

O diagnóstico do balão passa a trazer
`canal[id= pnid= waba= nome= pedido=cliente|conversa]`. Sem o número ali, "é o
canal?" seguiria sendo suposição — e o campo `pedido` diz se o canal veio do
cliente (`channelId` no corpo) ou da conversa, que é exatamente o que `b36f0fe`
mexeu.

⚠️ **Teste que discrimina em 5 segundos:** enviar uma IMAGEM na mesma conversa.
Imagem e áudio passam pela MESMA rota, com o MESMO canal e o mesmo par
upload+send. Se a imagem também falhar, o problema é do canal/número; se a imagem
for e o áudio não, é específico de áudio naquele número.

### Lição de método (a mais importante desta série)

**Antes de formular a primeira hipótese, pergunte quando começou.** "Funcionava
ontem" transforma o problema: a resposta está no `git log` daquele intervalo, não
no domínio do problema. Custou onze rodadas.
## Painel: as roscas saíram e as barras entraram (2026-08-27)

Pedido: "melhorar o visual desses gráficos e cards para uma análise melhor". Ao
medir os números reais em tela, o problema não era estética — **três dos cinco
gráficos não conseguiam mostrar o dado que tinham**.

⚠️ **A barra do funil MENTIA sobre a grandeza.** A largura era
`Math.max(18, (count/max)*100)`, e o piso de 18% existia para o rótulo caber
DENTRO da barra. Com os dados de hoje, **7 das 8 fases eram desenhadas a 18%**
enquanto valiam de 0% a 6,8% — e uma fase VAZIA saía com barra de 18% de
largura. A correção não foi mexer no piso: foi tirar o rótulo de dentro (nome à
esquerda, contagem/valor à direita), o que liberou a barra para ser
proporcional e tornou impossível texto cortado por marca pequena. De quebra a
linha caiu de 40 px para 20 px, e um pipeline de 9 fases passou a caber ao lado
do card vizinho em vez de esticar o painel.

⚠️ **Rosca com uma fatia de 98% não mostra composição.** "Status da
oportunidade" tinha 307 abertas de 313: a fatia de abertas tomava o anel e as
duas de 1% (3 oportunidades cada) viravam um fio de um pixel. 150 px de altura
para dizer "existe uma cor". Hoje é número grande + barra de composição de 6 px
+ três linhas rotuladas.

⚠️ **Rosca de 9 fatias precisava de uma legenda de 9 linhas ao lado** —
"Distribuição de fases". Ou seja, a informação já estava toda em texto e o anel
era o que sobrava; e passando de ~6 fatias as vizinhas ficam indistinguíveis de
qualquer jeito. Virou barra rotulada por fase.
A ordem é **a do pipeline, não a do tamanho**: fase é categoria ORDENADA e é a
sequência que responde "onde o funil está entupido".

⚠️ **Anel radial em 1% é indistinguível de zero.** "Taxa de conversão" desenhava
um risco de dois pixels no topo do anel enquanto o texto no meio dizia 1%.
Razão contra um limite é **medidor reto**, não rosca. O card também passou a
separar ganho / perda / ainda em aberto, porque conversão baixa pode ser
"perdemos" ou "ninguém decidiu ainda" — conclusões opostas que o anel fundia — e
a dar a taxa **entre as decididas**, a única comparável entre períodos de
tamanhos diferentes.

⚠️ **Dois dos quatro KPIs do topo apareciam sem fiapo de gráfico.** Série toda em
zero (receita R$ 0, ticket R$ 0) fazia o `<Area>` desenhar a linha na borda de
baixo do container, onde metade do traço de 2 px é recortada — o card parecia
quebrado em vez de dizer "não houve movimento". Série zerada agora não desenha
gráfico: mostra uma régua e a frase.

**Peças compartilhadas** em `components/dashboard/widget-card.tsx`
(`MarkedBarRow`, `ShareBar`, `Meter`) — quatro cards desenham a mesma marca, e
em cópias separadas a espessura da barra e o arredondamento divergiriam na
primeira mudança.

- ⚠️ **Toda marca com valor > 0 tem largura mínima de 3 px** (`MIN_PX`). Era o
  defeito central das roscas: 3 em 313 virava fio invisível e o card afirmava
  que só existia uma coisa ali. Zero é a única grandeza que pode desaparecer.
- ⚠️ **A escala das barras é o MAIOR item, não o total** (valor por status,
  distribuição de fases). Contra o total, oito barras de 1–6% ficam
  indistinguíveis entre si — e comparar entre si é a pergunta do card.
- ⚠️ **O valor é rótulo DIRETO, não conteúdo de tooltip.** Além de tirar a
  obrigação de passar o mouse, é o que sustenta a paleta: medido com o
  validador, verde `#22c55e` × vermelho `#ef4444` dá ΔE 7,4 em deuteranopia —
  dentro do piso, legal **somente** com codificação secundária. O texto ao lado
  da marca é essa codificação. (Escurecer os dois para green-600/red-600
  PIORA: ΔE cai para 5,0 e reprova. Foi medido, não estimado.)
- Separação entre fatias da barra de composição é **vão de 2 px da superfície**,
  não contorno desenhado em volta de cada uma.
- ⚠️ **`<1%` na lista, `0,9%` na manchete.** Com 3 de 313 (0,96%),
  `Math.round` dava "1%" — indistinguível de 3,1 de 313, e ao lado de um "98%"
  a soma não fecha. `toFixed(1)` é pior: "1,0%" sugere precisão e cruza
  justamente o limiar que a lista chama de "<1%". A manchete TRUNCA, e abaixo de
  0,1% escreve "<0,1%" — truncar daria "0%" com oportunidade ganha embaixo.
- **`% da fase anterior` acima de 100% fica âmbar.** Não é erro de conta: num
  RETRATO do funil os leads não avançam em bloco, então a fase pode ter mais
  gente que a anterior. Mas ler "250%" como conversão engana, e a cor é o que
  faz parar e ler o `title` da coluna. ⏳ **A métrica em si continua discutível**
  — quem está em "Em contato" não veio dos 2 que estão em "Qualificado" agora;
  medir avanço de verdade pediria histórico de mudança de fase, que o schema
  não guarda. Não foi mudado porque o pedido era visual.
- Dark mode: `text-slate-300` foi acrescentado ao remapeamento. ⚠️ Aqui o erro é
  o INVERSO do bloco da Lita: slate-300 é tom CLARO, então sem override ele não
  desaparece no fundo escuro — ele **grita**, com mais contraste que o texto
  principal, e o rótulo secundário puxa o olho antes do número.

Recharts saiu de `opportunity-widgets.tsx` (as três marcas agora são CSS), mas
`TOOLTIP_STYLE` **continua exportado de lá** — é a casa dele e
`funnel-widgets`/`payment-widgets` importam deste módulo.

## Guarda das migrações (`npm run db:check` / `db:apply`)

Pedido do Gabriel em 2026-08-27: "proteção para rodar querys do supabase,
porque algumas estão dando conflitos — não só as nossas, a do outro Claude
também". Ao medir, o conflito não era descuido: era **desenho**.

### O que estava errado

⚠️ **O número da migração vinha de um contador COMPARTILHADO.** A regra antiga
mandava dar `git pull` e pegar "o próximo número livre" — o que só funciona se
uma pessoa escreve de cada vez. Com dois Claudes, ambos puxam, ambos veem 0085
como maior, ambos escolhem 0086. Resultado: **12 números duplicados**, e cada par
é um de cada agente no mesmo dia (0078 `busca_de_contatos` × `import_dedup`;
0087 `resumo_do_atendimento` × `assumir_ao_enviar`; 0090
`devolve_lead_que_caiu_no_admin` × `recuperar_email_import`).

⚠️ **O aplicador não registrava nada.** `apply-migration.mjs` era
`begin; query(sql); commit;` e ponto: nenhuma checagem, nenhuma ideia se já
tinha rodado, nenhum aviso de quantas linhas ia mexer. Combinado com o fato,
já documentado, de que `supabase_migrations.schema_migrations` **não** registra
o que é colado no SQL Editor, ninguém sabia o que estava aplicado — foi assim
que a 0036 passou dias tida como pronta sem estar.

⚠️ **`.env.local` não tem `DATABASE_URL` e falta o CA em `scripts/`**, então o
aplicador **não roda** e o caminho real sempre foi colar no SQL Editor. Uma
guarda que exigisse conexão não rodaria — e checagem que não roda é o que
deixou os 12 números colidirem. Por isso a guarda é dividida: a estática
funciona sem nada configurado, e sem conexão o script **gera
`.migracao-para-colar.sql` já com o `insert` do registro no fim**, para que até o
caminho manual fique registrado.

### Como usar

```bash
npm run db:check                      # só o que mudou vs HEAD (use no commit)
npm run db:audit                      # auditoria das 103 migrações
npm run db:apply supabase/migrations/AAAAMMDDHHMM_nome.sql
npm run db:apply <arq> -- --so-checar # sem tocar no banco
```

Com conexão, `db:apply` faz: guarda → "já rodou?" → **ensaio numa transação
revertida, mostrando as linhas afetadas por comando** → confirmação digitada
("aplicar") → aplica e registra **na mesma transação** (registro fora dela
poderia dizer "aplicada" com a migração revertida).

### Peças

- `scripts/lib/sql-split.mjs` — divide o SQL em comandos.
  ⚠️ **`split(";")` quebraria metade do repositório**: 50 das 103 migrações têm
  corpo de função entre `$$` (com tags `$function$`, `$p$`), onde ponto e vírgula
  é código. Trata também `--`, `/* */` **aninhado** (o Postgres aninha),
  `'texto'` com `''`, `E'...'` com barra invertida, `"identificador"` e `$1`
  (parâmetro, não delimitador). Testado: 10/10 casos unitários e **os 974
  comandos das 103 migrações começam com palavra-chave SQL válida** — nenhum
  corte no meio de corpo de função.
- `scripts/lib/migration-checks.mjs` — as regras. **Cada uma existe por causa de
  um problema que este repositório já teve, e o comentário dela diz qual.**
- `scripts/check-migrations.mjs`, `scripts/apply-migration.mjs` — as CLIs.
- Registro: **`private.migrations_aplicadas`** (arquivo, hash, quando, por quem,
  nº de comandos, se foi forçada). No schema `private` com RLS ligada e **nenhuma
  policy** — mesmo desenho de `private.automation_config`. A tabela é criada pelo
  próprio script (`create ... if not exists`), sem arquivo de migração: uma
  migração para criar o registro precisaria ser registrada num registro que
  ainda não existe.
- `LITO_AGENTE` no ambiente identifica quem aplicou; sem ela, `git config user.name`.

### Decisões que valem a pena não refazer

- ⚠️ **`db:check` olha só o que MUDOU, por padrão.** As 103 migrações antigas
  acumulam 54 achados de idempotência que são história já aplicada. Checar tudo
  por padrão faria a saída ser ignorada no primeiro dia; `--todos` existe para
  quando a pergunta é a auditoria.
- ⚠️ **As regras foram CALIBRADAS contra as 103 migrações, não chutadas.** A
  regra de `security definer` sem checagem de empresa disparava **65 vezes**, das
  quais 48 eram ruído: 36 funções do schema `private` (não exposto na API) e 12
  `returns trigger` (gatilho roda no contexto de quem escreveu a linha — não há
  "empresa do chamador" a conferir). Recortada para `public.*` e não-trigger,
  caiu para 11.
- ⚠️ **Um defeito meu que a calibração pegou:** a regra procurava
  `private.user_locations()` no *esqueleto* do comando — e o esqueleto troca o
  corpo entre `$$` por um marcador, que é exatamente onde a checagem mora. Ela
  disparava em toda função definer de `public`, inclusive na
  `lead_payment_profile`, que é a origem do padrão. A menção agora é procurada no
  SQL cru; as regras estruturais seguem no esqueleto (senão a palavra "delete"
  dentro de um comentário ou de um nome de policy viraria alerta).
- ⚠️ **`drop policy/trigger/index/function if exists` NÃO conta como
  destrutivo.** É o próprio idioma da idempotência do projeto; sinalizá-lo faria
  o alerta aparecer em quase toda migração, que é o caminho mais curto para
  ninguém mais ler o alerta.
- **A gravidade do `revoke` ausente é graduada**, porque o estático não sabe se a
  função já existia (medido: das 32 criações em `public`, **31** usam
  `or replace`, e `create or replace` NÃO reseta grants). `grant` sem `revoke` é
  o bug da 0080 em estado puro → **erro**. `create function` sem `or replace` é
  nova por definição → **erro**. `or replace` que não mexe em privilégio →
  **nota**.
- O ensaio usa `try/finally` com `rollback` no `finally`: ensaio não pode deixar
  rastro nem quando estoura no meio.
- Arquivo **já registrado com hash DIFERENTE** é pior que "já rodou" — significa
  que o arquivo mudou depois de aplicado e o banco discorda do repositório. O
  script grita isso em vermelho separado.

### O que a guarda achou de imediato

Rodando `npm run db:audit` na primeira vez: **17 das 26 funções criadas em
`public` recebem `grant execute` e nunca `revoke ... from public, anon`** — ver a
correção em vermelho na seção "Avisos do linter de segurança do Supabase". A
frase que o `AGENTS.md` tinha ali (de que 0047/0048/0078/0079 já faziam o par)
estava errada.

## Relatório de Atendimento em XLSX (substitui o CSV)

Pedido: "o relatório que baixamos dessa tela é muito genérico, vamos incluir
gráficos e deixar como um relatório corporativo". Escolha do Gabriel: **XLSX com
abas**, e **sem manter o CSV**.

⚠️ **Limitação dita antes de construir: biblioteca de XLSX no navegador NÃO gera
gráfico nativo do Excel.** O SheetJS não escreve nenhum e no ExcelJS isso está em
aberto há anos. Então "planilha com gráficos" existe de duas formas, e o
relatório usa as duas:
1. **barra de dados nativa** (formatação condicional) nas colunas de volume e
   cumprimento — vale mais que imagem porque acompanha a ordenação e o filtro
   que o leitor aplicar;
2. **imagem PNG embutida** dos dois gráficos, desenhada em canvas
   (`sla-graficos.ts`).

⚠️ **A aba "Atendimentos" é o CSV que saiu, e não é enfeite.** Uma linha por
conversa com a `situacao` já resolvida em texto. Sem ela, tirar o CSV tiraria a
única coisa que ele fazia bem — tabela dinâmica e cruzamento com a planilha da
equipe. `csvDeAtendimentos` foi REMOVIDA de `sla.ts`: manter as duas saídas
deixaria duas definições de "situação" para divergirem na primeira mudança.

⚠️ **`exceljs` entra por import DINÂMICO** (~940 KB). Import estático colocaria
isso no bundle de quem só abre o painel e nunca baixa relatório.

**Canvas e não SVG→PNG** nos gráficos: o caminho por SVG exige serializar,
carregar numa `Image` e esperar `onload` — assíncrono, sujeito a CSP em `data:` e
com fonte que pode não resolver. Desenhado em 2× e exportado no tamanho lógico,
porque no Excel a imagem é ampliada com o zoom e em 1× o eixo sai borrado.

**Bloco de metodologia no Resumo** (expediente, meta, "primeira resposta
HUMANA", não-respondidas no denominador, mediana ≠ média). Não é burocracia: este
projeto já mediu que a média era 675 min contra mediana de 14, e que ignorar o
expediente levava o p90 de 2h33 para 45h. Relatório que circula sem a régua
produz discussão sobre o número em vez de sobre o atendimento.

### ⚠️ Dois defeitos que só o teste pegou

`montarWorkbook` foi separada do download exatamente para poder ser gerada e
RELIDA em teste — e isso pagou na hora:

1. **`dataBar` sem `cfvo` estoura no `writeBuffer`** ("Cannot read properties of
   undefined (reading 'forEach')" em `databar-xform.js`): **TODO download
   quebraria em produção**. A primeira versão escondeu isso com `as never`, que
   calou justamente o erro de tipo que estava avisando. Lição: cast que silencia
   o compilador numa chamada de biblioteca é dívida, não atalho.
2. **`72.4 / 100` grava `0.7240000000000001`** na célula. Invisível no formato
   `0.0%`, mas é ruído gravado — basta alguém aumentar as decimais para ele
   aparecer num relatório que circula. `fracao()` arredonda em 4 casas.

⚠️ **`color` na regra de `dataBar` existe no RUNTIME e falta no `.d.ts` do
ExcelJS** (`databar-xform.js` faz `colorXform.render(xmlStream, model.color)`).
O cast ali é sobre a declaração incompleta da biblioteca — diferente do caso
acima —, e o teste que relê a planilha é o que sustenta a afirmação.

Testado: 19 asserções sobre a planilha relida (abas e ordem, KPI vermelho abaixo
de 50%, fração e formato de porcentagem, cabeçalho congelado, filtro automático,
mediana nula ficando vazia em vez de zero, situação em texto E cor, aspas no nome
do contato) + 3 casos de borda (com recorte, sem recorte, período sem dados).

## Ação de tela que também é LINK (Conversas → Relatório)

Queixa: "na opção de abrir conversa nessa tela não dá pra abrir em uma nova guia
igual os outros ícones". Estava certo — "Abrir contato" sempre foi um `<Link>`, e
"Abrir conversa" e "Template" eram `<button onClick>`. Botão não tem `href`, então
Ctrl+clique, botão do meio e "abrir em nova guia" do menu de contexto não têm o
que fazer.

⚠️ **Trocar por link puro resolveria a nova guia e traria um recarregamento de
página no clique comum — pior do que o problema.** A caixa de entrada é a tela
mais usada do CRM; recarregá-la joga fora o Realtime e as stores já carregadas
(inclusive as que levam segundos para voltar).

O padrão é `<Link href>` + `onClick` que intercepta **só o clique simples**
(`cliqueSimples()` em `conversations-report.tsx`): clique comum troca a aba na
hora, sem navegar; clique com Ctrl/Cmd/Shift/Alt ou botão do meio passa para o
navegador, que faz o que sempre fez. O `href` real também devolve o menu de
contexto de graça.

A URL já existia: **`/conversas?c=<id>`**, usada desde o "Abrir conversa" do card
do kanban.

⚠️ **O botão "Template" precisou de `&template=1` na URL.** A intenção de abrir o
seletor de template vive numa store Zustand, que é memória da ABA e nasce vazia
na guia nova — sem o parâmetro, abrir em nova guia daria a conversa e nenhum
seletor. A URL é o único jeito de a intenção atravessar essa fronteira.

⚠️ **O consumo do parâmetro fica em `useEffect` de montagem, não no
inicializador do `useState`.** O inicializador roda durante a renderização, e
chamar ação de store dali é efeito colateral em render: o lint acusa
(`react-hooks/purity`) e o StrictMode chamaria duas vezes. Dependências vazias de
propósito — reagir a `searchParams` reabriria o seletor a cada navegação que
preservasse a query.

⏳ **"Abrir conversa" do CARD DO FUNIL e do detalhe do lead continuam botões**, e
não é descuido: eles chamam `openConversation()`, que descobre o id via RPC
`contact_conversation` (é o que acha a conversa mesmo sendo de outro atendente).
Sem id não existe `href` estático. Para virarem link, `/conversas` precisaria
aceitar algo como `?contato=<id>&canal=whatsapp` e resolver do outro lado.

## Conversa em branco ao abrir em nova guia

Sintoma: `/conversas?c=<id>` numa aba nova mostrava cabeçalho, barra lateral e
composer corretos, e o fio de mensagens VAZIO. Em aba já aberta funcionava.

⚠️ **Era o mesmo padrão da aba Canais, já documentado aqui: "cacheava lista vazia
como carregada".** Três coisas somadas em `loadMessagesFor`:

1. ela **não** chamava `ensureSession()` — diferente de outras funções do mesmo
   arquivo (linhas 141 e 570), que já chamavam. Numa aba recém-aberta o `Thread`
   monta na hora e a busca saía antes de a sessão estar pronta;
2. **sem sessão a RLS devolve ZERO LINHAS e NENHUM erro** — a armadilha nº 1
   deste projeto, que já apareceu em `removeMessage` e no `update` da rota de
   mídia;
3. a conversa era marcada em `loadedMsgConvs` **antes** do fetch e só desmarcada
   em `error`. Vazio sem erro ficava gravado como "carregado" e o fio não tentava
   de novo — branco até um F5.

Cabeçalho e barra lateral apareciam porque vêm de outra consulta, e é isso que
fazia parecer defeito de tela em vez de defeito de dados.

**Correção:** `await ensureSession()` antes da consulta e **resultado vazio SEM
sessão confirmada não vira cache** (`comSessao` guarda o `loc()`). Depois do
`ensureSession` um vazio é confiável — a conversa realmente não tem mensagem; sem
`locationId` ele significa "não deu para perguntar". O custo de não cachear é uma
consulta a mais na próxima abertura, barato ao lado de um fio que só volta com F5.

⚠️ **O `Thread` ganhou ESTADO VAZIO.** Antes, 0 mensagens era branco puro — e
branco é indistinguível de "não carregou", que é exatamente o que fez este bug
passar por problema de interface. Existem conversas legitimamente vazias no banco
(criadas em "Nova conversa" ou pelo rodízio antes da primeira mensagem), e agora
elas dizem isso.

⚠️ **Ao escrever busca sob demanda com cache de "já carregou", marque DEPOIS de
saber que a resposta é confiável.** Marcar antes economiza uma linha e transforma
qualquer falha silenciosa em estado permanente.

### E depois: "carrega e logo depois SOME"

Corrigido o vazio, apareceu o sintoma seguinte — as mensagens surgiam e
desapareciam. Não era outro bug: era o MESMO problema, uma camada abaixo, que só
ficou visível quando o passo anterior passou a funcionar.

⚠️ **O `load()` da store SUBSTITUÍA o array de mensagens** (`messages: (msgs.data
?? []).map(mapMessage)`) pelas mensagens globais mais RECENTES. Numa aba nova as
duas buscas correm juntas:

1. o `Thread` monta e `loadMessagesFor(<conversa>)` traz o histórico dela — o fio
   aparece;
2. o `load()` tem QUATRO consultas (uma delas `conversations` com join de
   contato), termina depois, e trocava o array pelas recentes globais — que não
   contêm o histórico antigo daquela conversa. O fio esvaziava.

E como a conversa segue marcada em `loadedMsgConvs`, não havia nova tentativa.

**`mesclarMensagens(recentes, existentes)`** junta as duas fontes: as recentes
primeiro, o que já estava na store depois, filtrado por id. Id repetido fica com
a versão recém-buscada, que é a mais nova (status de entrega, transcrição que
chegou, carimbo de leitura).

⚠️ **Consequência assumida:** mensagem excluída em OUTRA aba sobrevive até o
próximo `load()` completo, porque mesclagem não sabe o que foi apagado. Nota
apagada reaparecendo é muito menos grave do que a conversa inteira esvaziar, e a
exclusão local já filtra a store na hora.

A função foi **extraída e exportada só para poder ser testada** — a regra é curta
e o defeito era invisível em revisão de código. 9 asserções, incluindo uma que
escreve a regressão como teste ("antes o histórico sumia").

⚠️ **Regra geral que sai daqui: em store que carrega em duas velocidades — um
`load()` amplo e buscas sob demanda —, o `load()` amplo NUNCA pode substituir o
que a busca fina trouxe.** `syncInboxDelta` já seguia isso (só acrescenta); o
`load()` era a exceção que ninguém tinha notado, porque em aba já aberta ele roda
antes de qualquer conversa ser aberta.

## Reação de mensagem (emoji), como no WhatsApp

Sintoma: quando o contato reagia, o fio mostrava uma bolha com o texto
`[reaction]` — sem o emoji, sem dizer a QUAL mensagem se referia, e sem sumir
quando o contato desreagia. Causa: o webhook não conhecia o tipo `reaction` e
caía no `else` genérico do resolvedor de conteúdo (`body = '[' || tipo || ']'`).

⚠️ **Reação NÃO é mensagem: é atributo da mensagem reagida.** Guardar como linha
em `messages` é o que produzia a bolha órfã — e produziria outra a cada
des-reação, porque a remoção chega como o MESMO evento com `emoji` vazio. Então:
coluna **`messages.reactions` (jsonb)** na mensagem de DESTINO, não tabela nova.
Reação é conjunto pequeno e limitado (uma por pessoa, e conversa de WhatsApp é
1:1); tabela própria só acrescentaria join, RLS e migração.

Migração **`202608271735_reacoes_de_mensagem.sql`**.

⚠️ **`public.set_message_reaction(...)` faz o ler-modificar-escrever do jsonb em
FUNÇÃO, não em TypeScript.** Reagir e desreagir em sequência são dois webhooks
concorrentes, e no código a segunda escrita apagaria a primeira. Mesmo motivo de
`log_conversation_event` e `save_handoff_summary` existirem como função.
Devolve NULL quando o alvo não existe aqui (reação a mensagem anterior à
integração) — o chamador loga em vez de falhar, que é o comportamento do próprio
WhatsApp: reação sem alvo não aparece.

⚠️ **Par `revoke` + `grant to service_role`**, e `authenticated` NÃO recebe: quem
chama é o webhook. No dia em que uma tela enviar reação, a função vai precisar de
checagem de empresa antes do grant (ver a 0080 e a 202608271044).

**Reação não mexe na conversa**: não reabre, não conta como não lida e não muda a
prévia da lista. É assim no WhatsApp — e contar reação como atividade encheria a
caixa de "não lidas" que não pedem resposta.

### Detalhes de tela que custaram atenção

- ⚠️ **O selo fica meia altura FORA do balão** (coluna envolvendo balão +
  reação). O balão tem `overflow-hidden` — a mídia e a faixa de falha dependem
  disso para arredondar nas pontas —, então um selo dentro dele sairia cortado. A
  largura máxima migrou para a coluna; `items-end/start` mantém o alinhamento por
  lado.
- **Fundo branco com borda**: o balão de saída é indigo escuro e o de entrada é
  cinza claro, então nenhum tom único serve para os dois.
- ⚠️ **`border-slate-200` e NÃO `ring-slate-200`**: o `ring` não está no
  remapeamento de dark do `globals.css` e ficaria um anel claro brilhante no
  fundo escuro — a armadilha já documentada ("o que não está na lista fica com o
  valor claro"). A borda está coberta e ganha o dark de graça.
- Chega **ao vivo**: o inbox já assina `UPDATE` em `messages` e substitui a
  mensagem pelo id, e a tabela é `replica identity full`. Nada a fazer.

⚠️ **A migração APAGA as bolhas `[reaction]` já gravadas**, com critério estreito
(entrada + tipo texto + corpo exatamente `[reaction]`, string que só o nosso
`else` genérico produz). Não há o que converter: a linha nunca guardou o emoji
nem o `message_id` de destino. Apagar remove ruído sem perder informação — mas é
irreversível, e está dito no arquivo para quem revisar poder discordar antes de
aplicar.

⏳ **Enviar reação PELO CRM não existe.** A função já aceita a origem (`p_by`),
então falta só interface e a chamada da Cloud API (`type: "reaction"`). Não foi
feito porque o pedido era sobre a reação do contato não aparecer.

## Rodízio: offline não recebe, e conversa parada volta para a fila

Relato (2026-08-28): na Secretaria a atendente estava OFFLINE (começa 12h) e o
bot moveu várias conversas para ela. Os outros atendentes não receberam esses
contatos e **a fila de espera dos alunos ficou muito alta**.

⚠️ **Eram DUAS causas independentes, e consertar só uma deixaria o problema.**

**Causa 1 — o flag `rodizio_offline` (0083).** Ligado, `distributeOne` usa o pool
INTEIRO e ignora presença: a atendente recebe a fatia dela do cursor às 5h da
manhã. Esse flag foi **pedido pelo Gabriel** naquela migração, com o texto oposto
("deve distribuir para todos mesmo offline"). A migração
`202608280930_rodizio_respeita_presenca.sql` o desliga — e está registrado como
**reversão de decisão anterior**, não como bug de ninguém.

**Causa 2 — o fallback "ninguém online".** Era
`online.length === 0 ? pool : online`, e **sobreviveria com o flag desligado**: de
madrugada não há ninguém online, então caía no pool e a conversa ia para quem
estivesse na vez do cursor. Foi assim que conversas de 05:55 amanheceram na caixa
de quem começa 12h, invisíveis para o setor. Agora `distributeOne` devolve `null`,
o chamador marca `awaiting_distribution` e o lead fica na **fila do setor** —
visível para todos e distribuído a quem entrar primeiro. Esperar na fila do grupo
é melhor que ficar preso com quem não está lá.

### Devolução por espera (`departments.devolver_apos_min`, default 15)

Respeitar presença **ainda não basta**: a pessoa pode estar online e ter saído
para almoçar, entrado em reunião, ou simplesmente não visto. Então conversa já
atribuída em que o cliente espera mais que o limite **sem resposta humana** volta
ao rodízio e é redistribuída na hora (escolha do Gabriel, em vez de devolver para
a caixa do grupo — que depende de alguém ficar olhando, e foi a fila alta que
motivou o pedido).

- ⚠️ **O relógio é a ESPERA DO CLIENTE**, não "há quanto tempo foi atribuída".
  Não existe coluna `assigned_at`, mas o motivo principal é outro: a queixa foi a
  FILA DE ESPERA, e medir a espera do aluno é medir exatamente a queixa.
- ⚠️ **Espera ÚTIL, pela mesma `sla_conversations` da 0079.** Com tempo corrido,
  toda conversa que chegasse numa sexta à noite seria "devolvida" na madrugada do
  sábado, em rodízio, para gente que também não está lá — trocaria uma conversa
  parada por três eventos de transferência inúteis no fio. Reusar a função da
  0079 também evita duas definições de "esperando" para divergirem, e ela já não
  conta resposta do BOT como atendimento — sem isso nenhuma conversa pareceria
  parada, porque o auto-responder responde em segundos.
- ⚠️ **`excluir` no `distributeOne`**: sem isso o rodízio pode devolver para a
  MESMA pessoa que não respondeu (o cursor não sabe de onde a conversa veio), e o
  resultado seria um evento de transferência a cada tique, para sempre.
- ⚠️ **A exclusão é aplicada DEPOIS da regra de presença.** Tirar a pessoa do
  `pool` antes mudaria o tamanho da lista e, com ele, o `cursor % list.length` —
  o rodízio passaria a pular gente sempre que houvesse uma devolução.
- **Solta ANTES de redistribuir, em passo separado:** se o rodízio não achar
  ninguém, a conversa fica na fila do setor em vez de continuar presa com quem não
  respondeu. Redistribuir primeiro e soltar depois deixaria a conversa parada no
  caso ruim.
- Roda no **tick de minuto que já existe** (`/api/automations/tick`), como as
  agendadas e a transcrição — cron próprio seria segundo segredo, segunda
  migração de agendamento e mais um passo manual em produção. ⚠️ A varredura
  olha 7 dias, não 30: só interessa quem está esperando AGORA.
- Janela de expediente: o padrão de 15 min é **o mesmo da meta de SLA** (0079).
  Duas réguas para a mesma coisa só gerariam discussão sobre qual vale.

⏳ **Não foi feito: horário de trabalho por atendente.** Era a minha proposta
(pular quem está fora do turno), e o Gabriel escolheu presença + devolução. Se um
dia a presença se mostrar frágil — gente que trabalha com a aba fechada —, turno
por pessoa é o próximo passo, e aí `devolver_apos_min` continua valendo como rede.

⚠️ A varredura automática de leads aguardando que a **0058 prometia**
(`/api/leads/sweep`, "migração 0059") **nunca existiu** — a rota é
`/api/leads/distribute` e exige sessão de admin. Ou seja: o que tira lead da fila
do setor hoje é o botão do admin e a distribuição em tempo real. Vale saber ao
mexer nessa área.

## Toda atribuição de conversa deixa rastro (gatilho)

Relato (2026-08-28): "alguns clientes estão caindo direto para o atendente sem
finalizar com o bot". O print mostrava a conversa com o bot no MEIO da triagem
(pediu o nome, o cliente respondeu) e **já atribuída a uma atendente** — sem
nenhum evento no fio dizendo quem atribuiu nem por quê.

⚠️ **Não deu para responder "por que foi para ela" lendo o código**, e essa é a
descoberta que importa: o CRM troca o responsável por pelo menos OITO caminhos, e
só DOIS deixavam rastro.

| registram evento | NÃO registravam |
|---|---|
| `assignLeadTo` (rodízio) | `transfer_conversation` (0070) |
| devolução por espera | `claim_conversation` (0073) |
| | `take_over_conversation` (0080) |
| | `get_conversation` (0086) |
| | `assign_conversation_to_self` (0087) |
| | `finish_conversation` (0092) |
| | webhook: dono do contato |
| | webhook: reabertura com humano |

Investigar caminho por caminho é o método que já se provou caro aqui (doze
rodadas no áudio recusado pela Meta, todas por falta de dado). **O conserto é
instrumentar, não adivinhar.**

⚠️ **GATILHO, e não um `insert` em cada função** — mesma decisão da transcrição
(0085: "quem enfileira é um TRIGGER… o quinto caminho que alguém criar amanhã
esqueceria"). São oito caminhos, dois em TypeScript e seis em SQL; consertar um
por um deixaria de fora justamente o próximo, que é o que vai gerar a dúvida da
próxima vez. `private.log_atribuicao` (migração `202608281530`) roda
`after update of assigned_to` e pega todos.

**`conversations.assign_reason`** carrega o POR QUÊ na mesma transação da
atribuição. Quem não preencher gera "motivo não informado" — e isso é informação
útil, não lacuna: aponta o caminho que ainda falta instrumentar.

O evento sai como:
`Atribuída a Jenifer (estava offline) · pelo sistema · rodízio do bot`
`Devolvida à fila do setor · pelo sistema · devolvida: cliente esperava 22 min`

- ⚠️ **Os `insert` manuais foram REMOVIDOS** de `assignLeadTo` e da devolução:
  com o gatilho, deixá-los daria dois eventos para a mesma atribuição. O texto
  que estava no insert virou MOTIVO na coluna.
- `auth.uid()` é null no webhook e no cron, e **"pelo sistema" é a informação
  certa** nesse caso — não uma lacuna a preencher.
- `is distinct from` e não `<>`: null está dos dois lados do problema (atribuir a
  partir da fila e devolver para ela).
- `security definer` porque `messages` tem RLS e o gatilho precisa gravar venha a
  atribuição de onde vier. A função mora em `private` e o gatilho é o único
  chamador, então não há `grant` a fazer — o oposto do cuidado das funções de
  `public`, onde o problema existe porque qualquer um alcança.

⏳ **A causa do caso do Cesar continua sem resposta**, e isto é o instrumento
para respondê-la: na próxima vez o próprio fio diz quem atribuiu e por quê. Para
o caso já ocorrido:

```sql
select m.created_at, m.type, left(m.body, 90) as evento
  from public.messages m
 where m.conversation_id = '<id da conversa>'
 order by m.created_at;
-- e o estado atual:
select assigned_to, bot_paused, awaiting_distribution, assigned_offline, archived_by
  from public.conversations where id = '<id da conversa>';
```

### O bot falava por cima de conversa que já tinha dono — CORRIGIDO

`maybeRunBot` (`lib/bot/engine.ts`) lia **só `bot_paused`** e não olhava
`assigned_to`. Os dois campos são independentes, então conversa COM responsável e
`bot_paused = false` continuava recebendo o fluxo: dois donos falando com o mesmo
cliente, que é exatamente o que o print do Cesar mostrava (bot pedindo o nome numa
conversa já atribuída).

O próprio código já afirma em outro lugar que "o bot não pode roubar uma conversa
ativa" (webhook, reabertura com humano) — a regra só não estava aplicada aqui.

⚠️ **Eu tinha deixado isso de fora por medo de causar o sintoma OPOSTO** (cliente
sem triagem nenhuma). O que destravou foi conferir `finish_conversation` (0092):
**finalizar faz `assigned_to = null`**. Ou seja, conversa encerrada volta SEM
responsável e é triada normalmente quando o cliente escreve de novo. E o rodízio
só atribui junto com `bot_paused = true`. Conversa com responsável E bot solto é
**estado inconsistente** — nenhuma triagem legítima depende dele. Conferido com 7
casos, incluindo reabertura de finalizada, fila do setor e devolução por espera.

⚠️ **Corrige a consequência, não a causa.** Continua sem resposta QUEM atribuiu a
conversa durante a triagem — e é isso que o gatilho de log
(`202608281530`) passa a dizer. Um `console.log` no portão registra cada vez que
o estado inconsistente aparece, para cruzar com o evento de atribuição.

⚠️ **E derruba uma suposição natural sobre este caso:** finalizar NÃO foi o que
atribuiu a Beatriz, porque finalizar solta o responsável. Alguma coisa a atribuiu
ANTES, durante a triagem.

## Resposta automática com janela (Conversas → Configurações)

Pedido: "um bot que quando a pessoa mande uma mensagem responda com apenas UMA
mensagem, e a opção de escolher quando fica ativo e até quando". Escolhas do
Gabriel: **os dois** tipos de janela (recorrente + período único) e resposta a
**toda** mensagem.

⚠️ **A parte "uma mensagem só" já era possível** no editor de bot (0055) — um
fluxo com um único nó `end` com texto. O que NÃO existia era a JANELA: nenhuma
tabela tinha qualquer conceito de "ativo de … até …". Migração
`202608281945_resposta_automatica_agendada.sql`.

⚠️ **Substituiu um interruptor de MENTIRA.** A aba Configurações tinha "Resposta
automática fora do horário" ligando um `useState` que nunca saía da tela: a
funcionalidade era prometida e não existia. Ele foi REMOVIDO — deixar os dois lado
a lado seria pior que antes, dois controles com o mesmo nome sendo um real e um
decorativo.

### Decisões

- ⚠️ **Roda ANTES do fluxo do bot e do auto-responder de IA.** Se rodasse depois,
  um número com fluxo triaria o cliente às 3h da manhã — nome, e-mail, assunto —
  para no fim ninguém atender. A janela existe para dizer "não estamos agora":
  precisa calar os dois.
- ⚠️ **`tipo` separa recorrente de período** em vez de uma linha tentar ser as
  duas. Uma linha com os dois conjuntos de campos exigiria uma regra implícita no
  código para decidir qual olhar. Com a separação, "qual vale quando coincidem"
  vira regra explícita: **período ganha**, porque "estamos em recesso" é mais
  específico que "fora do expediente". Entre iguais, a regra amarrada a um NÚMERO
  ganha da que vale para a empresa.
- ⚠️ **A regra é TypeScript, não função SQL.** Tem três armadilhas nada óbvias
  (virada de meia-noite, fuso e prioridade) e em TS ela é função pura com teste;
  em SQL eu não teria como executá-la antes de produção — e este projeto já pagou
  caro por lógica que parecia certa e não foi rodada.
- ⚠️ **A janela que vira a meia-noite é o caso NORMAL**, não a exceção: "fora do
  expediente" é 19h→8h, ou seja `fim <= inicio`. Tratada como intervalo comum
  nunca seria verdadeira e o bot não responderia nunca — sem erro nenhum.
- ⚠️ **O dia da semana é o do INÍCIO da janela.** Numa faixa 19h→8h marcada para
  sexta, 1h da manhã já é sábado no relógio; conferir o dia do instante atual
  cortaria a madrugada de sexta para sábado, que é quando a mensagem mais importa.
- ⚠️ **`Intl` com `America/Sao_Paulo`, não `getHours()`.** O servidor da Vercel
  roda em UTC: às 21h de Brasília `getHours()` devolve 0 e a janela pareceria
  fechada. Mesmo cuidado de `private.business_minutes` (0079).
- **Fim EXCLUSIVO** nos dois modos: "até 02/01 08:00" significa que às 8h em
  ponto já atende normalmente.
- **Respeita o limite diário do número.** Responder a toda mensagem foi escolha
  do Gabriel, e cada resposta conta na cota da Cloud API — sem a checagem, uma
  rajada num recesso consumiria a cota e derrubaria as mensagens de verdade.
- **Marca `automated: true`**: entra no filtro "Conversas com automação" (0027) e
  NÃO conta como atendimento no SLA (0079) — senão o cumprimento da meta ficaria
  perfeito sem ninguém ter atendido.
- **Criar/editar/excluir é de ADMIN** pela RLS: a mensagem sai para todo cliente
  que escrever na janela, e uma janela mal configurada é visível fora da empresa.
  Ler continua liberado para o time ver o que está no ar.
- A tela mostra **qual está valendo AGORA** usando a MESMA `respostaAplicavel` do
  webhook. Regra escrita num lugar e aplicada em outro é como janela errada passa
  despercebida até um cliente reclamar.

Testado com **21 casos**: as duas bordas da virada de meia-noite, o fuso (21h
local = 00h UTC do dia seguinte), a madrugada de sexta pertencendo à janela de
sexta, fim exclusivo nos dois modos, período ganhando de recorrente, número
específico ganhando do geral, e regra inativa.

⏳ Fora do escopo: uma vez por conversa / a cada X horas (o Gabriel escolheu toda
mensagem), e prévia de "como vai ficar na semana".

## Áudio #131053: o conserto NÃO está no CRM (2026-08-27, conclusão)

Doze rodadas. A cadeia de evidência fechou, e ela aponta para fora do código.

**O teste que encerrou a discussão: uma IMAGEM foi entregue** na mesma conversa,
pela MESMA rota, com o MESMO canal e o MESMO par upload+send — **sem deploy
nenhum**. Isso descarta de uma vez canal, número, `phone_number_id`, token,
multipart e a hipótese do `b36f0fe`. Se algum deles estivesse errado, a imagem
falharia junto.

**E o caminho de gravação NÃO mudou.** Conferido com `git log -S` nos commits
entre 24/08 e a quebra: nada tocou `OpusMediaRecorder`, `getUserMedia`,
`audio/ogg` ou `startRec`. **Mesmo código, mesmo encoder, mesmo formato:
funcionava ontem, falha hoje.**

Somando tudo o que foi MEDIDO:

| verificação | resultado |
|---|---|
| Arquivo válido | ✅ dois formatos, byte a byte (Ogg/Opus com pre-skip da RFC e CRC conferindo; MP4/AAC nativo) |
| Bytes chegam íntegros | ✅ round-trip com hash SHA-256 idêntico |
| A Meta tipa a mídia guardada | ✅ `audio/mp4` |
| Imagem pelo mesmo caminho | ✅ entregue |
| Caminho de gravação mudou? | ❌ não mudou |
| A Meta processa o áudio | ❌ "octet-stream" |

**Conclusão: a Meta parou de processar áudio para esta conta.** Não há o que
consertar no CRM, e as onze rodadas anteriores de mudança de código não podiam
ter funcionado.

### O que fazer no lado da Meta

1. ⚠️ **`WHATSAPP_GRAPH_VERSION` está em `v21.0`** (fim de 2024). Se a Meta mudou
   comportamento, uma versão em fim de vida é o primeiro suspeito. Testar
   `v23.0` é só a variável na Vercel. **O padrão do código NÃO foi mudado de
   propósito**: a versão afeta TODAS as chamadas (templates, envio, webhook), e
   trocar sem teste é arriscar o que funciona.
2. WhatsApp Manager → o número → restrição, qualidade rebaixada, verificação
   pendente.

### O desvio, enquanto isso: "Enviar como arquivo"

Botão no balão do áudio que falhou (`ReenviarComoArquivo` em `thread.tsx`).
Manda o MESMO arquivo como `document`, o que sai do transcodificador de áudio da
Meta — que é onde a recusa acontece. O cliente recebe um anexo que ele toca.
Perde a cara de nota de voz; entrega.

- ⚠️ **Botão, não reenvio automático.** Automático mandaria mensagem ao cliente
  sem ninguém pedir, e em cascata para todo áudio antigo que já falhou.
- ⚠️ **Só aparece em ÁUDIO que falhou.** Imagem e documento são entregues
  normalmente; um botão ali sugeriria um problema que não existe.

### A lição que custou doze rodadas

**Pergunte "quando parou de funcionar?" ANTES da primeira hipótese.** Foi a
décima primeira rodada que trouxe "ontem funcionava" — e essa frase valia mais
que tudo o que eu havia investigado até então. Junto com ela:

- **mensagem de erro de API não é diagnóstico** — "a frase menciona mimetype" não
  é evidência de que o mimetype seja a causa;
- **um teste que compara dois caminhos vale mais que dez que examinam um** — a
  imagem, em cinco segundos, descartou o que onze rodadas não conseguiram;
- **diagnóstico de falha assíncrona tem que aparecer onde a falha aparece**, não
  num `console.log`.

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
- ✅ **Segmentação de pipelines** (migração **0039**, aplicada) — `pipelines.scope` (`empresa` | `department` | `user`)
  + `department_id`/`owner_id`. Todo pipeline existente vira `empresa` (default
  da coluna), então nada muda nos dados de hoje. Usuário comum só cria funil
  `user` para si; admin cria em qualquer escopo e muda quem vê pelo botão
  "Quem vê". É RLS: o `with check` do INSERT/UPDATE impede promover o próprio
  funil a `empresa` pela API. `private.pipeline_visible` /
  `private.pipeline_manageable` (SECURITY DEFINER) entram nas policies de
  `stages` e `opportunities` — funil escondido esconde fases e leads junto,
  inclusive no painel e nos relatórios.
  ⚠️ A 0039 **recria** as policies de `opportunities` nascidas da 0004
  (`private.sees_all`) — ao mexer nelas, mantenha as DUAS condições.
  Spec: `docs/superpowers/specs/2026-08-14-pipelines-segmentacao-design.md`.
- ✅ Backend F2c: módulo **Leads/Pipelines 100% funcional** — kanban real com drag &
  drop persistente (status ganho/perda deduzido pela fase), criar oportunidade,
  vista lista com ações em massa, gestão completa de pipelines/fases,
  oportunidades reais no detalhe do contato.
- ✅ Backend F2d: módulo **Conversas 100% funcional com Realtime** (migração 0003:
  snippets + publicação realtime) — enviar/agendar/nota interna persistem, nova
  conversa por contato+canal, trechos reais usados no composer, estatísticas
  calculadas, badge "Ao vivo". Repo: `db/conversations.ts`. Ações manuais e links
  de acionamento = empty states (dependem de Automações real).
  Composer 100% funcional: emoji, tag no contato, respostas rápidas/trechos,
  excluir conversa (modal) e busca na lista. **Anexos e áudio reais** (migração
  0019): bucket privado `conversation-media` (path `{location_id}/{conversation_id}/
  {uuid}.{ext}`, policies no padrão membership), envio de imagem/PDF/DOCX (15 MB) e
  gravação por `MediaRecorder`; exibição via URL assinada (`conversationActions.
  sendMedia`/`mediaUrl`). WhatsApp usou a migração 0022 (ver seção própria
  abaixo). **Migração livre a partir de agora: 0023.**
  **Rail da caixa de entrada** (migração 0027) — os cinco botões funcionam de
  verdade: busca global (procura no corpo de TODAS as mensagens, não só no
  preview), "Atribuídas a mim" (`conversations.assigned_to`, migração 0025),
  "Caixa do grupo", "Conversas com automação" (`messages.automated` — marcado
  pelo motor de automações; qualquer agente de IA que responder deve marcar
  também) e visualizações salvas (tabela `inbox_views`, guarda escopo + aba +
  ordenação + busca). O estado de filtro mora em
  `src/components/inbox/inbox-filters.ts` (store Zustand) porque rail, lista e
  visualização mexem nele.
  **Mensagens agendadas** (migração 0028) — o "Programar" do composer só gravava
  a data e nada disparava. Agora `messages` tem `scheduled_by`,
  `schedule_status` (`pendente→enviando→enviada|falhou|cancelada`),
  `dispatched_at` e `schedule_error`; quem dispara é
  `dispatchScheduledMessages()` (`src/lib/messages/scheduled.ts`), chamado pelo
  **tick que já existe** (`/api/automations/tick`) — de propósito, para não criar
  segundo cron, segundo segredo nem passo manual novo em produção. WhatsApp sai
  pela Cloud API (respeita janela de 24h e limite diário do canal); canal sem
  integração de envio = publicar na conversa. Log completo na aba
  **Conversas → Agendadas** (quem agendou, para quando, status, motivo da falha,
  cancelar) e resumo dentro da própria bolha da mensagem.
  **Excluir conversa é só de administrador** (migração **0040**, aplicada) — excluir apaga o histórico junto (as
  mensagens caem por cascade) e não tem desfazer; quem não é admin usa
  Arquivar. É RLS: as policies "membros excluem" de `conversations` E
  `messages` (nascidas do laço da 0001) viram admin-only — sem isso, esconder
  o botão só mudaria a tela. `conversationActions.remove` deixou de apagar as
  mensagens à mão (o cascade já faz) e passou a conferir as linhas devolvidas:
  delete recusado pela RLS não vem com `error`, e a tela dizia "excluída" com
  a conversa ainda no banco.
  **Finalizar e arquivar** (migração 0029) — dois eixos independentes em
  `conversations`: `closed_at|closed_by` (atendimento resolvido) e
  `archived_at|archived_by` (fora de vista). Guardados separados de propósito:
  um enum único apagaria "quantas finalizei" ao arquivar. O seletor fica no
  título da lista (Abertas · Finalizadas · Arquivadas · Todas, com contagem), a
  ação no cabeçalho da conversa, e a faixa de estado mostra quem/quando com
  Reabrir/Desarquivar ao lado. **Mensagem de entrada reabre E desarquiva**
  (webhook do WhatsApp) — perder mensagem de cliente é pior do que desfazer um
  arquivamento.
  **Janela de 24h visível no composer** (sem migração/env) — o campo de texto
  nasce BLOQUEADO quando a janela fechou, com o aviso e o botão "Enviar
  template" no lugar. Antes o CRM só descobria no 409 da rota, depois de a
  pessoa escrever: o seletor abria por cima e o texto digitado se perdia. A
  conta é sobre a última mensagem DE ENTRADA (nota interna e mensagem nossa não
  reabrem janela); sem nenhuma entrada, a janela nunca existiu. Só vale para
  conversa de WhatsApp COM canal conectado — nos outros canais a regra não
  existe. **Comentário interno continua liberado** (não sai do CRM), e o próprio
  aviso oferece esse caminho. O `now` é atualizado a cada minuto: a janela
  expira com a tela aberta e o campo precisa travar sozinho. O tratamento do 409
  na rota continua lá como rede de segurança — relógio do navegador não é
  autoridade sobre a Meta.
  **Template em lote + enviar para pipeline** (sem migração/env/rota nova) — o
  ícone de seleção na barra do título liga os checkboxes; a barra "N
  selecionadas" dispara um **template aprovado** para todas via um
  `POST /api/whatsapp/send` por conversa, **em série** (a rota já valida canal,
  janela de 24h e limite diário — endpoint em lote duplicaria a regra; em rajada
  o limite diário devolveria 429 pra metade da lista sem controle). Falhas são
  listadas por nome. ⚠️ A rota marca `bot_paused = true`, então um disparo em
  lote **pausa o auto-responder** em todas as conversas atingidas. No painel do
  contato (direita), "Enviar para pipeline" cria oportunidade real
  (`oppActions.add`, `source: "Conversas"`) mostrando as que o contato já tem —
  senão o funil enche de duplicata. Spec:
  `docs/superpowers/specs/2026-08-14-conversas-template-lote-pipeline-design.md`.
- ✅ Backend F2e: **Dashboard** com widgets calculando sobre dados reais
  (adapters `useDbPipelines/useDbOpportunities/useDbPipeline` em `db/pipeline.ts`).
  **Painéis personalizados** (migração **0037**, aplicada) — `dashboard_views` guarda quais widgets aparecem, em que
  ordem e com qual pipeline cada um resume, em dois escopos na mesma tabela:
  `scope='user'` (pessoal, só o dono lê e edita) e `scope='department'` (o admin
  monta, o departamento inteiro lê, só admin edita — a RLS exige
  `private.is_admin`, não é filtro de UI). Helper novo
  `private.user_department_ids()` (SECURITY DEFINER, mesmo motivo de
  `channel_allowed`). Catálogo em `components/dashboard/widget-catalog.ts`;
  quem nunca personalizou vê `DEFAULT_WIDGETS`, que é o painel fixo de antes.
  Widgets novos de Pagamentos (vendas recentes, receita por mês, assinaturas)
  só aparecem para quem enxerga o módulo.
  **Repaginada de 2026-08-17** — o painel tinha três problemas que faziam os
  números parecerem errados, além do visual:
  1. **O seletor mentia** em Funil e Distribuição de fases: dizia "Todos os
     pipelines" e `useDbPipeline("")` desenhava o PRIMEIRO. Era a origem do
     "41 oportunidades num card e 4 no outro". Agora `WidgetCard` tem
     `allowAll` — esses dois widgets não oferecem "todos" (fase pertence a um
     pipeline; somar as de vários não significa nada) e o seletor mostra o
     pipeline realmente desenhado.
  2. **A rosca da taxa de conversão desenhava quase cheia com 2%**: sem
     `PolarAngleAxis` de domínio fixo, o Recharts escala o arco pelo MAIOR valor
     da série — que é o próprio número. O anel dizia o oposto do rótulo no meio.
  3. **O eixo de "Valor de Oportunidade" virava "R$0K" em todos os traços**
     (dividia por mil e arredondava). Agora usa `shortBRL`, que serve tanto
     R$ 4 quanto R$ 3,4 mi.
  **Visual:** faixa de **KPIs** no topo (oportunidades, receita ganha, conversão
  e ticket médio) com número grande e um fiapo de gráfico acumulado do próprio
  indicador — gráfico responde "como está distribuído", nunca "como estamos", e
  esses quatro números viviam espalhados em rodapé de card ou não existiam. A
  faixa fica FORA do catálogo de widgets de propósito: é resumo do mesmo recorte
  e vale para qualquer painel, inclusive os de departamento; no catálogo, cada
  painel já salvo precisaria ser reconfigurado à mão para ganhá-la. Cartões com
  `rounded-2xl`, borda mais clara e elevação no hover; barras do funil com
  degradê da própria cor da fase. Mantido o TEMA CLARO — o exemplo de referência
  era escuro, mas o CRM inteiro é claro (sidebar grafite + conteúdo claro) e uma
  tela escura sozinha destoaria; dark mode segue no backlog como mudança
  transversal.
  Mais: subtítulo em cada card dizendo o que o número é, centro das roscas com
  rótulo ("oportunidades", "no pipeline"), colunas do funil renomeadas para
  "% da 1ª fase" / "% da fase anterior", fases vazias aparecendo em cinza na
  legenda (antes sumiam e a legenda não batia com o funil ao lado), vazio
  explicando "nada no período" e uma linha no topo dizendo, em datas, o período
  que TODOS os cards estão contando.
  ⚠️ **Corrigido na 0052:** a policy de leitura da 0037 entregava ao admin TODOS
  os painéis da empresa, inclusive os de escopo `user` (pessoais) dos colegas —
  contra o que a própria 0037 escreveu ("user: só o dono lê e edita"). A tela
  escolhe o padrão pegando o primeiro `scope='user'` marcado como padrão, e esse
  primeiro era o painel PESSOAL DE OUTRA PESSOA; salvar batia na policy de
  UPDATE e respondia "sem permissão para editar este painel", como se o admin
  não fosse admin. Não era permissão: era o painel errado na tela. Agora admin
  lê o próprio pessoal + todos os de departamento, e `db/dashboards.ts` filtra
  por dono como segunda barreira (ambiente com migração atrasada não revive o
  bug). O mesmo vazamento fazia o `is_default` do primeiro painel de alguém
  nascer `false` — contava o painel dos outros. Spec:
  `docs/superpowers/specs/2026-08-14-paineis-personalizados-design.md`.
- ✅ Backend F2f: módulo **Calendários** real — compromissos do banco (repo
  db/appointments.ts), grade semanal com navegação e "Hoje", criar/excluir
  compromisso (com contato vinculado), lista futuro/passado. Sync Google = futura.
  **Editar, criar pela grade, vincular a lead e arrastar** (migração **0041**,
  aplicada) — `appointments.opportunity_id`
  (`on delete set null`: excluir o lead não apaga a reunião de ninguém); clicar
  numa célula cria naquele dia/hora, clicar no evento edita, arrastar muda de
  dia/hora com dnd-kit. `move()` **preserva os minutos e a duração** (a célula é
  de 1h; zerar minutos mudaria em silêncio um horário combinado) e é otimista
  com rollback. Escolher o lead preenche o contato só quando ele está vazio.
  **Lembrete no CRM** (migração **0042**, aplicada) —
  `appointments.reminder_minutes` (null = sem lembrete) e o popup
  `components/calendar/appointment-reminders.tsx`, montado no **shell**
  (`(app)/layout.tsx`) para avisar em qualquer tela. O "já avisei" fica no
  `localStorage` (estado de tela, por dispositivo — no banco, o celular
  esconderia o aviso do computador); o disparo é por JANELA
  (`início - lembrete` até `início + 15min`), senão abrir o CRM à tarde
  despejaria a manhã inteira de avisos; e a agenda é relida a cada 5 min,
  senão compromisso criado em outro dispositivo nunca avisaria aqui.
  **Agenda por usuário** (migração **0043**, aplicada) —
  `appointments.owner_id`; cada um vê a própria agenda, admin vê tudo e pode
  marcar na agenda de outra pessoa. `owner_id` NULO = agenda da empresa
  (visível a todos) — é o que os compromissos existentes viram, já que não dá
  para adivinhar o criador. É RLS: as policies do laço da 0001 são recriadas
  por dono. O seletor "Todas as agendas / da empresa / <pessoa>" é recorte de
  visualização para o admin.
  Spec: `docs/superpowers/specs/2026-08-14-calendario-editar-arrastar-design.md`.
- ✅ **Cadastro fechado** (migração 0006): só entra quem tem convite pendente — o
  trigger de signup aborta a transação, então nem chamando a API de auth direto
  a conta é criada. Reabrir: `update private.app_settings set signup_mode = 'open';`
- ✅ Backend F2h: **Calendários** e **Configurações** (empresa/perfil reais, sidebar
  mostrando a empresa do banco).
- 🗑️ **Checklist de ativação REMOVIDO** (2026-08-17, a pedido do Gabriel): saíram a
  rota `/ativacao`, o item da sidebar e o repo `db/activation.ts`. A tabela
  `activation_steps` (migração 0005) **continua no banco de propósito** — dropar
  é irreversível e não há ganho nenhum em fazê-lo; se o checklist voltar, o
  progresso de quem já marcou passo ainda está lá. `PERMISSION_MODULES` deixou de
  precisar da exceção que tirava "ativacao" da lista.
- ✅ **Automações** — motor + pg_cron em produção (ver seção própria acima).
- ✅ Backend F2g: **Equipe e permissões** (migração 0004) — convites por e-mail
  (trigger de signup vincula à empresa que convidou em vez de criar nova),
  papéis admin/usuário, permissões por módulo (jsonb em `location_members`),
  modo "ver apenas dados atribuídos" aplicado nas políticas RLS de contacts e
  opportunities via `private.sees_all()`, trigger `protect_last_admin` impedindo
  a empresa ficar sem administrador. Sidebar respeita permissões; a tela
  /configuracoes/departamentos é restrita a admins.
- ✅ **Departamentos** (migração 0033) — segmentação de acesso compartilhada, em
  `public.departments` (nome, descrição, `permissions` jsonb com o mapa completo
  dos módulos) + `location_members.department_id` e `invitations.department_id`.
  A tela "Minha equipe" virou **/configuracoes/departamentos**: cria/edita
  departamento, mostra quem está em cada um e permite trocar o departamento do
  usuário na própria tabela.
  **Ordem de resolução do acesso** (`canAccess` em `db/team.ts`): admin vê tudo →
  exceção individual (`location_members.permissions`) → departamento → libera
  (legado dos membros com `{}`). Ou seja, `location_members.permissions` deixou
  de ser "o acesso do usuário" e passou a ser **só as exceções** — a UI grava
  apenas as chaves que divergem do departamento, então editar o departamento
  reflete em todo mundo que o segue.
  Padrões criados para toda empresa (existentes na migração, novas por trigger
  em `locations`): **Secretaria** (conversas, calendários, assinaturas, leads,
  contatos, automações, agentes de IA, painel, mídia) e **Comercial** (o mesmo
  sem assinaturas). O convite já sai com departamento — como o
  `private.handle_new_user` é compartilhado, quem aplica é um gatilho aditivo
  (`private.apply_invite_department` em `location_members`), sem reescrever a
  função de signup.
- ✅ **Conversas por número** (migração 0035) — `department_channels` liga o
  departamento aos números de `whatsapp_channels`, e `private.channel_allowed()`
  entra nas policies de SELECT/UPDATE de `conversations` e `messages` (e no
  INSERT de `messages`). É **RLS de verdade**: quem não pode ver a conversa não
  a recebe nem pela API. Regras: departamento SEM número vinculado = sem
  restrição; conversa sem `channel_id` (e-mail, Instagram, WhatsApp antigo)
  continua visível para todos; admin vê tudo. Os números são escolhidos no
  diálogo do departamento em /configuracoes/departamentos.
  ⚠️ Esta migração **recria** as policies `membros leem`/`membros editam` de
  `conversations` e `messages` (nascidas do laço da 0001) — ao mexer nelas,
  mantenha o `private.channel_allowed` no `using`/`with check`.
- ✅ **Pagamentos** — integração real com a Guru, webhook + sincronização a cada
  minuto (ver seção própria acima).
- ⏳ **Email Marketing** — código pronto, faltam passos manuais de produção (ver
  seção própria acima).
- ⏳ **WhatsApp (Meta Cloud API)** — código pronto, faltam passos manuais de
  produção (envs na Vercel, webhook na Meta, criar canal — ver seção própria acima).
  Aba **Templates** funcional: criar/excluir templates via Graph API (sem tabela
  local; Meta é fonte da verdade). Rastreio de entrega **exclusivamente de
  templates** — colunas `template_name`, `delivered_at`, `read_at`, `failed_at`,
  `error_detail` na tabela `messages` (migração **0031**, aplicada); webhook carimba horários sem rebaixar status (usa
  `isAdvance`); aba **Logs** com Realtime. Criar/excluir templates exige token
  Meta com permissão `whatsapp_business_management`.
  - **Nota de sessão / observação de bug (não bloqueante):** ao abrir `/whatsapp`
    a aba Canais chegou a mostrar "Nenhum canal" mesmo com o canal existindo —
    é corrida em `useChannelsStore.load` (`db/whatsapp.ts`): ele faz
    `await useDbStore.getState().load()` mas, se o `useDbStore` já estava a meio
    carregamento (guard `if (loaded||loading) return`), a chamada volta na hora
    sem aguardar, lê `locationId` ainda nulo e cacheia a lista vazia com
    `loaded:true` (nunca revalida). Resolve sozinho ao recarregar quando a
    location já está pronta. Mesmo padrão em `appointments.ts`. Follow-up:
    blindar o load pra só marcar `loaded:true` quando houver `locationId`
    (ou aguardar o `useDbStore` terminar de fato).
- ✅ **Central de notificações** (sino da topbar; **sem migração e sem env**) —
  os avisos são DERIVADOS do banco (conversa não lida, mensagem agendada que
  falhou, compromisso nas próximas 24h), sem tabela de notificações: uma tabela
  exigiria alguém escrevendo nela em webhook/automação/cron e o caminho
  esquecido viraria aviso que nunca chega. Consultas próprias e enxutas em
  `components/layout/notifications-panel.tsx` — o store de Conversas carrega
  TODAS as mensagens da empresa e o sino vive no shell. Abas **Não lidas /
  Lidas**: o "lido" é um CONJUNTO DE IDS no `localStorage` (por item, não um
  carimbo de última abertura — senão abrir o sino esvaziaria "Não lidas"), e
  abrir o painel não marca nada. Também lista tarefa pendente vencendo em 24h
  (a vencida entra de propósito).
  ⚠️ **O sino tem MEMÓRIA PRÓPRIA** (`lito.notifications.archive`, localStorage,
  teto de 150) desde 2026-08-17, e isso é o que faz as abas existirem de
  verdade: derivar do banco significa que o aviso morre junto com a condição que
  o gerou — clicar na notificação abre a conversa, o `unread_count` zera e o
  aviso sumia das DUAS abas no mesmo instante, sem virar histórico. Agora todo
  aviso visto é gravado com o texto dele, as abas leem do ARQUIVO e a consulta
  só atualiza o que já está lá ("2 não lidas" vira "3") e acrescenta o que é
  novo. Consequência assumida: aviso não lido continua em "Não lidas" mesmo
  depois de a origem sumir — some quando alguém marca como lido, e "Lidas" tem
  "Limpar histórico".
  **Som e pop-up do sistema** (2026-08-17, sem migração e sem env): engrenagem
  no topo do painel escolhe entre 5 toques + "Sem som", e um botão pede a
  permissão de aviso na área de trabalho. Decisões:
  * Os toques são **sintetizados no navegador** (Web Audio, `lib/notifications/
    sounds.ts`), não arquivos: nada para baixar (a primeira notificação toca na
    hora, e funciona com a rede caindo), nada em `/public` para versionar e
    nenhuma dúvida de licença. O padrão é o *ding-dong* de cabine de avião.
  * O `AudioContext` nasce SUSPENSO até um gesto do usuário (política de
    autoplay). Ele é criado no primeiro clique em "ouvir"/escolher um som — por
    isso escolher já toca. Sem esse gesto, a notificação automática ficaria
    muda.
  * A permissão do pop-up **só pode ser pedida a partir de um clique**; pedir ao
    carregar seria bloqueado e queimaria a única chance de perguntar. Negada, o
    código não pode perguntar de novo — a tela explica onde liberar.
  * ⚠️ **A primeira carga não avisa**: o arquivo começa vazio, então todo aviso
    já existente pareceria novo e abrir o CRM tocaria o sino vinte vezes. O
    primeiro `refresh` só semeia (`seeded`). Em rajada (>3 novos), sai UM
    pop-up resumindo — cinco empilhados são pior que nenhum.
  * `tag` na Notification faz o mesmo aviso se substituir em vez de empilhar.
  * ⚠️ **O gatilho é a ASSINATURA, não o id.** O id de uma conversa é
    `conv-<id>` — um id por MENSAGEM encheria a lista com dez linhas do mesmo
    contato. Só que, com id estável, a segunda mensagem caía como "já
    conhecida" e o sino tocava uma vez só (sintoma relatado). Cada aviso carrega
    uma `signature` que muda com atividade nova (conversa:
    `last_message_at|unread_count`; tarefa: prazo; compromisso: início), e é a
    MUDANÇA dela que dispara som e pop-up. Atividade nova também desmarca o
    "lido": chegou mensagem depois de você ler o aviso, ele volta a valer.
  * ⚠️ **Aviso é só do que é MEU** (ou de ninguém). Ver e ser avisado são coisas
    diferentes: a RLS já limita o que cada um enxerga, mas a caixa é
    compartilhada e sem filtro o time inteiro levava pop-up de conversa de
    colega — interromper quem não tem o que fazer com aquilo treina a pessoa a
    ignorar o sino. Regra igual nas quatro fontes: conversa
    (`assigned_to`), mensagem agendada (`scheduled_by`), compromisso
    (`owner_id`), tarefa (`assignee_id`). O "de ninguém" PRECISA entrar — caixa
    do grupo, compromisso da empresa e tarefa sem responsável não podem virar
    aviso que ninguém recebe.
  * ⚠️ **O áudio precisa de um gesto do usuário POR ABA.** Era o motivo de o som
    só sair ao clicar no sino: o `AudioContext` nasce suspenso, a varredura
    automática tentava tocar sem gesto e o navegador descartava calado — o
    clique, por ser gesto, funcionava, e parecia que só a ação manual
    atualizava. `installAudioUnlock()` (chamado na montagem do sino) libera no
    primeiro clique/tecla em QUALQUER lugar da página.
  * **Realtime, não só a varredura de 1 minuto**: o sino assina
    `postgres_changes` de `conversations` e `messages` (as duas já estão na
    publicação desde a 0003) com debounce de 600 ms — uma mensagem mexe nas duas
    tabelas e sem isso seriam duas varreduras para o mesmo evento. O intervalo de
    60 s fica como rede de segurança.
  * ⚠️ **Sem aba aberta não há pop-up.** É `Notification` de página, não Web
    Push: não existe service worker nem servidor de push aqui. Fechou o CRM,
    para de avisar.
  * ⚠️ **`requireInteraction: true`** no aviso. Sem isso, o Chrome no Windows
    desenha o próprio balãozinho por ~5 s e ele **não é arquivado na Central de
    Notificações do Windows**: quem estava em outra janela nunca vê e, ao abrir a
    central, encontra "não há notificações novas" — foi exatamente o sintoma
    relatado. Com a opção, o aviso espera ser fechado.
  * A engrenagem mostra um **diagnóstico linha a linha** (suporte, conexão
    segura, permissão, ligado aqui, endereço). A pegadinha silenciosa é a
    conexão: fora de HTTPS ou `localhost` — abrir o CRM pelo IP da rede local,
    por exemplo — o Chrome **nem pergunta** pela permissão.
  * **Lead quente do bot** e **venda nova** entraram como fontes (2026-08-18):
    - Lead: oportunidade com `source = 'Bot'` numa fase cujo NOME contém
      "quente" (o bot grava essa fonte em `ensureCard`/`syncCard`,
      `src/lib/bot/engine.ts`, e escolhe a etapa por nome no `stageMap` — por
      isso o aviso também casa por nome, não por id fixo). Filtra por `Bot` de
      propósito: quem move o lead à mão já sabe que moveu; o aviso existe para o
      que aconteceu sozinho.
    - Venda: view **`payment_new_sales`** (migração **0056**, aplicada), só para
      quem enxerga Pagamentos.
  * ⚠️ **"Venda aprovada chegou" NÃO é venda nova.** Medido neste banco em 7
    dias: 12.224 vendas aprovadas entraram e só 93 eram novas — avisar por
    chegada renderia doze mil pop-ups. Três casos se disfarçam: (1) histórico
    sincronizando (12.033), (2) **boleto/Pix antigo pago agora** (696 —
    `dates.created_at` velho, `dates.confirmed_at` de hoje) e (3) **renovação de
    assinatura** (6.815 contra 411 primeiras cobranças, 94% do volume de plano).
    A view resolve os três: status aprovado + `guru_created_at` recente (a
    JANELA é de quem consulta) + `subscription.charged_times <= 1` quando
    `product.type = 'plan'`. Em 24h: 84 vendas novas contra 98 do critério
    ingênuo.
  * `showDesktop` **devolve o motivo** quando não consegue disparar (sem
    suporte, permissão negada, permissão não pedida, caixinha desligada) e o
    botão **"Testar som e pop-up agora"** mostra isso na tela. Um pop-up que não
    aparece tem quatro explicações indistinguíveis; as três primeiras o CRM
    responde, e a quarta (Windows engolindo — Foco Assistido, notificação do
    navegador desligada em Configurações → Sistema → Notificações) é a que sobra
    quando a função devolve null e nada aparece.
  Spec:
  `docs/superpowers/specs/2026-08-14-central-notificacoes-design.md`.
- ⏳ Próximo: Automações reais (Edge Functions) tarefas 5–8, Agentes de IA.
- ⏳ Backlog: personalizar template/remetente dos e-mails de auth do Supabase
  (pedido do Gabriel), storage (Mídia Drive/arquivos), dark mode, mobile.

## Áudio: a rede de testes que faltava (`npm run test:audio`)

Doze rodadas de investigação produziram `src/lib/whatsapp/audio.ts` — inspeção de
contêiner por bytes, análise de fluxo Ogg pela RFC 7845, CRC-32, correção do
`pre-skip` — e **nenhum teste comitado**. As verificações de cada rodada foram
feitas em scripts descartáveis, jogados fora depois de responderem à pergunta do
dia. Ou seja: a peça mais depurada do repositório era a única sem rede contra
regressão, e uma refatoração futura quebraria em silêncio — o sintoma apareceria
como "Não foi entregue" no balão de um atendente, dias depois.

`scripts/test-audio.mjs` (58 asserções) roda direto no Node 24, que executa
TypeScript nativamente — sem runner de teste, sem dependência nova.

⚠️ **O CRC é calculado no teste por uma SEGUNDA implementação, com tabela.**
Testar `crcOgg` contra si mesma não provaria nada. A do módulo é bit a bit,
direto da especificação; a do teste é pré-calculada por tabela. Duas derivações
independentes que concordam é evidência — e é a mesma lógica da autovalidação de
`corrigirPreSkip`, que só reescreve a página quando o CRC confere com o do
codificador. O vetor `crc("123456789") = 0x89a1897f` amarra as duas na
especificação, e a ausência de reflexão (que separa o CRC do Ogg do CRC-32 de
zip/PNG) é justamente o erro que uma tabela copiada de outro lugar esconderia.

⚠️ **Os fluxos Ogg são MONTADOS página por página no teste**, com tabela de
segmentos e CRC de verdade, em vez de um `.ogg` binário comitado. Arquivo binário
no repositório ninguém sabe regerar quando o caso muda — e cada caso aqui é uma
variação de UM byte (canais, `pre-skip`) ou de uma página inteira (sem OpusTags,
sem EOS).

O que os casos cobrem, e por que cada um existe:
- **sem OpusTags** e **sem EOS** — obrigatórios pela RFC; navegador e Whisper
  toleram a falta, demuxer estrito não. Foi o que fez "o áudio toca, então está
  bom" enganar por seis rodadas.
- **`pre-skip = 0` → 312 com o CRC de todas as páginas conferindo** (5/5, pela
  implementação de tabela), e o fluxo seguindo válido depois da reescrita. Mudar
  a carga sem refazer o CRC trocaria um arquivo que o navegador aceita por um que
  NADA aceita.
- **CRC corrompido → RECUSA corrigir.** É a autovalidação, escrita como teste.
- **ogg sem OpusHead → `canais = null`, e reprova.** `null` lido como "está mono"
  foi um furo real: um WebM ou WAV (o que sai quando o codificador Opus não
  carrega) passava calado, e eu li "sem aviso" como "está mono".
- **ogg + `application/octet-stream` → declara `audio/ogg`.** O furo que o teste
  pegou na primeira versão de `mimeParaUpload`: um OGG legítimo cujo mime se
  perdeu no caminho era enviado COMO octet-stream — a divergência exata que a
  Meta recusa.
- **pdf → mantém o declarado.** Assinatura não conclusiva não vira palpite: um
  chute nosso por cima de um mime correto trocaria um erro por outro.

### `graph` no `GET /api/whatsapp/send-media`

A versão da Graph API em USO passou a sair no endpoint de versão. Era **a última
variável do lado do CRM que a investigação nunca conseguiu MEDIR**: `v21.0` é o
padrão do código (e é de 2024), mas a Vercel pode ter outro valor em
`WHATSAPP_GRAPH_VERSION` — e "o padrão do código" e "o que está configurado" eram
indistinguíveis sem abrir o painel. Não é segredo: vai no caminho da URL de toda
chamada à Meta.

⚠️ Mesma lição da rodada 6, agora aplicada antes de custar: **o que dá para
medir não se deduz.**

## `GET /api/whatsapp/diagnostico` — o que a META diz sobre o nosso número

⚠️ **Graph v25.0 mata a última hipótese do lado do CRM.** Consultado em produção
(`GET /api/whatsapp/send-media` → `{"commit":"185cf3b","graph":"v25.0"}`), o
número já roda numa versão recente da API, e o áudio continua sendo recusado.
Com isso, tudo que é NOSSO está exonerado **por medida, não por argumento**:

| eixo | como foi provado |
|---|---|
| o arquivo | Ogg/Opus mono, pre-skip 312, OpusTags, EOS, CRC de todas as páginas — e também MP4/AAC, formato de primeira classe da Cloud API |
| a transmissão | round-trip: baixado de volta da Meta com hash IDÊNTICO ao enviado |
| o caminho | falha igual por upload multipart E por link assinado |
| a rota | IMAGEM vai pelo MESMO canal, MESMA rota, MESMO par upload+send |
| a versão da API | v25.0 |

O que sobrou por perguntar é o **estado da conta** — e sobrou exatamente porque a
resposta mora no painel da Meta, onde eu não alcanço e onde ninguém sabe qual
campo olhar. Esta rota pergunta à API dela.

⚠️ **`platform_type` é o campo que interessa, e `getNumberInfo` nunca o pediu.**
Ele revela se o número está em **coexistência** — o modo em que o mesmo número
serve o aplicativo WhatsApp Business E a Cloud API ao mesmo tempo. É a única
hipótese que casa com a evidência que nunca teve explicação: **"pelo celular o
áudio é enviado normalmente"**. Um número 100% migrado para a Cloud API **não
funciona no aplicativo**; se ele funciona nos dois, está em coexistência — e aí
as limitações de mídia são da conta, não do arquivo.

`numberDiagnostics` pede ainda `status`, `throughput`, `messaging_limit_tier`,
`name_status`, `is_official_business_account`; `wabaDiagnostics` pede
`account_review_status` e `business_verification_status` (revisão pendente ou
negócio não verificado limita a conta e **não aparece como erro na chamada de
envio**, só como recusa genérica depois).

- **Admin-only** e o token nunca é devolvido. O estado da conta não é segredo,
  mas também não é assunto de todo atendente.
- ⚠️ **Best-effort por canal E por bloco.** Conta com problema é justamente a que
  faz a chamada falhar; se um erro derrubasse a resposta, a rota ficaria muda no
  único caso que ela existe para diagnosticar. Aqui **o erro é dado**, não
  exceção — vem no JSON, por canal.
- A rota devolve uma `leitura` em português, para não exigir de quem a abre o
  vocabulário da Meta. **Campo ausente é informação**: "a conta não devolveu
  `platform_type`" é diferente de "`platform_type = CLOUD_API`", e tratar os dois
  como iguais é o erro que custou rodadas nesta investigação (ler `null` como
  "está mono").
- `ehCoexistencia` casa por SUBSTRING e não por lista fechada: valor novo da Meta
  deve ser sinalizado, não ignorado em silêncio.

**Como usar:** logado como admin, abrir
`https://lito-crm.vercel.app/api/whatsapp/diagnostico` (ou
`?channelId=<id>` para um número só).

## Áudio: o diagnóstico acusava o inocente (2026-08-31)

O retrato de um MP4 REAL, recusado pela Meta, veio assim:

```
[diag] bytes=40388 head[v=null ch=null preskip=null taxa=null ganho=null map=null]
       ogg[pag=0 tags=false audio=0 eos=false granule=0 sobra=40388 crc=0/0]
       problemas[bytes fora de página na posição 0; primeira página não é
                 OpusHead; falta a página OpusTags (obrigatória na RFC 7845);
                 nenhuma página de áudio; última página sem a marca EOS]
       preskip: sem OpusHead via=upload fmt=audio/mp4
       meta[bytes=40388/40388 mime=audio/mp4 enviei=40388
            hash=8ed9420be24f/8ed9420be24f IDENTICO]
       canal[id=ac94fa64 pnid=1273256012539104 waba=1826165525416327
             nome=Backup Comercial pedido=cliente]
```

⚠️ **Os cinco "problemas" eram MEUS, não do arquivo.** `retratoDoAudio` rodava
`analisarOgg` em qualquer arquivo, e num MP4 aquela lista diz apenas "isto não é
um Ogg" — `fmt=audio/mp4` na mesma linha já dizia isso. Diagnóstico que acusa o
inocente é **pior do que diagnóstico nenhum**, porque manda a investigação para o
lado errado; é a mesma classe de erro de ler `null` como "está mono".

Agora o retrato segue o CONTÊINER: MP4 sai como `fmt=mp4 mp4[...]`, e o bloco de
Ogg (com `head[...]`, CRC e as exigências da RFC 7845) só aparece para Ogg. Duas
asserções escrevem a regressão como teste: um MP4 saudável não pode mencionar
`OpusHead` nem trazer `problemas[...]`.

### `analisarMp4` — o que o diagnóstico não conferia

Para Ogg havia análise de fluxo desde a rodada 6; para MP4, **nada**. O parser
percorre as caixas de topo e reporta `marca`, `moov`, `mdat`, `frag`,
`faststart`, `sobra`. Os três candidatos que ele torna visíveis:

- **sem `moov`** — é o índice do arquivo; sem ele nenhum demuxer identifica nada
  e o farejador cai em `application/octet-stream`, que é literalmente a queixa.
- ⚠️ **`moov` DEPOIS do `mdat`** — o padrão de quem grava em FLUXO, porque o
  índice só fica pronto no fim. Quem processa lendo o começo não acha o índice.
  É o que `-movflags +faststart` conserta, e é a hipótese que casa melhor com a
  frase da Meta.
- **fragmentado (`moof`)** — o `MediaRecorder` do navegador emite fMP4, feito
  para streaming; o `moov` sai quase vazio e as amostras moram nos fragmentos.

⚠️ **O que o retrato PROVA, e vale para não reabrir becos sem saída:**
`meta[... hash=8ed9420be24f/8ed9420be24f IDENTICO]` — a Meta recebeu os bytes
EXATOS e tipa a mídia guardada como `audio/mp4`. Ou seja, ela reconhece o arquivo
ao SERVIR e não reconhece ao PROCESSAR para mensagem de áudio. A transmissão está
fora de suspeita pela décima vez.

### ✅ "Enviar como arquivo" FUNCIONA — e é o que isola a causa

Confirmado em produção: o MESMO arquivo, no MESMO canal, pela MESMA rota e o
MESMO par upload+send, é entregue como **documento**. Só o tipo `audio` é
recusado.

Isso mata o que restava de hipótese sobre transporte, canal, número, token e
permissão de mídia: todos funcionam. **O que recusa é o transcodificador de áudio
da Meta**, e é por isso que o desvio existe.

⏳ **O canal é `nome=Backup Comercial`, com `pedido=cliente`** (o composer mandou
o `channelId`, não foi resolvido da conversa). Vale conferir se é o número certo
para essa conversa — `b36f0fe` (27/08 10:08, "abrir conversa escolhe canal do
departamento do usuário") mexeu justamente nessa escolha, e o primeiro relato de
áudio falhando é de 10:46. Documento indo pelo mesmo canal enfraquece a hipótese,
mas o teste que discrimina é **gravar áudio numa conversa de OUTRO número**: se
for, a limitação é daquele número na Meta; se não for, é da conta inteira.

## Áudio, rodada 14: sobrou UMA anomalia — MP4 fragmentado

Com o diagnóstico seguindo o contêiner certo, o retrato do arquivo real ficou
legível — e restou uma única coisa fora do lugar:

```
[diag] bytes=61997 fmt=mp4
       mp4[marca=isom caixas=ftyp/moov/moof/mdat moov=true mdat=true
           frag=true faststart=true sobra=0]
       via=upload fmt=audio/mp4
       meta[bytes=61997/61997 mime=audio/mp4 hash=35457adaa7bf/35457adaa7bf IDENTICO]
       canal[... nome=Backup Comercial pedido=cliente]
```

`moov` presente, **antes** do `mdat` (faststart), sem truncamento, e a Meta
recebeu os bytes exatos. **`frag=true` é o que sobra.**

⚠️ **O `MediaRecorder` do navegador emite fMP4 — MP4 FRAGMENTADO**, que é o
desenho de streaming (MSE/DASH/HLS): o `moov` sai praticamente vazio, sem tabela
de amostras, e as amostras moram nos fragmentos `moof`+`mdat`. Um analisador que
lê o `moov` para identificar o arquivo encontra **zero amostras** e não consegue
tipá-lo — que é literalmente a frase da Meta, "on processing it is of type
application/octet-stream".

E isso explica de uma vez o que enganou por rodadas: **navegador e Whisper tocam
fMP4 sem reclamar** (é para isso que ele existe), e a própria Meta **serve** o
arquivo de volta como `audio/mp4` — ela farejou o `ftyp` ao guardar. Só o
processamento para mensagem de ÁUDIO recusa.

⚠️ **Esta variante foi introduzida por MIM**, em 274e23b (27/08 12:34, "grava
áudio em MP4/AAC"). Antes disso o caminho era Ogg/Opus — que também é recusado,
com `pre-skip` corrigido e conferido. Dois codificadores, dois defeitos
diferentes, o mesmo sintoma: é o que fez a investigação parecer circular.

### ✅ O desvio funciona (confirmado em produção)

"Enviar como arquivo" entrega o MESMO arquivo, no MESMO canal, pela MESMA rota,
com o MESMO par upload+send. **Só o tipo `audio` é recusado** — o que exonera
canal, número, token, permissão de mídia e transmissão de uma vez.

### O teste que discrimina, e por que ele é aditivo

Anexar áudio pelo clipe passou a ser aceito (`kind: "audio"`). ⚠️ **Não há
regressão possível**: até aqui o clipe RECUSAVA qualquer arquivo de som ("Aceito
imagem, vídeo, PDF ou DOCX"), então não existe comportamento anterior a quebrar.

O que ele responde: um arquivo escolhido do computador é **progressivo**, o
gravado é **fragmentado**. Se o anexado for aceito e o gravado não, a fragmentação
está provada como causa e o conserto é remuxar (ou transcodificar). Se os dois
forem recusados, a conta é que não envia áudio, e o caminho passa a ser o painel
da Meta — não código. É a mesma bisseção que já funcionou aqui duas vezes (link ×
upload, imagem × áudio).

De saída prática, ele também permite gravar no celular e anexar.

⚠️ Os toasts do anexo passaram a dizer **"no inbox"**, não "enviada": gravar no
CRM não é entregar ao cliente, e dizer "enviado" antes de tentar a entrega já foi
um defeito real aqui.

## Áudio, rodada 15: o aviso contradizia a saída que funciona

A faixa do balão dizia *"Envie por texto ou use outro canal"* — e logo ABAIXO
dela ficava o botão **"Enviar como arquivo"**, confirmado entregando o mesmo
arquivo, no mesmo número. Quem lê o aviso primeiro desiste antes de ver o botão.
Agora a frase aponta para ele. O mesmo valia para o `toast` do microfone
desligado, que mandava "usar outro canal" quando o clipe já aceita arquivo de som.

### ⚠️ Correção da minha própria leitura: fMP4 é hipótese FRACA

A rodada 14 apontou `frag=true` como "a única anomalia" e tratou isso como quase
conclusão. **A evidência mais forte é contra**, e ela já estava documentada aqui:
o Ogg/Opus com `pre-skip` corrigido — mono, 312, OpusTags, EOS, `crc=8/8`, sem
truncamento, ou seja **válido por toda medida da RFC 7845** — foi recusado com o
MESMO #131053.

Se um Ogg comprovadamente correto é recusado, o formato provavelmente não é a
causa, e remuxar o fMP4 seria trabalho perdido. Dois formatos independentes,
ambos válidos, ambos recusados, enquanto **documento passa pelo mesmo número**:
isso descreve uma conta que não envia mensagem de ÁUDIO, não um arquivo ruim.

⚠️ **A bisseção do anexo ainda NÃO foi feita.** As duas últimas tentativas foram
GRAVAÇÕES (`frag=true` no retrato prova: o clipe produz arquivo progressivo, o
microfone produz fragmentado). Enquanto for gravação, o teste não responde nada —
e `frag=true`/`frag=false` no diagnóstico é como saber qual dos dois foi.

## 🔴 VEREDITO do áudio: é a WABA, não o CRM (2026-08-31)

Três números diferentes, **a mesma WABA `1826165525416327`**, a mesma recusa:

| canal | phone_number_id | áudio | documento |
|---|---|---|---|
| Backup Comercial | 1273256012539104 | ❌ #131053 | ✅ |
| Backup Secretaria | 1272264769300017 | ❌ #131053 | ✅ |
| **Secretaria Principal** | 1292488653952451 | ❌ #131053 | ✅ |

⚠️ **Um problema de NÚMERO não se repete idêntico em três `pnid` distintos.** Some
isso ao que já estava provado por medida e a investigação fecha:

| eixo | prova |
|---|---|
| arquivo | válido byte a byte em DOIS formatos — Ogg/Opus pela RFC 7845 (mono, pre-skip 312, OpusTags, EOS, CRC de todas as páginas) e MP4/AAC |
| transmissão | round-trip: baixado de volta da Meta com hash IDÊNTICO |
| caminho | falha igual por upload multipart E por link assinado |
| número | **três** números da mesma WABA, falha igual |
| tipo | documento e imagem passam pelos MESMOS números |
| versão | Graph v25.0 |

**A WABA não envia mensagem de ÁUDIO.** O caminho é chamado no suporte da Meta —
não código. Levar: o `#131053`, os três `pnid`, e o fato de documento passar.

⚠️ **A hipótese do fMP4 (rodada 14) está MORTA.** Ela já era fraca — um Ogg
comprovadamente válido também tinha sido recusado — e o terceiro número enterrou:
remuxar o fragmentado para progressivo teria sido trabalho perdido. Fica a lição:
quando duas hipóteses independentes sobre o mesmo componente falham, o componente
está certo; a terceira hipótese sobre ele também vai falhar.

**Saída em produção:** "Enviar como arquivo" entrega o mesmo áudio como documento,
confirmado nos três números. O aviso do balão aponta para ele.

## Canal PRINCIPAL (migração 202608312055)

Achado ENQUANTO se investigava o áudio, e é defeito independente dele: as
conversas saíam por "Backup Comercial" e "Backup Secretaria" **com o número
principal de Secretaria cadastrado**.

⚠️ **A causa é um critério arbitrário.** `conversationActions.open()` escolhia,
entre os canais do departamento, o **ativo mais antigo** (`created_at asc`) — não
existia nenhuma noção de "qual é o principal". Bastava o backup ter sido
cadastrado primeiro para toda conversa nova nascer nele. E número de backup é,
por definição, o que só deveria entrar quando o principal não serve.

Isso é errado independente do áudio: o cliente passa a ver um número que não é o
divulgado, responde nele, e a conversa fica presa lá.

- `whatsapp_channels.principal` + **índice único PARCIAL** por empresa
  (`where principal`): um principal por empresa garantido pelo BANCO. Sem ele,
  dois cliques simultâneos deixariam dois, e `open()` voltaria a desempatar por
  data — o defeito de origem.
- `public.definir_canal_principal(uuid)` promove e rebaixa **na mesma
  transação**. Em dois `update` do cliente, uma falha no meio deixa a empresa SEM
  principal, e o índice único faria a segunda escrita estourar se a ordem se
  invertesse. Checagem de empresa na primeira linha (padrão 0049) + admin-only:
  definir o número que fala com o cliente é decisão de administrador. Com o par
  `revoke`/`grant`.
- `created_at` continua como DESEMPATE — quem nunca marcou principal precisa de
  uma ordem definida.
- ⚠️ **NÃO mexe em conversa existente.** `conversations.channel_id` de conversa
  vinda de mensagem do cliente é o número que ELE procurou; reescrever faria a
  resposta sair por um número diferente do que ele conhece — exatamente o defeito
  que isto corrige.
- Coluna "Principal" na tabela de `/whatsapp`, com estrela.

## "Contato caindo na caixa sem passar pelo bot" — a resposta, medida (2026-09-01)

⚠️ **Consultado o banco de PRODUÇÃO por MCP** (`execute_sql`, projeto
`boykcuhxmndlkjhojxhl`). Várias afirmações deste arquivo dizem que não há como
conferir contra o Postgres ("falta `DATABASE_URL`"); com o conector MCP, há.

O relato tinha **três causas diferentes** misturadas, e nenhuma era a suspeita:

**1. A maioria não é o bot sendo pulado — é conversa aberta PELO CRM.** Sete
dias: 40 das 57 conversas "sem bot" na caixa da Cibelle Paiva **não têm nenhuma
mensagem do cliente**. Foram abertas por "Nova conversa"/"Abrir conversa". O bot
só roda em mensagem que ENTRA, então ali não há o que triar — é o desenho.

**2. O defeito de verdade já estava corrigido.** Os 17 casos de "cliente escreveu
e o bot ficou calado" são TODOS de 25–27/08, antes da correção do
`contacts.owner_id`. Depois de 28/08: **33 conversas de cliente em números com
bot, e o bot falou em 33.** Zero casos.

**3. O caso relatado (contato Marcilio Mattos, 31/08) era a atendente
assumindo.** O gatilho da 202608281530 respondeu: `Atribuída a Jenifer Martins ·
Jenifer Martins · motivo não informado`, às 18:57:04 — 6 segundos antes da
primeira resposta dela. O contato tem `owner_id` NULO e o canal TEM bot, então os
dois caminhos automáticos estão descartados.

⚠️ **E o fio explica por que ela assumiu**: o cliente pediu três coisas sobre
pagamento (problema no pagamento, gerar PIX, quantas parcelas pagou) e o bot
respondeu pedindo nome, e-mail e curso. O bot não estava atendendo — ela entrou.

### Migração 202609011300 — motivo em toda atribuição

**29 atribuições por pessoa em 7 dias saíam como "motivo não informado"**: os
caminhos em TypeScript foram instrumentados na 202608281530, as funções SQL não.
Foi essa lacuna que obrigou a ler a conversa inteira para responder o caso acima.

Cinco funções mudam `assigned_to` e nenhuma gravava motivo — `claim_conversation`
("assumida da fila"), `assign_conversation_to_self` ("assumida ao responder"),
`take_over_conversation` ("supervisão assumiu"), `transfer_conversation`
("transferida" / "devolvida à fila", que precisam ser distintos) e
`finish_conversation` ("atendimento finalizado", que solta o responsável).

- ⚠️ **O corpo de cada função é o que JÁ ESTAVA no banco**, copiado de
  `pg_get_functiondef`. Só o `assign_reason` mudou. Reescrever a lógica junto
  seria mudança de comportamento disfarçada de correção de log.
- ⚠️ Em `assign_conversation_to_self`, o ramo em que a conversa **já tem dono**
  não toca `assign_reason`: o responsável não muda, o gatilho não dispara, e um
  motivo novo descreveria uma atribuição que não aconteceu.
- 🔴 **Conferido no banco: `anon` tinha EXECUTE em `assign_conversation_to_self` e
  em `take_over_conversation`** — as duas que TROCAM o dono da conversa. Mesmo
  defeito da 0080 (`create function` concede a PUBLIC; `create or replace` NÃO
  reseta grants). O dano era limitado porque as duas checam empresa/supervisão
  antes de escrever e `private.user_locations()` de `anon` é vazio — mas isso é
  rede única. As cinco ganharam o par `revoke`/`grant`.
- ⚠️ `npm run db:check` acusou `take_over_conversation` por não mencionar
  `user_locations`/`is_admin`/`sees_all`. **Falso positivo, conferido:** a
  checagem está DELEGADA a `private.can_supervise_conv`, que amarra na
  `location_id` da conversa. Está escrito no arquivo para ninguém reauditar.

### Migração 202609011230 — o bot valida o e-mail

O nó `ask` só validava `name`; o resto caía em `vars[node.var] = args.text`, CRU.
Como o bot trata QUALQUER mensagem como resposta à pergunta atual, a pergunta do
cliente virava o valor do campo. Gravado no banco em 01/09:

```
email = "Será do dia 14.10 ate dia 21.10, o ideal seria eu fazer a visita…"
email = "Usmetzket9@gmail. Com"
curso = "Muito obrigado novamente Beatriz"
nome  = "Mário José Coppini da"   ← de "…da Silva"
nome  = "Eduardo Gama dos"
```

Isso alimenta o card do funil e a base de contatos.

- ⚠️ **O fluxo que VALE é o do banco.** `getFlow` lê `bot_flows.definition` e só
  cai no padrão em código quando não acha a linha — marcar `validate` só no
  TypeScript não teria efeito nenhum em produção. Daí a migração.
- ⚠️ **Dois modos**: `email` (estrito) e `email_ou_doc`. O nó `fin_pede_doc` do
  financeiro pede "e-mail **ou** CPF"; validador estrito recusaria o CPF e
  travaria quem respondeu certo.
- ⚠️ **Depois de 2 tentativas o bot segue com o campo VAZIO**, não com o texto.
  Travar prenderia o cliente num laço (o caso do Marcilio quase foi isso), e
  guardar o texto é o defeito que o ramo existe para fechar. Campo vazio o
  atendente preenche; frase de 130 caracteres ele precisa primeiro descobrir que
  está errada.
- ⚠️ **O teto do nome era 4 palavras** (`slice(0, 4)`, nos DOIS caminhos —
  heurística e IA). Cortava depois da preposição. Agora 6, mais teto de 80
  caracteres como rede.
- ⚠️ **A migração NÃO apaga o lixo já gravado.** `contacts.email` pode ter sido
  corrigido à mão depois, e um `update` por heurística apagaria correção humana
  junto. O arquivo traz a consulta para ver o que ficou torto.
- ⚠️ **Tolerar espaço perdido só vale na emenda de um PONTO ou do arroba.** A
  tentação é normalizar a frase inteira; isso transformaria
  "obrigado. joao@gmail.com" em "obrigado.joao@gmail.com". Três casos assim
  falharam na primeira implementação e só o teste pegou.
- `npm run test:bot` — 47 asserções, e **os casos marcados `[real]` são valores
  que estavam gravados no banco**. Metade dos casos vigia o lado oposto (não
  recusar e-mail de cliente de verdade), que é onde um validador estrito faz mais
  dano que o defeito.

⏳ **Fica sem validação o campo `curso`** (texto livre: "MMA + Célula + GMP"). Não
há forma para conferir, e a saída de verdade seria o bot perceber que o cliente
fez uma PERGUNTA em vez de responder — mudança grande, não tentada aqui.

⏳ `transfer_conversation` grava `contacts.owner_id = to_user`. Como o webhook usa
`owner_id` (de atendente) para mandar o cliente direto a quem já o atendia, uma
transferência passa a definir esse caminho. É provavelmente a intenção, mas não
está escrito em lugar nenhum — vale confirmar com o Gabriel antes de mexer.

## Template parou de sair: #131042 é a COBRANÇA DA NOSSA CONTA (2026-09-01)

Erro no balão: *"Message failed to send because there were one or more errors
related to your payment method · Business eligibility payment issue · #131042"*.

Medido no banco, o padrão é decisivo:

| dia | templates | falharam | por #131042 | entregues |
|---|---|---|---|---|
| 31/08 | 46 | 0 | 0 | 46 |
| **01/09** | **12** | **12** | **11** | **0** |

Primeira falha: **01/09 13:12 UTC (10:12 BRT)**. E no mesmo dia, **406 mensagens
NORMAIS entregues** contra 3 falhas.

⚠️ **É esse contraste que identifica a causa:** template é mensagem **PAGA**;
resposta dentro da janela de 24h é **gratuita** desde 2024. Problema de cobrança
derruba só as pagas — 100% dos templates, nenhuma das respostas. Não é código, e
não é o número (a falha é da WABA).

**Impacto de negócio:** sem template, não há como iniciar conversa nem reabrir
contato fora da janela de 24h. Atendimento em curso continua normal.

**Onde resolve:** Meta Business Manager → Configurações de cobrança da WABA
(meio de pagamento recusado, cartão vencido ou limite). Só administrador da conta
na Meta faz isso; o CRM não tem o que ajustar.

### ⚠️ A tradução no balão evita um mal-entendido caro

O texto que a Meta manda diz "your payment method". Lido dentro da conversa de um
aluno, numa escola que vende curso PARCELADO, o atendente conclui que o **cartão
do aluno** falhou e vai falar disso com ele. É pior do que erro técnico sem
tradução: manda a pessoa dar informação errada ao cliente.

`textoDeFalha` agora diz, em pt-BR: é a cobrança **da empresa**, não do cliente;
nenhum template sai até resolver no painel; avise um administrador; e resposta
dentro da janela de 24h continua funcionando — porque a última frase é o que
evita o atendente achar que perdeu o contato.

⏳ **Não implementado: aviso ativo para o admin.** Hoje isto foi descoberto por um
atendente notando um balão vermelho — uma interrupção total de template ficou ~3h
sem ninguém saber. `payment_new_sales` e "mensagem agendada que falhou" já são
fontes do sino (a Central deriva do banco, sem tabela própria); template falhando
por #131042 cabe no mesmo padrão e seria a próxima fonte a acrescentar.

Consulta para conferir o estado:
```sql
select date_trunc('day', created_at)::date as dia, count(*) as templates,
       count(*) filter (where status='failed') as falharam,
       count(*) filter (where error_detail ilike '%131042%') as por_pagamento
  from public.messages where template_name is not null
   and created_at > now() - interval '7 days' group by 1 order by 1 desc;
```

## "Não foi possível salvar o contato — tente novamente" (2026-09-01)

Relato: alguns usuários não conseguem adicionar contato, **nem abrir a conversa
com o contato adicionado**. Pareciam dois problemas; é **um só**, e o segundo
sintoma é consequência do primeiro — o contato nunca foi criado, então não havia
conversa para abrir.

### A causa: dedupe procurando no array do store

`dbContactActions.findByPhone` achava o duplicado pelo RPC (certo) e depois
procurava a LINHA no array do Zustand:

```ts
return contacts.find((c) => c.id === existingId) ?? null;   // ← array do store
```

⚠️ **A tela de Contatos deixou de carregar os 41 mil no store** (virou
`useContactsSearch`, consulta no servidor). Com o array vazio, `findByPhone`
respondia "não há duplicado"; o `add`, que consulta o banco de verdade, recusava
devolvendo `false`; e a tela traduzia isso em **"tente novamente"** — o único
conselho que não pode dar certo, porque repetir encontra o mesmo contato para
sempre.

⚠️ **É a MESMA armadilha já documentada nesta seção de Contatos** ("o dedupe da
importação era um `Set` do array do store… com a tela sem carregar a lista, o
array vive vazio e a checagem sumiria EM SILÊNCIO"). Lá foi resolvida com
`existing_contact_keys`; aqui passou batida.

⚠️ **E é o que explica "alguns usuários":** quem chegou por uma tela que ainda
carrega a lista inteira (Conversas, Calendários) tinha o array cheio e via a
mensagem certa; quem foi direto para Contatos via a genérica. Não era permissão
nem departamento.

Caso conferido no banco: o contato do print ("Leonardo Correa", CPF
06578979573) **já existia desde 24/08**, com telefone `557799331370`.
`private.phone_key` normaliza o digitado (`77999331370`) e o gravado para o mesmo
`7799331370` — o dedupe estava certo, a mensagem é que mentia.

### O que mudou

- `findByPhone` lê a linha do BANCO, não do store. Uma consulta por id é barata e
  torna a resposta independente do que a tela carregou.
- `dbContactActions.add` devolve **`ResultadoAdd`** (`ok` | `duplicado` +
  `existingId` | `erro` + mensagem) em vez de `boolean`. "Duplicado" e "falhou"
  chegavam como o MESMO `false`, e quem cria contato precisa saber qual dos dois
  foi.
- O aviso de duplicado leva **botão "Abrir contato"**. Dizer só "já existe" deixa
  a pessoa procurando à mão numa base de 41 mil — que é o que ela tentou evitar
  cadastrando de novo.
- O ramo no `add` é **segunda barreira**: mesmo que a checagem prévia da tela
  falhe, a mensagem sai certa porque o motivo vem do repo.

⚠️ **`tsc` NÃO pegou a troca de `boolean` por objeto**, e isso quase virou
regressão pior que o bug: `if (!ok)` sobre um objeto é sempre falso, então a tela
deixaria de mostrar QUALQUER erro e o formulário fecharia dizendo "Contato
criado" sem ter criado. Ao trocar um retorno booleano por objeto, procure os
`if (!x)` à mão — o compilador não avisa.

⏳ Ainda existem **8 `window.prompt`/`alert`** e outros pontos que devolvem
`boolean` cego para a UI. O padrão que este caso ensina: quando há mais de um
motivo de falha e eles pedem condutas diferentes, o retorno tem de dizer QUAL.

## 🔴 O código vai ao ar ANTES da migração — e isso quebrou o envio (2026-09-01)

Relato: a secretaria não consegue enviar num atendimento ativo; a tela diz
**"Cadastre um canal de WhatsApp em Canais de atendimento para enviar"** — numa
empresa que tem TRÊS canais cadastrados e ativos.

**Causa: regressão minha, do PR do canal principal.** O `open()` passou a ordenar
por `whatsapp_channels.principal`; o código foi mesclado e a Vercel publicou no
merge, mas a **migração `202608312055` é aplicada À MÃO e ainda não tinha sido**.
Nessa janela o PostgREST recusa a consulta inteira por causa da coluna
inexistente, `escolherCanal` devolve nada, e o `open()` criava a conversa com
`channel_id` **NULO** — uma conversa incapaz de enviar.

Conferido no banco: **2 conversas** nesse estado, ambas de hoje (13:18 e 15:53
BRT), ambas sem nenhuma mensagem do cliente — as duas criadas pelo CRM depois do
deploy. Nenhuma conversa vinda de mensagem de cliente foi afetada (o webhook
resolve o canal pelo `phone_number_id` do payload).

### ⚠️ A regra geral que sai daqui

**Neste projeto o código chega à produção ANTES da migração**, sempre: o deploy é
automático no merge e a migração é um passo manual. Então **toda consulta que
depende de coluna nova precisa sobreviver à ausência dela.** `escolherCanal`
agora tenta com `principal` e, se a consulta falhar, **refaz sem** — em vez de
devolver nada.

Isso vale para qualquer PR futuro que leia coluna nova. Não é zelo: é a ordem
real dos eventos aqui.

### As outras três correções do mesmo incidente

- ⚠️ **`open()` não cria mais conversa de WhatsApp SEM canal.** Criá-la em
  silêncio transforma uma falha de configuração (ou uma migração atrasada) num
  objeto quebrado que alguém descobre ao tentar atender. Devolve `null`, que o
  chamador já sabe tratar.
- ⚠️ **`conversationActions.ensureChannel` cura as que já nasceram assim.** Só
  age quando `channel_id` é NULO — reescrever o canal de uma conversa que já tem
  um trocaria o número que o cliente conhece, que é o defeito que a seção do
  canal principal existe para evitar. Confere as LINHAS devolvidas, não o `error`
  (UPDATE recusado pela RLS volta calado). Sem isso, a única saída para as duas
  conversas seria excluir e recriar, perdendo o que já foi escrito.
- ⚠️ **A mensagem culpava a configuração por um defeito nosso.** Agora o composer
  TENTA escolher o número antes de desistir, e só reclama quando realmente não há
  nenhum disponível para o setor — aí a frase é verdadeira.

### E um defeito antigo que apareceu no caminho

`open()` lia o próprio departamento assim:

```ts
.from("location_members").select("department_id").eq("location_id", location).maybeSingle()
```

**Sem `.eq("user_id", ...)`.** A policy de leitura de `location_members` é por
EMPRESA ("ver equipe da location"), então vinham TODAS as pessoas,
`maybeSingle()` reclamava de várias linhas e o departamento saía nulo — virando
"sem restrição de canal" em silêncio. Com uma pessoa só na empresa funcionava;
com equipe, não. Corrigido com o filtro por `auth.uid()`.

## Respostas rápidas: eram DUAS listas com o mesmo nome (2026-09-01)

Pedido: "adicionar a opção de editar e adicionar respostas rápidas". Ao abrir o
composer, o motivo do pedido ficou claro — **existiam dois menus, os dois
chamados "Respostas rápidas"**:

| menu | fonte | editável |
|---|---|---|
| ícone de raio | `QUICK_REPLIES`, array **fixo no código** | ❌ |
| botão "Trechos" | `public.snippets` (0003) | criar/excluir, **sem editar** |

⚠️ **O `DropdownMenuLabel` do menu "Trechos" já dizia "Respostas rápidas"** — ou
seja, o próprio código chamava as duas coisas pelo mesmo nome. Quem pedia para
editar estava olhando justamente a que não dava, e não havia como descobrir isso
pela tela.

Agora existe **UMA** lista, no banco, editável nos dois lugares.

- A lista fixa **saiu do código**, e a migração **202609011821** move as 5 frases
  para `snippets` para ninguém perder o que já usava. Idempotente por
  `(location_id, name)`: a tabela é editada pela tela, então reexecutar não pode
  encher a lista de repetidas.
- ⚠️ **As 5 ganharam NOME** ("Saudação", "Pedir um momento"…). No código eram
  anônimas e o menu mostrava o texto inteiro; `snippets` tem nome + conteúdo, e o
  menu mostra o nome em negrito com prévia embaixo. Sem nome curto, o menu vira
  uma pilha de parágrafos — que é o que a lista de trechos de curso já evitava.
- `snippetActions.update` **não existia**: dava para criar e excluir, e corrigir
  uma vírgula exigia apagar e reescrever. Em texto que o atendente manda dezenas
  de vezes por dia (valores de curso, requisitos), isso é atrito real. Confere as
  LINHAS devolvidas, não o `error` — UPDATE recusado pela RLS volta calado. O
  `remove` tinha o mesmo furo e foi corrigido junto.
- **Criar e editar acontecem no composer**, sem sair do atendimento. Antes,
  criar exigia abandonar a conversa e ir na aba; "Nova resposta rápida" já vem
  com o que estiver escrito no campo, que é o momento natural de salvar um texto
  que se acabou de compor.
- ⚠️ **O lápis fica FORA do `DropdownMenuItem`**, num `<div>` irmão: dentro dele,
  o clique fecharia o menu E inseriria o texto no campo — o oposto de "editar".
- ⚠️ **O formulário é UM componente** (`resposta-rapida-dialog.tsx`), usado pelo
  composer e pela aba. Dois formulários teriam duas validações e duas mensagens
  de erro para divergirem — e foi exatamente assim que o CRM acabou com duas
  listas de respostas rápidas.
- ⚠️ **Campos limpos por `key`, não por `useEffect`.** O inicializador do
  `useState` só vale na primeira montagem, então sem isso abrir o diálogo para
  uma segunda resposta mostraria o texto da primeira (o defeito que a transcrição
  de áudio já teve aqui). A saída óbvia — um efeito semeando os campos — é
  `setState` dentro de efeito, que causa renderização em cascata e o lint acusa.
  Remontar por `key={editando.id || "novo"}` resolve sem efeito nenhum.
- A aba **"Trechos" passou a se chamar "Respostas rápidas"**, e o vocabulário do
  CRM fica sendo o do usuário. Ainda é a mesma tabela: nada a migrar além do seed.

## #131026 no template: o CRM mandava para número INEXISTENTE (2026-09-02)

Relato: template falhando com **"Message Undeliverable · #131026"**. Não tem
relação com o #131042 de cobrança do dia anterior.

⚠️ **A causa é o "+" que se perde no webhook, e o efeito é o CRM enviando para
números que não existem.** O `from` da Meta é o número internacional COMPLETO, só
sem o "+", e era gravado cru em `contacts.phone`. Sem o "+", `toWhatsAppNumber`
adivinhava o país pelos dois primeiros dígitos — e **vários códigos de país
COLIDEM com DDD brasileiro**. Medido no banco:

```
61412914627  (+61 412 914 627, Austrália) -> 5561412914627   "61" = DF
15149635422  (+1 514 963 5422, Canadá)    -> 5515149635422   "15" = Sorocaba
16472895906  (+1 647 289 5906, Canadá)    -> 5516472895906   "16" = Ribeirão
```

⚠️ **O que fazia parecer problema DA CONTA e não nosso:** os três contatos
**escreveram** para nós (a entrada funciona, porque quem resolve o número é a
Meta) e **nenhum jamais recebeu resposta**. Do lado de dentro, parecia que o
WhatsApp recusava a conversa.

Escala medida: **219 contatos** com forma não-brasileira levando `55` na frente,
e **99** contatos internacionais que já nos escreveram e estavam nessa situação.

### As três frentes da correção

1. **`pareceBrasileiro`** — o DDD sozinho não decide mais. Exige a FORMA do
   assinante: celular com 11 dígitos começando em **9** (obrigatório no Brasil
   desde 2016), fixo com 10 dígitos começando em **2–5**. Isso resolve todos os
   casos de 11 dígitos sem tocar em número brasileiro nenhum.
2. **O webhook grava com "+"** (`"+" + from`). Torna a adivinhação desnecessária
   daqui para frente. `private.phone_key` (0047) só olha dígitos, então o "+" não
   afeta o dedupe por telefone.
3. **Migração 202609021021**, com critério ESTREITO: só contato que já nos
   ESCREVEU. Se existe mensagem de entrada, o telefone veio do `from` da Meta e é
   comprovadamente completo — não é suposição. ⚠️ Contato digitado à mão ou vindo
   da importação **não entra**: ali 11 dígitos podem genuinamente ser brasileiros
   sem o 55, e carimbar "+" criaria o defeito INVERSO.

⏳ **Sobra um caso genuinamente ambíguo, e está escrito como teste para não ser
"corrigido" sem pensar:** 10 dígitos que são ao mesmo tempo fixo brasileiro e
internacional plausíveis (`9549373665` = "(95) 4937-3665" ou "+1 954 937 3665").
Pelos dígitos não há como decidir; assume-se brasileiro, que é o caso muito mais
comum nesta base. Quem precisa do outro salva com "+".

`npm run test:phone` — **30 asserções**, com os casos `[real]` sendo números que
estavam no banco falhando. ⚠️ **Metade vigia o lado oposto** (não estragar o
número brasileiro): regra estrita demais aqui é PIOR que o bug, porque pararia de
entregar para 41 mil contatos em vez de 219.
