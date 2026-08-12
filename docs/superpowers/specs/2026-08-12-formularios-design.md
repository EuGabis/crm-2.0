# Construtor de Formulários de Captação — Design Spec

> Módulo **Sites → Formulários** do Lito CRM: criar formulários de captação de leads,
> incorporá-los no site (embed `<script>`, igual ao RVOPS) e cada envio vira **Contato**
> no CRM, agrupado numa **Lista Inteligente** por formulário, pronto pra e-mail marketing.
> Data: 2026-08-12. Convenções: `AGENTS.md`.

## Objetivo

Substituir o mock da aba **Sites → Formulários** por um construtor real: o usuário monta
o formulário (campos + detalhes), o CRM gera um **snippet `<script>`** pra colar no site
(litoaviation.com), e cada preenchimento **cria/atualiza um Contato** com a **tag do
formulário**. Cada formulário nasce com uma **Lista Inteligente** homônima (filtra por essa
tag), então os leads capturados ficam prontos pra **disparo de e-mail marketing** (o
composer de campanha já mira `tag` ou `smart_list`).

Espelha o modelo do RVOPS (builder com Campos/Detalhes + embed via script) pra ser familiar.

## Não-objetivos (v1)

- **Editor visual de estilos** — o form é renderizado **sem estilo** (herda o CSS do site),
  por decisão do Gabriel. Sem aba "Estilos".
- **Landing pages / funis / páginas hospedadas** — só o embed pra colar no site (sem página
  pública hospedada pelo CRM na v1).
- **Campos avançados** (upload de arquivo, pagamento, múltiplas etapas, lógica condicional).
- **Pesquisas/quizzes com pontuação** (a aba "Pesquisas" fica como está).
- **Criar oportunidade em pipeline no envio** — o destino é Contato + Lista Inteligente
  (marketing), não pipeline de vendas (decisão do Gabriel).
- **A/B, agendamento de ativação por data/hora** — só um toggle `active` simples na v1.

## Decisões aprovadas (brainstorming)

1. **Entrega = embed `<script>`** gerado pelo CRM (como o RVOPS: `.../generate.js?id=...`),
   pra colar no site. Editar no CRM reflete no site sem recolar.
2. **Estilo:** **sem estilo** (herda o CSS da página onde for colado).
3. **No envio:** cria/atualiza **Contato** + aplica a **tag do formulário** → o Contato cai
   na **Lista Inteligente** do form (filtro por essa tag). Pronto pra e-mail marketing.
   Nada de pipeline.
4. Builder espelha o RVOPS (campos + painel de detalhes com ação de sucesso = redirect/mensagem).

## Arquitetura

```
Builder (Sites → Formulários) — cria/edita form + gera o embed
   → salva em `forms`; ao criar, cria também a Lista Inteligente (smart_lists) com o filtro da tag

Site do cliente:  <script src=".../api/forms/{slug}/embed.js"></script>
   → o script renderiza o form (sem estilo) e, no submit, faz:
   POST /api/forms/{slug}/submit  (público, cross-origin)
     → cria/atualiza Contato (service role) + aplica a tag + grava form_submissions
     → responde { ok, redirect? }  → o script redireciona (ou mostra mensagem)
```

As rotas `/api/forms/*` são **públicas** (o form roda no site do cliente, sem sessão do
CRM), então ficam **FORA do matcher do `proxy.ts`** (como o webhook do WhatsApp) e usam a
**service role**. Precisam de **CORS liberado** (o site é outro domínio) e tratar `OPTIONS`.

O identificador público na URL é um **`slug`** (ou id não sequencial) do formulário — não
expõe nada sensível; a rota resolve `location_id` pelo próprio registro do form.

## Modelo de dados (migração `0024_forms.sql`)

**`public.forms`**
- `id uuid`, `location_id uuid` (RLS), `slug text unique` (id público do embed),
  `name text`, `description text`, `fields jsonb` (array — ver abaixo),
  `success_action text check in ('redirect','message')`, `success_value text`
  (URL de obrigado ou texto da mensagem), `tag text` (tag aplicada ao contato),
  `smart_list_id uuid references smart_lists(id) on delete set null`,
  `active boolean default true`, `created_at`, `updated_at`.
- RLS padrão membership; `revoke all from anon`.

**Formato de cada campo em `fields` (jsonb):**
```json
{ "key": "nome", "label": "Nome", "type": "text|email|tel|textarea",
  "required": true, "mapsTo": "name|email|phone|company|custom:<campo>" }
```
- `mapsTo` liga o campo a um atributo do Contato: `name` (→ firstName+lastName, split no
  primeiro espaço), `email`, `phone`, `company`, ou `custom:<nome-do-campo>` (vai pro
  `contacts.custom_fields`). Campos padrão: **Nome** (`name`, req), **E-mail** (`email`,
  req), **WhatsApp** (`phone`, req). "Adicionar campo" oferece `company` e os campos de
  `contact_fields` (personalizados).

**`public.form_submissions`**
- `id uuid`, `location_id uuid` (RLS), `form_id uuid references forms(id) on delete cascade`,
  `contact_id uuid references contacts(id) on delete set null`, `payload jsonb`
  (o que foi enviado), `created_at`.
- RLS: membros LEEM; inserção é feita pela rota pública com **service role** (bypassa RLS).

> **Colisão de número:** `0024` é o próximo livre no `AGENTS.md`. O outro Claude pode pegar
> `0024` em paralelo — reconciliar no merge (renumerar como fizemos: 0020→0022).

## Lista Inteligente automática

Ao criar um form, o CRM cria uma linha em `smart_lists`:
- `name` = nome do form (ex.: "Forms de mecânico"),
- `conditions` = `[{ "field": "Tag", "operator": "contém", "value": "<forms.tag>" }]`.

Isso casa com `matchesConditions()` (`src/components/contacts/module-tabs.tsx`), que para
`field === "Tag"` testa `c.tags.join(" ")`. A **tag** default = o nome do form (editável);
deve ser única o suficiente (o filtro usa "contém"). O `forms.smart_list_id` guarda o vínculo.
No composer de e-mail marketing, o público pode ser `type: "smart_list"` (essa lista) ou
`type: "tag"` (a tag do form) — ambos já suportados.

## Embed (`GET /api/forms/{slug}/embed.js`)

Responde **JavaScript** (`Content-Type: application/javascript`), público, cache curto.
O script:
- Lê a config do form (inline no próprio JS gerado, ou fetch da config pública).
- Renderiza o `<form>` **sem classes de estilo** (herda o CSS do site) num container: onde o
  `<script>` está, ou um `<div id="lito-form-{slug}">` se existir.
- Inclui um campo **honeypot** oculto (anti-spam).
- No `submit`: `fetch POST /api/forms/{slug}/submit` (JSON dos campos + honeypot). Em
  sucesso → redireciona pra `success_value` (se `redirect`) ou substitui o form pela
  mensagem (se `message`). Em erro → mostra aviso e reabilita o botão.
- Respeita `active` (form inativo → não renderiza / mostra aviso).

## Envio (`POST /api/forms/{slug}/submit`)

Pública (sem sessão), **service role**, **CORS liberado** (+ `OPTIONS`).
- Se o **honeypot** vier preenchido → responde `{ ok: true }` e **descarta** (bot).
- Carrega o form pelo `slug` (pega `location_id`, `fields`, `tag`, `active`, `success_*`).
  Form inativo → `409`.
- Mapeia os campos recebidos pelos `mapsTo`. **Dedup:** procura Contato existente por
  `email` (ou `phone`) na location; se achar, **atualiza** (merge de tags + campos); senão
  **cria**. Sempre garante a **tag** do form em `contacts.tags`. Nome → firstName+lastName.
- Grava `form_submissions` (payload cru + contact_id).
- Resposta: `{ ok: true, action: 'redirect'|'message', value }` (o script decide o que fazer).
- Proteção básica: honeypot + validação dos campos obrigatórios; (rate-limit fica pra depois).

## Repo (`src/lib/data/repos/db/forms.ts`)

- `useForms(): { forms, ready }` — lista de forms da empresa (+ contagem de envios).
- `formActions.create(input): Promise<{ ok, id?, error? }>` — cria o form **e** a Lista
  Inteligente (condição da tag) numa tacada; grava `smart_list_id`.
- `formActions.update(id, patch)` / `remove(id)` / `toggleActive(id, active)`.
- `useFormSubmissions(formId)` — envios de um form (aba de leads do form).
- `embedSnippet(slug): string` — devolve o `<script src=".../api/forms/{slug}/embed.js"></script>`.

## UI (`src/app/(app)/sites/page.tsx` aba "Formulários" + `src/components/sites/forms/*`)

- **Lista de formulários:** nome, nº de envios, ativo, botões **Editar**, **Copiar embed**,
  **Ver leads** (abre a lista inteligente/os envios). Empty state + "Novo formulário".
- **Editor** (espelha o RVOPS, mas enxuto): coluna de **Campos** (Nome/E-mail/WhatsApp +
  "Adicionar campo", cada um com editar rótulo/obrigatório/excluir/reordenar) e painel
  **Detalhes** (nome, descrição, **ação de sucesso**: redirecionar URL ou mostrar mensagem,
  toggle **Ativado**). Botão **Salvar**. Ao salvar um form novo → cria a Lista Inteligente.
- **Copiar embed:** mostra o `<script>` e um botão de copiar (com aviso "cole no HTML da sua
  página"). Texto pt-BR; estilo conforme `AGENTS.md`.

## Segurança

- Rotas `/api/forms/*` públicas: sem segredo exposto; a rota resolve tudo pelo `slug`/DB
  com service role. Fora do matcher do proxy; **CORS** liberado só nessas rotas.
- Anti-spam: honeypot (v1). Sem PII em query string. Envio não confia em `location_id` do
  cliente — vem do registro do form.
- RLS por location em `forms` e `form_submissions`; a escrita pública usa service role.
- O embed é JS público read-only (renderiza o form); nenhuma credencial vai nele.

## Testes / verificação

- Sem runner de testes → gate `npx tsc --noEmit` + `npm run build`.
- Manual: criar form no CRM → copiar embed → colar numa página HTML de teste (ou usar o
  `GET embed.js` direto) → enviar → conferir Contato criado com a tag + aparece na Lista
  Inteligente do form + `form_submissions` gravado + redirect/mensagem. `OPTIONS`/CORS ok
  de outro domínio. Honeypot preenchido → descartado.

## Ordem de dependência

Migração `0024` aplicada (Gabriel, SQL Editor) → deploy → criar form → colar o embed no
site. Sem aprovação externa (diferente de WhatsApp/Google Ads): é só nosso backend.
