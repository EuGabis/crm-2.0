# Google Ads (Visão geral, somente leitura) — Design Spec

> Módulo **Marketing → Gerenciador de anúncios** do Lito CRM: espelhar a tela
> "Visão geral" do Google Ads (KPIs + gráfico + campanhas) com dados reais da
> conta conectada, via **API oficial do Google Ads**, **somente leitura**.
> Data: 2026-08-12. Convenções: `AGENTS.md`.

## Objetivo

Substituir o mock da aba "Gerenciador de anúncios" por um espelho real da Visão
geral do Google Ads da empresa conectada: cartões de **Cliques, Conversões,
Custo/conv., Custo**, um **gráfico** de série temporal (Cliques × Conversões) no
período, e uma **tabela de campanhas** (nome, status, métricas). Cada empresa
conecta a própria conta Google via OAuth; o CRM lê os dados por GAQL.

## Não-objetivos (v1)

- **Escrita/mutação** — criar, editar, pausar campanha, orçamento, palavras-chave,
  grupos de anúncios, anúncios. É fase 2 (exige escopo de mutação). v1 é read-only.
- **Seleção de múltiplas contas / hierarquia MCC** — v1 usa **a primeira conta
  acessível** retornada pela API (decisão aprovada). Sem tela de seleção.
- **Outras abas do Google Ads** — Recomendações, Metas, Públicos-alvo, Ferramentas,
  Faturamento, Adm. Não são espelhadas.
- **Drilldown** por grupo de anúncios / palavra-chave / criativo. Só overview +
  tabela de campanhas.
- **Integração com Meta/Facebook Ads** — fora de escopo (bloqueada por acesso à BM;
  tratada separadamente).

## Decisões aprovadas (brainstorming)

1. **API oficial do Google Ads**, dados ao vivo (não import CSV, não manual).
2. **Somente leitura** — espelhar a Visão geral (fase 1). Criar/editar/pausar = fase 2.
3. **Conta = a primeira/única acessível** (sem UI de seleção).
4. **Construir e validar já contra uma conta de TESTE do Google Ads** (o developer
   token tem acesso a conta de teste imediatamente). Quando o **Basic access** for
   aprovado, a mesma conexão aponta pra conta real — **sem mudança de código**.
5. UI dentro de **Marketing → Gerenciador de anúncios** (área do Claude B / UI).

## Arquitetura

```
Empresa clica "Conectar Google Ads"
  → GET /api/google-ads/oauth/start  (sessão do usuário; state assinado)
  → consentimento Google (escopo adwords, access_type=offline)
  → GET /api/google-ads/oauth/callback  (troca code→tokens; pega 1ª conta;
       salva refresh_token + customer_id por location) → volta pra /marketing

Aba "Gerenciador de anúncios" (conectada)
  → GET /api/google-ads/overview?from&to  (service-role lê refresh_token;
       renova access token; roda GAQL via searchStream) → { kpis, series, campaigns }
  → UI renderiza KPIs + gráfico + tabela
```

**Escopo de credencial:**
- **Nível do sistema (env, um app OAuth só):** developer token + OAuth client.
- **Por empresa (banco):** refresh_token + customer_id. O refresh_token **nunca**
  vai para o cliente (coluna com `revoke select` + leitura só por rotas server com
  service-role).

As rotas `/api/google-ads/*` têm **sessão do usuário** (o callback é redirect
same-site com cookies; overview é XHR autenticado), então **permanecem no matcher
normal do `proxy.ts`** com `getUser()` — diferente do webhook do WhatsApp (que é
máquina-a-máquina e fica fora do matcher). Nenhuma alteração no `proxy.ts`.

## Config (env — nunca `NEXT_PUBLIC_`)

- `GOOGLE_ADS_DEVELOPER_TOKEN` — developer token da conta MCP/administrador do Google Ads.
- `GOOGLE_OAUTH_CLIENT_ID` — OAuth client (Web) do Google Cloud.
- `GOOGLE_OAUTH_CLIENT_SECRET` — segredo do OAuth client.
- `GOOGLE_ADS_API_VERSION` — opcional, default `v18`; ajustar para uma versão
  **atualmente suportada** da Google Ads API se necessário (a API versiona ~3×/ano).
- `NEXT_PUBLIC_APP_URL` — já existe; usado para montar o redirect URI.

Redirect URI registrado no Google Cloud (Authorized redirect URIs):
`http://localhost:3000/api/google-ads/oauth/callback` (dev) e
`https://lito-crm.vercel.app/api/google-ads/oauth/callback` (prod).

## Modelo de dados (migração `0023_google_ads.sql`)

**`public.google_ads_connections`** — uma conexão por empresa
- `id`, `location_id` (**único**, RLS), `customer_id text` (id da conta, sem hífens),
  `login_customer_id text` (id da MCC quando aplicável; nulo p/ conta direta),
  `refresh_token text` (**segredo**), `connected_email text`, `currency_code text`,
  `connected_at timestamptz`, `active boolean default true`, `created_at`, `updated_at`.
- RLS padrão membership (`location_id in (select private.user_locations())`),
  `revoke all from anon`.
- **Proteção do segredo:** `revoke select (refresh_token) on ... from anon, authenticated;`
  — membros leem as colunas de status, mas **não** o refresh_token. As rotas server
  leem o token com a **service-role** (bypassa RLS e o revoke de coluna).
- `unique (location_id)` — uma conexão por empresa (a "primeira conta").
- trigger `set_updated_at`.

> **Colisão de numeração:** `0023` é o próximo número livre segundo o `AGENTS.md`.
> O outro Claude (Pagamentos) pode pegar `0023` em paralelo — reconciliar no merge
> (renumerar se preciso, como foi feito com o WhatsApp: 0020→0022).

## Cliente Google Ads (`src/lib/google-ads/client.ts`) — server-only

Base REST: `https://googleads.googleapis.com/{GOOGLE_ADS_API_VERSION}`.
Headers comuns: `Authorization: Bearer <accessToken>`, `developer-token: <DEV_TOKEN>`,
e `login-customer-id: <id>` quando houver MCC.

- `refreshAccessToken(refreshToken): Promise<string>` — `POST https://oauth2.googleapis.com/token`
  (`grant_type=refresh_token`, client id/secret) → `access_token`.
- `exchangeCode(code, redirectUri): Promise<{ refreshToken, accessToken }>` —
  `POST https://oauth2.googleapis.com/token` (`grant_type=authorization_code`).
- `listAccessibleCustomers(accessToken): Promise<string[]>` —
  `GET /customers:listAccessibleCustomers` → resourceNames `customers/{id}` → retorna ids.
- `search(customerId, loginCustomerId, accessToken, gaql): Promise<any[]>` —
  `POST /customers/{customerId}/googleAds:searchStream` body `{ query: gaql }` →
  concatena `results` dos batches. Lança com a mensagem de erro do Google em não-2xx.
- `getCustomerInfo(customerId, ..., accessToken)` — GAQL
  `SELECT customer.descriptive_name, customer.currency_code FROM customer` (nome + moeda).

Micros → moeda: `cost_micros / 1_000_000`. Custo/conv = `cost / conversions`
(guarda divisão por zero → 0).

## OAuth (`/api/google-ads/oauth/{start,callback}`)

Ambas autenticadas (`getUser()` + membership; a `location` vem da sessão, não do state).

- **start (GET):** monta a URL de consentimento
  `https://accounts.google.com/o/oauth2/v2/auth` com `client_id`, `redirect_uri`,
  `response_type=code`, `scope=https://www.googleapis.com/auth/adwords`,
  `access_type=offline`, `prompt=consent`, `state=<assinado>`. `state` = HMAC
  (nonce+timestamp) com `GOOGLE_OAUTH_CLIENT_SECRET` (anti-CSRF; validade curta).
  Responde `redirect` para a URL.
- **callback (GET):** valida `state` (assinatura + frescor); `getUser()` → location;
  `exchangeCode` → refresh/access token; `listAccessibleCustomers` → **primeira** conta;
  `getCustomerInfo` (nome/moeda); **upsert** em `google_ads_connections` (service-role,
  por `location_id`); redireciona para `/marketing?tab=ads&connected=1`. Em erro,
  `/marketing?tab=ads&error=<msg curta>`.

Se `listAccessibleCustomers` vier vazio → erro claro ("nenhuma conta Google Ads
acessível com esse login").

## Dados (`GET /api/google-ads/overview?from=YYYY-MM-DD&to=YYYY-MM-DD`)

Autenticada. Carrega a conexão da location; service-role lê o refresh_token;
`refreshAccessToken`; roda 2 consultas GAQL:

1. **Totais + série diária** (`FROM customer`, segmentado por dia):
   `SELECT segments.date, metrics.clicks, metrics.conversions, metrics.cost_micros
    FROM customer WHERE segments.date BETWEEN '<from>' AND '<to>'`
   → série `[{ date, clicks, conversions, cost }]`; KPIs = somatórios (cost em BRL),
   `custo/conv = custoTotal / conversõesTotal`.
2. **Campanhas** (`FROM campaign`):
   `SELECT campaign.name, campaign.status, metrics.clicks, metrics.conversions,
    metrics.cost_micros FROM campaign WHERE segments.date BETWEEN '<from>' AND '<to>'
    ORDER BY metrics.cost_micros DESC`
   → `[{ name, status, clicks, conversions, cost, costPerConv }]`.

Resposta: `{ connected: true, currency, kpis: { clicks, conversions, cost, costPerConv },
series: [...], campaigns: [...] }`. Sem conexão → `{ connected: false }` (200).
Erro da API (token expirado/sem acesso) → `502 { error }` com a mensagem do Google.

Datas default (se ausentes): últimos 30 dias (fuso do servidor; aceitável na v1).

## Repo (`src/lib/data/repos/db/google-ads.ts`)

- `useGoogleAdsConnection(): { connection, ready }` — lê status da conexão
  (colunas não-secretas) via Supabase RLS.
- `googleAdsActions.overview(from, to): Promise<OverviewData | null>` — GET na rota.
- `googleAdsActions.disconnect(): Promise<boolean>` — apaga a conexão da empresa
  (`delete` por location; RLS garante membership). (Revogar o token no Google é
  opcional; v1 só remove localmente.)
- `startConnectUrl()` — retorna `/api/google-ads/oauth/start` (a UI faz
  `window.location.href = ...` para sair pro consentimento).

## UI (`src/components/marketing/ads-manager-tab.tsx`)

Substitui o bloco mock de "Gerenciador de anúncios" em
`src/app/(app)/marketing/page.tsx` por `<AdsManagerTab />`.

- **Sem conexão:** empty state "Conecte sua conta do Google Ads" + botão
  **"Conectar Google Ads"** (vai pro `/oauth/start`). Trata `?error=` (toast).
- **Conectada:** cabeçalho com a conta (`connected_email` / nome) + "Desconectar";
  seletor de período (7/30 dias, este mês, personalizado; default 30);
  4 `KpiCard` (Cliques, Conversões, Custo/conv. em moeda, Custo em moeda);
  **gráfico** Recharts (LineChart, 2 séries: Cliques e Conversões, eixo por data);
  **tabela** de campanhas (nome, status com badge, cliques, conversões, custo,
  custo/conv.). Loading/erro tratados (skeleton + toast). `?connected=1` → toast de sucesso.

Estilo conforme `AGENTS.md` (h1, cards `rounded-xl border bg-white`, tabela `text-xs`,
badge de status). Texto pt-BR; moeda via `formatBRL` quando `currency_code = BRL`
(fallback: formata com o código da moeda).

## Passos manuais (Gabriel) — detalhados no plano

1. **Google Cloud:** criar projeto → ativar **Google Ads API** → **tela de
   consentimento OAuth** (External; adicionar o escopo `.../auth/adwords`; enquanto
   não verificado, adicionar seu e-mail como *test user*) → criar **OAuth client (Web)**
   com os dois redirect URIs (localhost + prod) → copiar Client ID/Secret.
2. **Developer token:** na conta **administradora (MCP)** do Google Ads → Tools &
   Settings → **API Center** → gerar o developer token. Ele já dá acesso a **conta de
   teste**; solicitar **Basic access** para bater na conta real (aprovação do Google).
3. **Conta de teste** (para construir agora): criar uma test manager account + test
   client account (ou usar as de teste do Google) para validar OAuth + dados ponta a ponta.
4. **Envs:** `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_OAUTH_CLIENT_ID`,
   `GOOGLE_OAUTH_CLIENT_SECRET` no `.env.local` e na Vercel; redeploy.
5. Conectar via a UI (`/marketing` → Gerenciador de anúncios → Conectar Google Ads).

## Segurança

- Developer token e OAuth client secret **só no servidor** (env, nunca `NEXT_PUBLIC_`).
- refresh_token no banco, **inacessível ao cliente** (`revoke select (refresh_token)`;
  leitura só via service-role nas rotas server).
- `state` do OAuth assinado (anti-CSRF); a location vem da sessão autenticada, não do state.
- Todas as rotas validam `getUser()` + membership; RLS por location na tabela.
- Access token é efêmero (renovado a cada consulta a partir do refresh_token; não persistido).

## Testes / verificação

- Sem runner de testes no projeto → gate é `npx tsc --noEmit` + `npm run build` limpos.
- **Conta de teste do Google Ads** valida ponta a ponta: conectar (OAuth) → callback
  grava a conexão → overview retorna KPIs/série/campanhas de teste → UI renderiza.
- Checagem de segurança: cliente não consegue `select refresh_token` (coluna revogada).
- Quando o Basic access sair, repetir o fluxo apontando pra conta real — sem mudar código.

## Ordem de dependência (produção)

Rota publicada + envs na Vercel + OAuth client com o redirect de produção + (para
dados reais) developer token com Basic access. Enquanto o Basic não sai, tudo funciona
contra a conta de teste.
