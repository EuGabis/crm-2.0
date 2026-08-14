# Áudio ogg/opus gravado no navegador — remoção do ffmpeg server-side

## Motivação
A rota `/api/whatsapp/send-media` convertia `audio/webm` (formato gravado pelo
Chrome/Edge) para `audio/ogg` via `ffmpeg-static` + `spawn`. No serverless da
Vercel o binário nativo não é empacotado corretamente (ENOENT), então a
conversão falhava em produção. Solução: gravar já em ogg/opus no cliente com
`opus-media-recorder` (polyfill do MediaRecorder em WebAssembly) e a rota só
sobe os bytes como recebidos.

## O que mudou

### 1. Dependência
`npm install opus-media-recorder` (v0.8.0). `npm uninstall ffmpeg-static`
(removido do `package.json`/`package-lock.json`).

### 2. Assets estáticos do encoder
Copiados de `node_modules/opus-media-recorder/` para `public/opus-media-recorder/`
(servidos por URL, exigido pela lib — worker + WASM não passam pelo bundler do
Next da forma como o composer os usa):
- `encoderWorker.umd.js` (44 115 bytes)
- `OggOpusEncoder.wasm` (225 576 bytes)

Não foi copiado `WebMOpusEncoder.wasm`/`.bin` (não usamos mais webm) nem
`OggOpusEncoder.bin`/`.js` (o `.umd.js` do worker já resolve o encoder via
`OggOpusEncoderWasmPath`).

### 3. `src/components/inbox/composer.tsx`
- Import `import OpusMediaRecorder from "opus-media-recorder";` (default export).
- `recorderRef` tipado como `useRef<InstanceType<typeof OpusMediaRecorder> | null>(null)`
  (a lib não tem types próprios — módulo declarado `any`).
- `startRec`: troquei a escolha de mimeType (`audio/ogg;codecs=opus` vs
  `audio/webm`) por `mimeType = "audio/ogg"` fixo, e a criação do
  `MediaRecorder` nativo por:
  ```ts
  const workerOptions = {
    encoderWorkerFactory: () => new Worker("/opus-media-recorder/encoderWorker.umd.js"),
    OggOpusEncoderWasmPath: "/opus-media-recorder/OggOpusEncoder.wasm",
  };
  const mr = new OpusMediaRecorder(stream, { mimeType }, workerOptions);
  ```
- `ondataavailable` anotado como `(e: BlobEvent) =>` (necessário porque `mr` é
  `any` — sem tipo contextual o TS reclamava de parâmetro implícito).
- `onstop`: removida a lógica de escolher extensão (`ogg` vs `webm`); agora
  sempre monta `new File(chunks, \`audio-${secs}s.ogg\`, { type: "audio/ogg" })`.
  Resto do fluxo (timer, cancelar, `conversationActions.sendMedia` +
  `whatsappActions.sendMedia`, toasts) mantido igual.

### 4. Tipos
Criado `src/types/opus-media-recorder.d.ts`:
```ts
declare module "opus-media-recorder";
```
Import vira `any` — aceitável (a API é compatível com `MediaRecorder`, só sem
type-checking dos métodos).

### 5. `src/app/api/whatsapp/send-media/route.ts`
Removidos: imports `ffmpeg-static`, `spawn` (`node:child_process`),
`writeFile/readFile/unlink/copyFile/chmod/access/rename` (`node:fs/promises`),
`tmpdir` (`node:os`), `randomUUID` (`node:crypto`); funções `ffmpegBin()` e
`webmToOgg()`; o bloco `if (kind === "audio" && /webm/.../)` que chamava a
conversão. `export const runtime = "nodejs"` também saiu (só existia por causa
do `spawn`/fs nativo — a rota agora só usa `fetch`/Supabase, roda igual em
edge ou node; não há motivo pra fixar o runtime).

O que sobrou/ficou igual na rota: `createClient`, `uploadMedia`/`sendMediaMessage`
(`@/lib/whatsapp/client`), `export const dynamic = "force-dynamic"`, todos os
gates (auth via `getUser()`, canal ativo, contato com telefone, `daily_limit`,
janela de 24h), download do Storage, upload pra Cloud API e marcação
sent/failed em `messages`. `sendBytes`/`sendMime` continuam como variáveis
próprias (antes eram `let` porque a conversão reatribuía; hoje são `const`
copiando `bytes`/`mime` — deixei assim, mudar pra usar `bytes`/`mime`
diretamente seria só cosmético).

### 6. `next.config.ts`
Removido `outputFileTracingIncludes` (só existia pro binário do ffmpeg).
Ficou `const nextConfig: NextConfig = {};`.

### 7. `package.json`
`ffmpeg-static` removido de `dependencies`.

## Verificação
- `npx tsc --noEmit` — limpo.
- `npm run build` — limpo, todas as rotas geradas normalmente (incluindo
  `/api/whatsapp/send-media` como função dinâmica).
- Não testado no navegador (gravação real de áudio) — isso depende de deploy
  e teste manual em Chrome/Edge/Firefox/Safari.

## Riscos / pontos de atenção pra quem for testar
- A gravação exige HTTPS (ou localhost) — regra da própria lib
  `opus-media-recorder`, não muda nada aqui.
- Testar em pelo menos Chrome/Edge (que antes só sabiam gravar webm) e Safari
  (que não suporta MediaRecorder nativo de opus) pra confirmar que o polyfill
  cobre os dois casos.
- Se o WhatsApp rejeitar o arquivo, verificar se o Content-Type/ext (`audio/ogg`)
  bate com o que a Cloud API espera pro `uploadMedia` (ela já recebia
  `audio/ogg` antes, só que gerado pelo ffmpeg — o container gerado pelo
  `opus-media-recorder` deve ser equivalente, mas vale conferir no primeiro
  envio real).
