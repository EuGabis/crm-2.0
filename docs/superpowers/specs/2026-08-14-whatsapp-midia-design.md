# WhatsApp — Mídia real (imagem/áudio/vídeo: enviar, receber, ver) — Design Spec

> Liga a mídia do inbox à Cloud API do WhatsApp: mensagem de mídia recebida é **baixada**
> da Meta e mostrada; mídia enviada (anexo ou áudio gravado) vai **de verdade** pro cliente
> pela Cloud API. Data: 2026-08-14. Convenções: `AGENTS.md`. Depende de: WhatsApp conectado,
> Storage `conversation-media` (migração `0019`, já existe).

## Objetivo

Hoje o inbox já tem a UI: o composer anexa arquivo e **grava áudio**, e o thread renderiza
imagem/áudio via URL assinada (`useMediaUrl`). Mas: (1) a mídia enviada só é gravada no nosso
Storage/DB — **não** vai pro WhatsApp do cliente; (2) a mídia **recebida** só grava `[mídia]`
(não baixa). Esta spec fecha os dois lados + adiciona player de vídeo.

## Decisões aprovadas (Gabriel, 2026-08-14)

1. **Tipos:** imagem, áudio e vídeo (documentos ficam fora da v1).
2. **Enviar áudio:** anexar arquivo **e** gravar voice note no navegador (já existe no composer).

## Não-objetivos (v1)

- Documentos (PDF/DOCX) via WhatsApp — o composer aceita, mas o envio WhatsApp só cobre
  imagem/áudio/vídeo (doc segue local/inbox como hoje).
- Stickers, localização, contatos, reações.
- Transcodificação/compressão no servidor — sobe como está (respeitando limites da Meta).
- Thumbnails próprias — usa o player nativo do navegador.

## Estado atual (o que já existe — não refazer)

- Composer (`src/components/inbox/composer.tsx`): anexo (imagem/PDF/DOCX) e gravação de áudio
  (MediaRecorder → `audio/webm`), chamando `conversationActions.sendMedia` no ato.
- `conversationActions.sendMedia` (`db/conversations.ts`): sobe pro bucket `conversation-media`
  em `{location_id}/{conversation_id}/{uuid}.{ext}` e grava a mensagem (`media_path/name/mime/size`).
- Thread (`src/components/inbox/thread.tsx`): renderiza imagem (`<img>`) e áudio (`<audio>`) por
  URL assinada. **Falta vídeo.**
- Colunas `messages.media_*` + bucket privado + políticas: migração `0019` (aplicada).

## Arquitetura (o que falta)

```
RECEBER (webhook): m.type image|audio|video
  → getMediaInfo(mediaId) [GET /{media-id}] → downloadMedia(url) [GET url, Bearer]
  → sobe no conversation-media (service role) → grava messages(type, media_path/mime/size, body=caption)
  (best-effort: se baixar falhar, grava a mensagem com placeholder e segue)

ENVIAR (composer, conversa WhatsApp):
  conversationActions.sendMedia → sobe no Storage + grava a mensagem (como hoje) e RETORNA {messageId, mediaPath}
  → se WhatsApp: whatsappActions.sendMedia({conversationId, channelId, messageId, mediaPath, mime, kind})
     → POST /api/whatsapp/send-media (autenticada): lê o arquivo do Storage → uploadMedia [POST /{pnid}/media]
       → sendMediaMessage [POST /messages type=image|audio|video {id, caption?}] → atualiza a mensagem (wa_message_id, status='sent')

VER: thread já mostra imagem/áudio; adicionar <video> para type=video.
```

## Cloud API (helpers novos em `src/lib/whatsapp/client.ts`)

- `getMediaInfo(mediaId)` → `GET {v}/{media-id}` (Bearer) → `{ url, mime_type, file_size }`.
- `downloadMedia(url)` → `GET url` (Bearer) → `ArrayBuffer` (a URL da Meta exige o token).
- `uploadMedia(phoneNumberId, bytes, mime, filename)` → `POST {v}/{pnid}/media` multipart
  (`messaging_product=whatsapp`, `type=mime`, `file`) → `{ id }`.
- `sendMediaMessage(phoneNumberId, to, kind, mediaId, caption?)` → `POST {v}/{pnid}/messages`
  `{ messaging_product, to, type: kind, [kind]: { id, caption? } }`. (áudio não leva caption.)

Limites (validar antes de enviar): imagem ≤5MB, áudio ≤16MB, vídeo ≤16MB. Mimes aceitos WhatsApp
(ex.: image/jpeg|png|webp; audio/aac|mp4|mpeg|amr|ogg (opus); video/mp4|3gp). `audio/webm` do
MediaRecorder **não** é aceito pelo WhatsApp → ver "Áudio" abaixo.

## Áudio gravado (ponto de atenção)

O MediaRecorder grava `audio/webm;codecs=opus`, que o WhatsApp **não** aceita. Opções v1:
- Preferir gravar em `audio/ogg;codecs=opus` quando o navegador suportar
  (`MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")`) — o WhatsApp aceita OGG/Opus.
- Se só houver `audio/webm`, enviar assim mesmo pode falhar no WhatsApp; nesse caso a mensagem
  fica no inbox (nós tocamos webm) e o envio ao WhatsApp retorna erro tratado (toast "formato de
  áudio não suportado pelo WhatsApp neste navegador"). Sem transcodificação server-side na v1.

## Rota `POST /api/whatsapp/send-media`

Autenticada (`getUser` + RLS). Body `{ conversationId, channelId, messageId, mediaPath, mime, kind: "image"|"audio"|"video", caption? }`.
- Valida sessão/canal/contato (como `/api/whatsapp/send`); janela de 24h e `daily_limit`.
- Baixa o arquivo do `conversation-media` (path) — client de sessão (RLS) ou admin.
- `uploadMedia(channel.phone_number_id, bytes, mime, ...)` → `sendMediaMessage(..., kind, id, caption)`.
- `update messages set wa_message_id, status='sent' where id = messageId` + atualiza a conversa (preview "📷/🎤/🎬").
- Erros: 24h fechada → 409; canal inválido → 400; falha Cloud API → 502 (a mensagem já está no inbox,
  só marca falha).

## Webhook (receber mídia)

Em `handleIncoming`, quando `m.type` ∈ {image, audio, video}:
- `mediaId = m[type].id`, `caption = m[type].caption ?? ""`, `mime = m[type].mime_type`.
- `getMediaInfo` → `downloadMedia` → sobe no `conversation-media` em `{location_id}/{conversation_id}/{uuid}.{ext}`
  (service role; ext derivada do mime).
- grava `messages(type=<image|audio|video>, body=caption, media_path/mime/size, ...)`.
- best-effort: se algo falhar no download/upload, grava a mensagem com `body="[<type>]"` sem media_path
  (o inbox mostra o texto) — nunca quebra o 200 do webhook. O auto-responder só dispara p/ texto (mantém).

## UI

- Thread: adicionar `type === "video"` → `<video controls src={signedUrl}>` (usa o mesmo `useMediaUrl`).
- Composer: para conversa WhatsApp, após `sendMedia` (que já sobe/grava), chamar
  `whatsappActions.sendMedia(...)`; toast de sucesso/erro. (O anexo já aparece no inbox pelo insert local.)

## Segurança

- Bucket `conversation-media` **privado** (URLs assinadas, expiração 1h) — nada público.
- `WHATSAPP_TOKEN` só no servidor (webhook + rota). Rota autenticada + RLS; webhook valida HMAC.
- Validação de tipo/tamanho no cliente e no servidor antes de mandar pra Meta.

## Testes / verificação

- Sem runner → gate `npx tsc --noEmit` + `npm run build`.
- Manual (WhatsApp conectado): (a) receber uma foto/áudio/vídeo no 3408 → aparece no inbox e toca/abre;
  (b) enviar imagem (anexo) e áudio (gravado) pela conversa → chega no WhatsApp do cliente e aparece no inbox.

## Ordem de dependência

Sem migração nova (0019 já tem tudo). `WHATSAPP_TOKEN` já na Vercel. Sem env nova.
