# Logo da empresa (upload + whitelabel) — Design Spec

> Faz o **"Alterar logo"** funcionar: o admin sobe uma imagem (Supabase Storage), ela vira o
> logo da empresa e passa a ser usada no topo da sidebar (no lugar do "L" da marca do produto),
> no Perfil da empresa e nos convites por e-mail. Data: 2026-08-14. Convenções: `AGENTS.md`.
> Primeiro uso de Storage no branding; reusa o padrão de `payment-files` (migração 0015).

## Objetivo

Hoje o botão "Alterar logo" (`/configuracoes/perfil`) só dá um toast. O Gabriel quer subir o
logo da empresa e o sistema passar a exibi-lo — **whitelabel**: o símbolo do topo da sidebar
vira o logo da empresa.

## Decisões aprovadas (Gabriel, 2026-08-14)

1. **Whitelabel completo:** o logo aparece no **Perfil da empresa**, no **topo da sidebar**
   (substituindo o símbolo "L" da marca do produto) e nos **convites por e-mail**.
2. O **nome "Lito CRM" continua vindo de `brand`** (config) — trocamos só o **símbolo/logo visual**.

## Não-objetivos (v1)

- Crop/redimensionamento de imagem no navegador — sobe como está (com limite de tamanho/tipo).
- Cor/tema da sidebar por empresa, favicon, ou outros pontos de whitelabel — só o logo.
- Logo em relatórios/PDF, login screen — fase futura.
- Remover logo (voltar pro "L") — v1 só troca; remoção fica pra depois.

## Arquitetura

```
/configuracoes/perfil → "Alterar logo" → input file → accountActions.uploadCompanyLogo(file)
    valida tipo/tamanho → sobe pro bucket público `branding` em {location_id}/logo-{ts}.{ext}
    → getPublicUrl → update locations.logo_url (RLS admin) → atualiza o store

Exibição (lê company.logoUrl do mesmo store useAccount):
    - Perfil da empresa: <img> no lugar da caixinha com a letra
    - Sidebar (topo): <img> no lugar de brand.shortName[0] (mantém o texto brand.name)
    - Convite (e-mail): <img> no cabeçalho se houver logo (via api/team/invite → renderInviteEmail)
```

Bucket **público** (o logo é mostrado no app e em e-mail — precisa de URL pública). Escrita/exclusão
só por membros da empresa, escopadas pela pasta = `location_id` (espelha `payment-files`/0015).
Setar `logo_url` em `locations` é **admin-only** (RLS já existente reforça).

## Modelo de dados (migração — próximo número livre, provável 0033)

- `public.locations` ganha `logo_url text` (nullable).
- Bucket `storage.buckets` **público** `branding` (`public = true`, `on conflict do nothing`).
- Políticas em `storage.objects` para `bucket_id = 'branding'`:
  - **select** liberado (bucket público — logo visível em e-mail/anon).
  - **insert/update/delete** `to authenticated` com
    `nullif((storage.foldername(name))[1], '')::uuid in (select private.user_locations())`
    (só a pasta da própria empresa) — mesmo padrão da 0015.
- Idempotente (`add column if not exists`, `drop policy if exists`, `on conflict do nothing`).

## Repo (`src/lib/data/repos/db/account.ts`)

- `CompanyProfile` ganha `logoUrl: string` (default `""`); `load()` lê `location.logo_url`.
- `updateCompany` passa a preservar `logoUrl` no mapeamento do store (não perder ao salvar nome/cidade).
- Novo `accountActions.uploadCompanyLogo(file: File): Promise<{ ok: boolean; error?: string }>`:
  - valida: tipo em `image/png|jpeg|webp|svg+xml`, tamanho ≤ 2 MB (senão retorna erro claro).
  - `path = ${company.id}/logo-${Date.now()}.${ext}`; `supabase.storage.from("branding").upload(path, file, { upsert: true, contentType })`.
  - `getPublicUrl(path)` → `logo_url`.
  - `update locations set logo_url` (RLS admin; se não-admin, o update volta vazio → erro
    "Apenas administradores…" e remove o binário órfão do bucket).
  - atualiza `company.logoUrl` no store.

## UI

- **`/configuracoes/perfil`**: a caixinha mostra `<img src={company.logoUrl}>` (object-contain,
  rounded) quando houver logo, senão a letra atual. "Alterar logo" dispara um `<input type="file"
  accept="image/*">` escondido; no change chama `uploadCompanyLogo` com estado de "Enviando…";
  toast de sucesso/erro. Botão só habilitado p/ admin (como o resto do form).
- **Sidebar (`src/components/layout/sidebar.tsx`)**: a caixinha do topo (hoje `brand.shortName[0]`)
  mostra `<img>` quando `company.logoUrl`, senão a letra. Texto `brand.name` inalterado.
- **Convite (`src/lib/email/invite-template.ts` + `src/app/api/team/invite/route.ts`)**:
  `InviteEmailData` ganha `logoUrl?: string`; o cabeçalho renderiza `<img>` se houver, senão
  `brand.shortName[0]`. A rota faz `select("name, logo_url")` da location e passa `logoUrl`.

## Segurança

- Bucket público só serve leitura do binário (logo não é sensível). Escrita escopada por
  membership/pasta (RLS storage). `logo_url` em `locations` só admin (RLS existente).
- Validação de tipo/tamanho no cliente (defesa de UX); o bucket aceita só o que subimos.
- Sem novo segredo/env.

## Testes / verificação

- Sem runner → gate `npx tsc --noEmit` + `npm run build`.
- Manual (após aplicar a migração): em `/configuracoes/perfil`, subir um PNG → aparece na caixinha,
  no topo da sidebar, e (ao convidar alguém) no e-mail. Não-admin não consegue salvar.

## Ordem de dependência

Migração aplicada (Gabriel) — cria a coluna + o bucket + políticas. Sem env nova, sem aprovação externa.
