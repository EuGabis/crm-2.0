# Fix: mensagem WhatsApp instantânea + conversão de áudio webm→ogg

Branch: `fix/whatsapp-audio-otimista`
Commits: `6d56016` (fix A), `3c6c262` (fix B)

## FIX A — insert otimista da mensagem de texto WhatsApp

Arquivos:
- `src/app/api/whatsapp/send/route.ts` — retorno final agora inclui a linha
  gravada: `{ ok: true, id: msg.id, waMessageId, message: msg }`.
- `src/lib/data/repos/db/whatsapp.ts` — `whatsappActions.send` repassa
  `message: json.message` no sucesso; tipo de retorno ganhou `message?: any`.
- `src/lib/data/repos/db/conversations.ts` — nova ação
  `conversationActions.pushSent(row)`, ao lado de `send`/`sendMedia`. Reusa
  `mapMessage` e `useConvStore`; dedup por id (o Realtime pode reentregar a
  mesma mensagem — mesmo guard que `send`/`sendMedia` já usam).
- `src/components/inbox/composer.tsx` — no bloco `if (isWhatsapp && !internal
  && !scheduledFor)`, dentro de `if (res.ok)`, chama
  `conversationActions.pushSent(res.message)` antes do toast de sucesso.

Resultado: a mensagem aparece no inbox no mesmo instante do envio, sem
esperar o Realtime; se o evento Realtime chegar depois, o dedup por id evita
duplicata.

## FIX B — converter áudio webm→ogg no servidor (ffmpeg)

- Instalado `ffmpeg-static` (`npm install ffmpeg-static`) — aditivo em
  `package.json`/`package-lock.json`.
- `src/app/api/whatsapp/send-media/route.ts`:
  - Novo helper `webmToOgg(bytes)` fora do `POST`, usando
    `spawn(ffmpegPath, ["-i", inPath, "-vn", "-c:a", "libopus", "-f", "ogg",
    "-y", outPath])`, arquivos temporários em `os.tmpdir()`, limpos no
    `finally`.
  - Depois do download do Storage (`bytes = await blob.arrayBuffer()`),
    quando `kind === "audio"` e o mime contém `webm`, converte para
    `audio/ogg` antes de chamar `uploadMedia`. Falha na conversão marca a
    mensagem como `failed` e responde 502 (mesmo padrão do catch existente
    da chamada à Cloud API).
  - `uploadMedia`/extensão do arquivo agora usam `sendBytes`/`sendMime` (em
    vez de `bytes`/`mime`), preservando o restante do fluxo (janela de 24h,
    daily_limit, marcação sent/failed) inalterado.

### Empacotamento do binário no Vercel (`next.config.ts`)

Next.js 16.3.0 usa `outputFileTracingIncludes` como opção de **topo** (não
mais em `experimental`), confirmado em
`node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/output.md`.
A chave é um **glob de rota** (casado com o path da rota, ex.
`/api/whatsapp/send-media`), e o valor é uma lista de globs de arquivo
resolvidos a partir da raiz do projeto.

Adicionado (aditivo, `next.config.ts` só tinha o objeto vazio antes):

```ts
outputFileTracingIncludes: {
  "/api/whatsapp/send-media": ["./node_modules/ffmpeg-static/ffmpeg*"],
},
```

Usei o glob `ffmpeg*` (não `ffmpeg` fixo) porque o binário baixado pelo
`ffmpeg-static` no postinstall tem nome diferente por plataforma —
`ffmpeg.exe` no Windows (ambiente local) e `ffmpeg` (sem extensão) no build
Linux da Vercel. O glob cobre os dois sem precisar saber qual vai rodar no
deploy.

**Concern:** não há como validar 100% que o binário linux realmente entra no
bundle serverless sem rodar `vercel build`/deploy de fato (o `next build`
local, no Windows, empacota o `ffmpeg.exe` — não testei o cenário Linux). Se
a rota falhar em produção com "ffmpeg ENOENT" ou permissão de execução,
primeiro suspeito é esse tracing; verificar
`.vercel/output/functions/api/whatsapp/send-media.func` após um deploy.

## Verificação

- `npx tsc --noEmit` — limpo, sem erros.
- `npm run build` — sucesso (`✓ Compiled successfully`), todas as 40 rotas
  geradas, incluindo `/api/whatsapp/send-media` como função dinâmica (`ƒ`).
