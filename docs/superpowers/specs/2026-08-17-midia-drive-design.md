# Mídia Drive real + Google Drive e Canva — Design Spec

> O módulo mostrava oito nomes de arquivo fixos no código e todos os botões só
> emitiam toast. Agora é armazenamento de verdade, com Google Drive e Canva
> conectados por OAuth. Data: 2026-08-17. Convenções: `AGENTS.md`.
> Migrações: **0044** e **0045**.

## Objetivo

Guardar mídia da empresa no CRM (upload, pastas, download, exclusão) e, para
quem já vive no Drive e no Canva, listar e abrir de lá sem sair da tela.

## Não-objetivos (v1)

- Editar arquivo dentro do CRM (o Canva abre no editor dele, em nova aba).
- Importar do Drive/Canva para o bucket do CRM (é leitura e link, não cópia).
- Compartilhar arquivo por link público — o bucket é privado, os links são
  assinados e expiram em 1h.
- Cota por empresa (o "X usados" soma o que existe, mas nada bloqueia).
- Miniatura própria de imagem/vídeo do CRM (mostra ícone por tipo).

## Armazenamento (migração 0044)

Mesmo desenho de `payment_files` (0015): binários num bucket **privado**
(`media-drive`), metadados em `media_files` com RLS de membership, e as policies
de `storage.objects` espelhando isso pelo primeiro segmento do caminho
(`{location_id}/{uuid}.{ext}`).

**Pastas são tabela (`media_folders`), não prefixo do caminho.** Com prefixo,
renomear pasta viraria mover N objetos no storage e pasta vazia não existiria.
Quem organiza é `folder_id`.

**Excluir pasta NÃO exclui os arquivos** (`on delete set null`): eles voltam
para a raiz. Perder um vídeo por causa de uma pasta apagada não tem desfazer —
e o aviso da tela diz isso antes.

**Upload que falha no metadado remove o binário.** Um objeto órfão no bucket
contaria no espaço usado e não apareceria em tela nenhuma.

## Conexões (migração 0045)

Uma tabela para as duas integrações (`media_connections`): o que muda entre elas
é o endpoint, não o formato do que guardamos.

⚠️ **Token é segredo.** A tabela é **admin-only**, como `payment_credentials`
(0008), e quem lê o token nas rotas é a **service role**. As telas que só
precisam saber SE está conectado leem a view `media_integration_status`, sem
token — sem ela, todo usuário não-admin veria "não conectado" (o bug que a Guru
teve duas vezes, em camadas diferentes).

**Renovação automática**: `getAccessToken` troca o refresh token quando o
access expirou (margem de 60s). Sem isso a integração morreria em uma hora e o
admin reconectaria todo dia. O Canva rotaciona o refresh token a cada uso; o
código guarda o novo quando vem.

**PKCE no Canva** (S256, exigência da Connect API): o `code_verifier` vai num
cookie httpOnly — no `localStorage` qualquer script da página leria o segredo.
O `state` é HMAC-assinado e amarrado ao navegador por cookie, como no OAuth do
Google Ads.

**Só admin conecta/desconecta.** A tela esconde o botão e as rotas conferem o
papel; a RLS recusaria a gravação de qualquer forma.

## Escopos pedidos

- Google Drive: `drive.readonly` — o CRM lista e abre, **nunca** altera nada.
- Canva: `design:meta:read asset:read profile:read`.

## Peças

- `supabase/migrations/0044_midia_drive.sql`, `0045_integracoes_midia.sql`
- `src/lib/integrations/media-oauth.ts` — state/PKCE, troca e renovação de token,
  leitura pela service role.
- `src/app/api/media/oauth/{start,callback}/route.ts` — o fluxo OAuth.
- `src/app/api/media/files/route.ts` — lista Drive (v3) / designs do Canva.
- `src/app/api/media/disconnect/route.ts`
- `src/lib/data/repos/db/media.ts` — pastas, upload, mover, renomear, excluir,
  URL assinada, total usado.
- `src/lib/data/repos/db/media-connections.ts` — estado das conexões pela view.
- `src/app/(app)/midia/page.tsx` — abas "Meus arquivos", "Google Drive", "Canva".

## Passos manuais pendentes (Gabriel)

1. Aplicar `0044_midia_drive.sql` e `0045_integracoes_midia.sql` no SQL Editor.
2. **Google Drive**: no mesmo projeto do Google Cloud usado no Google Ads,
   ativar a **Google Drive API**, adicionar o escopo `drive.readonly` na tela de
   consentimento e cadastrar os redirects
   `http://localhost:3000/api/media/oauth/callback` e
   `https://lito-crm.vercel.app/api/media/oauth/callback`.
3. **Canva**: criar um app no Canva Developers (Connect API), pedir os escopos
   acima, cadastrar o mesmo redirect e copiar Client ID/Secret para
   `CANVA_CLIENT_ID` / `CANVA_CLIENT_SECRET` no `.env.local` **e** na Vercel.
4. Conectar em `/midia` → aba do provedor → "Conectar".

**Sem passo 2 e 3, o resto do módulo funciona normalmente** — as abas mostram
"não conectado" e a rota responde 503 explicando qual credencial falta.
