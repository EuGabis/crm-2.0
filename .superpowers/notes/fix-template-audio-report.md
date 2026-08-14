# Fix: template com variáveis (#132000) + ffmpeg no Vercel

Branch: `fix/template-params-audio-ffmpeg`

## Fix 1 — TemplatePicker coleta variáveis do corpo

`src/components/whatsapp/template-picker.tsx` reescrito:

- `bodyVarCount(components)` e `bodyText(components)` — parsers do componente
  BODY (`{{n}}`).
- Clique no template: se `bodyVarCount === 0`, chama `onPick({ name, language })`
  e fecha como antes.
- Se `> 0`, entra em um segundo passo (estado `selected` + `params: string[]`)
  com preview do texto do corpo e um `<Input>` (com `<Label>`) por variável
  ("Variável 1", "Variável 2", ...). Botão "Enviar" desabilitado até todos os
  campos estarem preenchidos; ao confirmar, chama
  `onPick({ name, language, components: [{ type: "body", parameters: [...] }] })`
  e fecha. Botão "Voltar" zera `selected`/`params` e volta pra lista.
- `outsideWindow`, loading e "Cancelar" preservados. Sem `asChild` (Base UI).
- `src/components/inbox/composer.tsx` (único consumidor) já repassa `tpl`
  inteiro para `whatsappActions.send`, então o `components` opcional flui sem
  mudança adicional lá.

## Fix 2 — ffmpeg em /tmp + chmod + erro detalhado

`src/app/api/whatsapp/send-media/route.ts`:

- Imports: `copyFile`, `chmod`, `access` adicionados a `node:fs/promises`.
- Novo `ffmpegBin()` (cacheado em módulo): copia o binário de `ffmpeg-static`
  para `tmpdir()/ffmpeg-bin` na primeira chamada e faz `chmod 0o755`; chamadas
  seguintes reutilizam o cache. Evita depender de permissão de execução em
  `node_modules` (read-only no bundle serverless do Vercel).
- `webmToOgg` agora resolve `const bin = await ffmpegBin()` antes do `spawn`,
  em vez de `spawn(ffmpegPath as unknown as string, ...)`.
- Catch de conversão agora captura o erro (`catch (e)`) e retorna
  `"Falha ao converter o áudio: " + mensagem real` (status 502) em vez de uma
  mensagem genérica — facilita diagnóstico em produção.
- `outputFileTracingIncludes` (next.config.ts) e `export const runtime = "nodejs"`
  mantidos sem alteração.

## Verificação

- `npx tsc --noEmit` — limpo, sem erros.
- `npm run build` — sucesso (Turbopack), todas as 40 páginas geradas, todas
  as rotas de API compiladas normalmente, incluindo `/api/whatsapp/send-media`.

## Commits

1. `79c0dab` — `fix(whatsapp): template picker coleta variáveis do corpo (corrige #132000)`
2. `1bb8a89` — `fix(whatsapp): ffmpeg copiado p/ tmp + chmod no Vercel + erro detalhado`

## Concerns

- Testado apenas com `tsc`/`build` local — não há teste automatizado end-to-end
  contra a Meta Cloud API real (envio de template com variáveis) nem contra o
  ambiente serverless do Vercel (permissão de execução do binário copiado).
  Recomenda-se validar em preview/produção antes de dar como definitivamente
  resolvido.
- Nenhum arquivo além dos dois foi tocado; sem símbolos órfãos (o `Input`/`Label`
  já existiam em `src/components/ui/`).
