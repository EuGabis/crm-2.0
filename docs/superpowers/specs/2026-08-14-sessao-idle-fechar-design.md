# Sessão — idle 5 min (usuário) + fechar navegador exige login — Design Spec

> Dois comportamentos de sessão: (1) após **5 min de inatividade**, o usuário de papel
> **"user"** (não admin) é deslogado; (2) ao **fechar o navegador**, exige login de novo
> (refresh/navegar/nova aba NÃO deslogam). Data: 2026-08-14. Convenções: `AGENTS.md`.

## Objetivo

Endurecer a sessão sem atrapalhar o uso: admins ficam logados; usuários comuns caem por
inatividade; e ninguém continua logado depois de fechar o navegador.

## Decisões aprovadas (Gabriel, 2026-08-14)

1. **Idle 5 min → desloga, SÓ papel "user"** (admin nunca cai por inatividade).
2. **Fechar o navegador → exige login** (via marcador de sessão do navegador). Refresh,
   navegação e abrir nova aba **não** deslogam. (Limitação inerente: navegadores com
   "restaurar sessão/continuar de onde parou" podem preservar o marcador — comportamento do navegador.)

## Não-objetivos (v1)

- Logout por-aba (foi decidido por-navegador).
- Aviso de "vai deslogar em X" / contador regressivo — v1 desloga direto.
- Timeout configurável por empresa/usuário — 5 min fixo.
- Sincronizar atividade entre abas (cada aba tem seu timer; fechar tudo → login).

## Arquitetura

**Marcador de sessão do navegador** (Parte 2): um cookie **de sessão** que a gente controla,
`lito_active=1` (sem `max-age`/`expires` → some ao fechar o navegador; compartilhado entre abas
enquanto aberto). NÃO mexemos nos cookies de auth do Supabase (arriscado) — o marcador é separado.

- **Setado no login** (`src/app/login/page.tsx`): após `signInWithPassword`/`signUp` com sucesso,
  antes do `router.push("/dashboard")`, chama `markBrowserSession()`.
- **Checado** por um componente cliente `<SessionManager />` montado no layout do app: se o
  marcador **não existe** (navegador foi fechado e reaberto, ou primeiro load pós-deploy) mas há
  sessão Supabase válida (o proxy deixou passar) → `signOut()` + redireciona `/login?reason=expired`.

**Idle timeout** (Parte 1) — mesmo `<SessionManager />`:
- Só arma se `me?.role === "user"` (admin ou papel desconhecido → não arma; protege o admin).
- Ouve atividade (`mousemove`, `mousedown`, `keydown`, `scroll`, `touchstart`, `click`) e atualiza
  um `lastActivity`. Um `setInterval` (a cada 15s) checa: se `now - lastActivity > 5min` →
  `signOut()` + redireciona `/login?reason=idle`.

**Helper** `src/lib/auth/session-marker.ts`: `markBrowserSession()`, `hasBrowserSession()`,
`clearBrowserSession()` (cookie de sessão `path=/; samesite=lax` + `secure` em https).

**Mensagem no /login**: a página de login lê `?reason=` e mostra um toast
(`idle` → "Sessão encerrada por inatividade. Entre novamente."; `expired` → "Faça login novamente.").

## Componentes/arquivos

- Criar `src/lib/auth/session-marker.ts` (helpers do cookie de sessão).
- Criar `src/components/layout/session-manager.tsx` (`"use client"`; idle + marcador; renderiza `null`).
- Modificar `src/app/(app)/layout.tsx` — montar `<SessionManager />`.
- Modificar `src/app/login/page.tsx` — `markBrowserSession()` antes dos 2 `router.push("/dashboard")`;
  ler `?reason=` e mostrar toast.

## Detalhes

- **Logout** = `createClient().auth.signOut()` (best-effort try/catch) → `clearBrowserSession()` →
  `window.location.href = "/login?reason=..."` (reload completo limpa o estado dos stores).
- `<SessionManager />` só existe dentro de `(app)` — o `/login` fica fora, então não há loop de redirect.
- O marcador é setado **só no login**; o `SessionManager` nunca seta (só checa). Assim, cada sessão de
  navegador exige um login pra (re)criar o marcador.
- Papel vem de `useMyMembership()` (`me`, `isAdmin`, `loaded`). Enquanto `me` for null (carregando ou
  falha), o idle **não** arma — evita deslogar admin por engano.
- Usuários já logados no deploy (cookie Supabase persistente, sem marcador) fazem **um** login extra
  na primeira vez — aceitável e alinhado à nova política.

## Segurança

- Não expõe segredo; não altera RLS. O `signOut()` limpa a sessão de verdade no cliente; o proxy
  (server) continua sendo a barreira real de rotas.
- O marcador é só um sinal de UX (não é credencial). Mesmo se forjado, o proxy/RLS mandam.

## Testes / verificação

- Sem runner → gate `npx tsc --noEmit` + `npm run build`.
- Manual: (a) logar como **user**, ficar 5 min parado → cai no login com aviso de inatividade;
  mexer o mouse reseta. (b) logar como **admin**, ficar parado → NÃO cai. (c) fechar o navegador e
  reabrir → pede login; (d) refresh / nova aba / navegar → continua logado.

## Ordem de dependência

Sem migração, sem env. Só front-end/auth client.
