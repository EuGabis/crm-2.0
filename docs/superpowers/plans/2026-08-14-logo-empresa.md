# Logo da empresa (upload + whitelabel) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o "Alterar logo" funcionar — admin sobe uma imagem (Supabase Storage), vira o logo da empresa e é exibido no topo da sidebar (whitelabel), no Perfil da empresa e nos convites por e-mail.

**Architecture:** Bucket público `branding` + coluna `locations.logo_url`. `accountActions.uploadCompanyLogo` valida e sobe o arquivo, salva a URL na location (RLS admin) e atualiza o store `useAccount`. A UI (perfil, sidebar, template de convite) lê `company.logoUrl` e mostra `<img>` quando houver, senão o fallback atual (letra).

**Tech Stack:** Next.js (App Router) · TypeScript · Supabase Storage (padrão de `payment-files`/0015) · Zustand.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-14-logo-empresa-design.md`. Convenções: `AGENTS.md` (inclui a seção "Trabalho em paralelo — dois Claudes"; `AGENTS.md` é arquivo de ALTA COLISÃO, edição só ADITIVA).
- **Migração livre = `0033`** → `supabase/migrations/0033_company_logo.sql`. Idempotente. ⚠️ O outro Claude pode pegar `0033` — reconciliar no merge (renumerar).
- **Migração aplicada pelo Gabriel** no SQL Editor (o worker NÃO aplica).
- **Sem runner de testes:** verificação = `npx tsc --noEmit` **e** `npm run build` limpos (do repo `C:\Users\Gabriel\Documents\crm 2.0`, NÃO worktree). O build do Next roda eslint e acusa símbolo não usado.
- **Padrão Storage:** reusa `payment-files` (migração 0015): pasta raiz = `location_id`, políticas por `private.user_locations()`. Bucket do logo é **público** (leitura liberada; escrita escopada).
- **`logo_url` em `locations` = admin-only** (a RLS de UPDATE de locations já reforça; a UI já desabilita p/ não-admin).
- **Whitelabel:** só o **símbolo** vira o logo; o **nome** continua `brand.name`. Não mexer no texto.
- **Texto pt-BR.** Commits `feat(config): ...` (ou `feat(branding): ...`). Branch → PR → squash na `main`. Área do Claude B (UI/config).

---

## File Structure

**Criar:**
- `supabase/migrations/0033_company_logo.sql` — `locations.logo_url` + bucket `branding` + políticas.

**Modificar:**
- `src/lib/data/repos/db/account.ts` — `logoUrl` em `CompanyProfile` + `uploadCompanyLogo` + preservar logo no `updateCompany`.
- `src/app/(app)/configuracoes/perfil/page.tsx` — exibir logo + input de upload.
- `src/components/layout/sidebar.tsx` — logo no topo (whitelabel).
- `src/lib/email/invite-template.ts` — `logoUrl?` + cabeçalho com `<img>`.
- `src/app/api/team/invite/route.ts` — `select` do `logo_url` + passar `logoUrl`.
- `AGENTS.md` — doc + próxima migração livre.

---

## Task 1: Migração 0033 (logo_url + bucket branding)

Cria a coluna, o bucket público e as políticas. Deliverable: SQL pronto + build limpo.

**Files:**
- Create: `supabase/migrations/0033_company_logo.sql`

**Interfaces:**
- Produces (SQL): `public.locations.logo_url text`; bucket público `branding`; políticas storage.

- [ ] **Step 1: Escrever a migração**

Create `supabase/migrations/0033_company_logo.sql`:

```sql
-- ============================================================
-- Lito CRM — Logo da empresa (whitelabel)
--
-- locations.logo_url guarda a URL pública do logo; o binário vai para o bucket
-- PÚBLICO `branding` no caminho {location_id}/logo-{ts}.{ext}. Leitura liberada
-- (logo aparece no app e em e-mail); escrita/exclusão só por membros da empresa,
-- escopadas pela pasta = location_id (mesmo padrão de payment-files/0015).
-- Setar logo_url em locations é admin-only (a RLS de UPDATE de locations reforça).
-- Idempotente.
-- ============================================================
set check_function_bodies = off;

alter table public.locations add column if not exists logo_url text;

insert into storage.buckets (id, name, public)
values ('branding', 'branding', true)
on conflict (id) do nothing;

drop policy if exists "logo leitura pública" on storage.objects;
create policy "logo leitura pública" on storage.objects
  for select using (bucket_id = 'branding');

drop policy if exists "membros gravam logo" on storage.objects;
create policy "membros gravam logo" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'branding'
    and nullif((storage.foldername(name))[1], '')::uuid in (select private.user_locations())
  );

drop policy if exists "membros atualizam logo" on storage.objects;
create policy "membros atualizam logo" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'branding'
    and nullif((storage.foldername(name))[1], '')::uuid in (select private.user_locations())
  );

drop policy if exists "membros apagam logo" on storage.objects;
create policy "membros apagam logo" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'branding'
    and nullif((storage.foldername(name))[1], '')::uuid in (select private.user_locations())
  );
```

- [ ] **Step 2: Aplicação (Gabriel)**

Pedir ao Gabriel para rodar `supabase/migrations/0033_company_logo.sql` no SQL Editor.

- [ ] **Step 3: Verificar build**

Run: `npx tsc --noEmit && npm run build`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0033_company_logo.sql
git commit -m "feat(config): migração 0033 (locations.logo_url + bucket branding)"
```

---

## Task 2: Repo — upload + logoUrl

Adiciona o upload e o campo no store. Deliverable: build limpo; exports para a UI.

**Files:**
- Modify: `src/lib/data/repos/db/account.ts`

**Interfaces:**
- Produces: `CompanyProfile.logoUrl: string`; `accountActions.uploadCompanyLogo(file: File): Promise<{ ok: boolean; error?: string }>`.

- [ ] **Step 1: `logoUrl` no tipo + no load**

Em `src/lib/data/repos/db/account.ts`:
- Na interface `CompanyProfile`, adicionar `logoUrl: string;` (após `city`).
- No `load()`, o mapeamento hoje é
  `company: location ? { id: location.id, name: location.name, city: location.city ?? "" } : null,`.
  Trocar para incluir o logo:
  ```ts
  company: location
    ? { id: location.id, name: location.name, city: location.city ?? "", logoUrl: location.logo_url ?? "" }
    : null,
  ```

- [ ] **Step 2: Preservar logo no `updateCompany`**

Ainda em `account.ts`, no `updateCompany`, o patch do store hoje é
`company: { id: data.id, name: data.name, city: data.city ?? "" },`. Trocar para preservar o logo:
```ts
useAccountStore.getState().patch({
  company: { id: data.id, name: data.name, city: data.city ?? "", logoUrl: data.logo_url ?? "" },
});
```

- [ ] **Step 3: `uploadCompanyLogo`**

Adicionar ao objeto `accountActions` (junto de `updateCompany`/`updateProfile`):
```ts
  async uploadCompanyLogo(file: File): Promise<{ ok: boolean; error?: string }> {
    const { company } = useAccountStore.getState();
    if (!company) return { ok: false, error: "Empresa não encontrada" };
    const okTypes = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
    if (!okTypes.includes(file.type)) {
      return { ok: false, error: "Use uma imagem PNG, JPG, WEBP ou SVG" };
    }
    if (file.size > 2 * 1024 * 1024) {
      return { ok: false, error: "A imagem deve ter no máximo 2 MB" };
    }
    const supabase = createClient();
    const ext = file.name.split(".").pop()?.toLowerCase() || "png";
    const path = `${company.id}/logo-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("branding")
      .upload(path, file, { upsert: true, contentType: file.type });
    if (upErr) return { ok: false, error: "Falha ao enviar a imagem" };

    const { data: pub } = supabase.storage.from("branding").getPublicUrl(path);
    const logoUrl = pub.publicUrl;

    const { data, error } = await supabase
      .from("locations")
      .update({ logo_url: logoUrl })
      .eq("id", company.id)
      .select()
      .maybeSingle();
    if (error || !data) {
      // não-admin ou falha: não deixa binário órfão no bucket
      await supabase.storage.from("branding").remove([path]);
      return { ok: false, error: "Apenas administradores podem alterar o logo" };
    }

    useAccountStore.getState().patch({ company: { ...company, logoUrl } });
    return { ok: true };
  },
```

- [ ] **Step 4: Verificar build**

Run: `npx tsc --noEmit && npm run build`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/lib/data/repos/db/account.ts
git commit -m "feat(config): upload de logo da empresa no repo (uploadCompanyLogo)"
```

---

## Task 3: UI — Perfil + Sidebar

Exibe o logo e liga o botão de upload. Deliverable: build limpo + browser: subir logo aparece nos dois lugares.

**Files:**
- Modify: `src/app/(app)/configuracoes/perfil/page.tsx`
- Modify: `src/components/layout/sidebar.tsx`

**Interfaces:**
- Consumes: `company.logoUrl`, `accountActions.uploadCompanyLogo` de `@/lib/data/repos/db/account`.

- [ ] **Step 1: Perfil — exibir logo + upload**

Em `src/app/(app)/configuracoes/perfil/page.tsx`:
- Adicionar `useRef` ao import de react: `import { useEffect, useRef, useState } from "react";`.
- No componente, adicionar:
  ```ts
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  const onLogoPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite re-selecionar o mesmo arquivo
    if (!file) return;
    setUploadingLogo(true);
    const res = await accountActions.uploadCompanyLogo(file);
    setUploadingLogo(false);
    res.ok ? toast.success("Logo atualizado") : toast.error(res.error ?? "Não foi possível enviar");
  };
  ```
- Trocar o bloco da caixinha + botão (hoje `<div ...>{(form.name[0] ?? "?").toUpperCase()}</div>` + o `<Button ... onClick={() => toast.info(...)}>Alterar logo</Button>`) por:
  ```tsx
  <div className="flex items-center gap-3">
    <div className="flex size-14 items-center justify-center overflow-hidden rounded-xl bg-indigo-500 text-xl font-black text-white">
      {company?.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={company.logoUrl} alt="Logo" className="size-full object-cover" />
      ) : (
        (form.name[0] ?? "?").toUpperCase()
      )}
    </div>
    <input
      ref={fileInputRef}
      type="file"
      accept="image/png,image/jpeg,image/webp,image/svg+xml"
      className="hidden"
      onChange={onLogoPick}
    />
    <Button
      variant="outline"
      size="sm"
      className="h-7 text-xs"
      disabled={!isAdmin || uploadingLogo}
      onClick={() => fileInputRef.current?.click()}
    >
      {uploadingLogo ? "Enviando..." : "Alterar logo"}
    </Button>
  </div>
  ```
  (`company` já vem de `useAccount()`; `isAdmin` já existe; `toast` e `accountActions` já importados.)

- [ ] **Step 2: Sidebar — logo no topo (whitelabel)**

Em `src/components/layout/sidebar.tsx`, a caixinha do topo hoje é:
```tsx
<div className="flex size-8 items-center justify-center rounded-lg bg-[var(--lito-sidebar-accent)] text-sm font-black text-white">
  {brand.shortName[0]}
</div>
```
Trocar para mostrar o logo quando houver (mantendo `{brand.name}` no texto ao lado, inalterado):
```tsx
<div className="flex size-8 items-center justify-center overflow-hidden rounded-lg bg-[var(--lito-sidebar-accent)] text-sm font-black text-white">
  {company?.logoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={company.logoUrl} alt="Logo" className="size-full object-cover" />
  ) : (
    brand.shortName[0]
  )}
</div>
```
(`company` já vem de `useAccount()` no componente — linha `const { company } = useAccount();`.)

- [ ] **Step 3: Verificar build**

Run: `npx tsc --noEmit && npm run build`
Expected: sem erros, sem warning de símbolo não usado.

Browser (após migração aplicada): `/configuracoes/perfil` → Alterar logo → escolher PNG → aparece na caixinha e no topo da sidebar. `read_console_messages` sem erros.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/configuracoes/perfil/page.tsx" src/components/layout/sidebar.tsx
git commit -m "feat(config): logo no perfil e no topo da sidebar (whitelabel)"
```

---

## Task 4: Convite por e-mail com o logo

O e-mail de convite usa o logo da empresa. Deliverable: build limpo.

**Files:**
- Modify: `src/lib/email/invite-template.ts`
- Modify: `src/app/api/team/invite/route.ts`

**Interfaces:**
- `InviteEmailData` ganha `logoUrl?: string`.

- [ ] **Step 1: Template — campo + cabeçalho**

Em `src/lib/email/invite-template.ts`:
- Em `InviteEmailData`, adicionar (após `email`):
  ```ts
  /** URL pública do logo da empresa (opcional) */
  logoUrl?: string;
  ```
- No cabeçalho, o `<td style="padding-right:10px;">` hoje contém um `<div>` com `${brand.shortName[0]}`. Trocar o CONTEÚDO desse `<td>` por um condicional (logo se houver, senão o box atual):
  ```ts
  ${data.logoUrl
    ? `<img src="${data.logoUrl}" alt="${escapeHtml(data.companyName)}" width="34" height="34" style="width:34px;height:34px;border-radius:9px;object-fit:cover;display:block;" />`
    : `<div style="width:34px;height:34px;background-color:${INDIGO};border-radius:9px;color:#ffffff;font-size:17px;font-weight:800;line-height:34px;text-align:center;">${brand.shortName[0]}</div>`}
  ```
  (`escapeHtml` já existe no arquivo — é usado mais abaixo.)

- [ ] **Step 2: Rota — buscar e passar o logo**

Em `src/app/api/team/invite/route.ts`:
- O select da location hoje é `supabase.from("locations").select("name").eq(...)`. Trocar para `.select("name, logo_url")`.
- Na chamada `renderInviteEmail({ ... companyName: location?.name ?? "sua empresa", ... })`, adicionar:
  ```ts
  logoUrl: location?.logo_url ?? undefined,
  ```

- [ ] **Step 3: Verificar build**

Run: `npx tsc --noEmit && npm run build`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add src/lib/email/invite-template.ts "src/app/api/team/invite/route.ts"
git commit -m "feat(config): logo da empresa no e-mail de convite"
```

---

## Task 5: Docs

Documenta o módulo. Deliverable: build limpo; `AGENTS.md` atualizado.

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Doc no AGENTS.md**

`AGENTS.md` é ALTA COLISÃO (dois Claudes) — edição **só ADITIVA**, não reescrever seções alheias. Rodar `ls supabase/migrations/` antes; nossa é `0033_company_logo.sql` → próxima livre = **0034** (se nada maior existir). Adicionar um parágrafo curto (na seção de Configurações/empresa ou logo abaixo) e atualizar a nota de "próxima migração livre" pra **0034**. Conteúdo (bater com o código):
- Logo da empresa (whitelabel): bucket público `branding` + `locations.logo_url` (migração `0033`).
  Upload em `/configuracoes/perfil` via `accountActions.uploadCompanyLogo` (valida PNG/JPG/WEBP/SVG ≤2MB,
  caminho `{location_id}/logo-*`, admin-only pela RLS de locations). Exibido no perfil, no topo da
  sidebar (no lugar do símbolo, mantendo `brand.name`) e no e-mail de convite. Sem env nova.

- [ ] **Step 2: Verificar build**

Run: `npx tsc --noEmit && npm run build`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "docs(config): seção logo da empresa e próxima migração livre 0034"
```

---

## Handoff (Gabriel — fora do código)

1. Rodar `supabase/migrations/0033_company_logo.sql` no SQL Editor (cria a coluna, o bucket e as políticas).
2. Merge → deploy. Em `/configuracoes/perfil`, subir o logo → aparece no perfil, no topo da sidebar e nos convites.

## Self-Review (autor do plano)

- **Cobertura da spec:** coluna+bucket+políticas → Task 1; repo (logoUrl + uploadCompanyLogo) → Task 2;
  perfil + sidebar → Task 3; convite → Task 4; docs → Task 5. Não-objetivos (crop, remover logo,
  favicon/cor, login/PDF) ficam de fora. ✓
- **Consistência de tipos:** `CompanyProfile.logoUrl` (Task 2) consumido no perfil/sidebar (Task 3);
  `uploadCompanyLogo(file): {ok,error?}` (Task 2) chamado exatamente assim (Task 3); coluna `logo_url`
  (Task 1) lida em `account.ts` (Task 2) e na rota de convite (Task 4); `InviteEmailData.logoUrl?`
  (Task 4 template) alimentado pela rota (Task 4). ✓
- **Sem placeholders:** todo passo tem código/edição real; verificação por tsc/build. ✓
- **Storage:** bucket público (leitura p/ e-mail); escrita escopada por pasta=location (0015);
  `upsert:true` precisa de policy de insert E update — ambas na migração. ✓
- **Ponto de atenção:** `<img>` (não `next/image`) com eslint-disable pontual — o projeto já usa `<img>`
  em outros pontos (logo do perfil); evita config de domínio remoto do next/image pro Supabase Storage.
