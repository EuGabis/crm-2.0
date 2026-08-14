# WhatsApp — Mídia real — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mídia real no WhatsApp: mensagem de imagem/áudio/vídeo recebida é baixada da Meta e mostrada no inbox (hoje só grava `[image]`); mídia enviada (anexo ou áudio gravado) vai de verdade pro cliente pela Cloud API; player de vídeo no thread.

**Architecture:** Helpers de mídia no client do WhatsApp (baixar/subir/enviar). O webhook baixa a mídia recebida (service role) e grava com `media_path`. Uma rota `/api/whatsapp/send-media` sobe a mídia (já no nosso Storage) pra Cloud API e envia. O composer, em conversa WhatsApp, empurra a mídia pela rota após o `sendMedia` local. Thread ganha `<video>`.

**Tech Stack:** Next.js (App Router) · TypeScript · Supabase Storage (bucket `conversation-media`, migração 0019 já aplicada) · WhatsApp Cloud API.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-14-whatsapp-midia-design.md`. Convenções: `AGENTS.md` (alta colisão em `AGENTS.md` — edição só ADITIVA).
- **Sem migração nova** (0019 já tem `messages.media_path/name/mime/size` + bucket privado `conversation-media` + políticas). **Sem env nova** (`WHATSAPP_TOKEN` já existe).
- **Sem runner de testes:** verificação = `npx tsc --noEmit` **e** `npm run build` limpos (do repo `C:\Users\Gabriel\Documents\crm 2.0`, NÃO worktree).
- **Best-effort no webhook:** baixar mídia NUNCA pode quebrar o 200 nem lançar — try/catch; se falhar, grava a mensagem com body `[<tipo>]` sem `media_path`.
- **Segredos server-only:** `WHATSAPP_TOKEN` só no servidor (client do WhatsApp + rota + webhook). Bucket privado (URLs assinadas). Rota autenticada (`getUser` + RLS); webhook valida HMAC (não mexer).
- **Interfaces existentes reusadas:**
  - `graph`, `BASE`, `token` (module-level em `src/lib/whatsapp/client.ts`) — os helpers novos vão no MESMO arquivo pra reusar.
  - `createAdminClient()` (service role) de `@/lib/supabase/admin` — já usado no webhook; tem `.storage`.
  - `conversationActions.sendMedia(conversationId, { file, kind, channel, duration? })` de `db/conversations.ts` — hoje sobe no Storage + grava a mensagem; bucket `MEDIA_BUCKET = "conversation-media"`.
  - Composer `src/components/inbox/composer.tsx`: `isWhatsapp`, handlers de anexo (linha ~90) e de áudio (linha ~118), ambos chamam `sendMedia`.
  - Thread `src/components/inbox/thread.tsx`: renderiza imagem (`<img>`) e áudio (`<audio>`) via `useMediaUrl`. Falta vídeo.
- **Kinds:** `image | audio | video` (mídia WhatsApp) + `file` (documento, só local na v1). WhatsApp só recebe/envia image/audio/video.
- **Texto pt-BR.** Commits `feat(whatsapp): ...`. Branch → PR → squash na `main`.

---

## Task 1: Helpers de mídia no client do WhatsApp

Baixar/subir/enviar mídia pela Cloud API. Deliverable: exports novos + build limpo.

**Files:**
- Modify: `src/lib/whatsapp/client.ts`

**Interfaces:**
- Produces:
  - `getMediaInfo(mediaId: string): Promise<{ url: string; mime: string; size: number }>`
  - `downloadMedia(url: string): Promise<{ bytes: ArrayBuffer; mime: string }>`
  - `uploadMedia(phoneNumberId: string, bytes: ArrayBuffer, mime: string, filename: string): Promise<string>` (retorna media id)
  - `sendMediaMessage(phoneNumberId: string, to: string, kind: "image"|"audio"|"video", mediaId: string, caption?: string): Promise<any>`

- [ ] **Step 1: Adicionar os helpers**

Em `src/lib/whatsapp/client.ts`, adicionar ao final (reusando `graph`, `BASE`, `token` já definidos no arquivo):

```ts
/** Metadados da mídia recebida: a Meta entrega só o ID; isto devolve a URL temporária. */
export async function getMediaInfo(
  mediaId: string,
): Promise<{ url: string; mime: string; size: number }> {
  const json = await graph(`${mediaId}`, { method: "GET" });
  return { url: json.url, mime: json.mime_type ?? "", size: json.file_size ?? 0 };
}

/** Baixa o binário da mídia (a URL da Meta exige o Bearer). */
export async function downloadMedia(url: string): Promise<{ bytes: ArrayBuffer; mime: string }> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token()}` } });
  if (!res.ok) throw new Error(`Falha ao baixar mídia (${res.status})`);
  return {
    bytes: await res.arrayBuffer(),
    mime: res.headers.get("content-type") || "application/octet-stream",
  };
}

/** Sobe um binário para a Cloud API e devolve o media id para enviar. */
export async function uploadMedia(
  phoneNumberId: string,
  bytes: ArrayBuffer,
  mime: string,
  filename: string,
): Promise<string> {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", mime);
  form.append("file", new Blob([bytes], { type: mime }), filename);
  const res = await fetch(`${BASE}/${phoneNumberId}/media`, {
    method: "POST",
    // NÃO setar Content-Type: o FormData define o boundary sozinho.
    headers: { Authorization: `Bearer ${token()}` },
    body: form,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message || `Upload de mídia falhou (${res.status})`);
  return json.id as string;
}

export function sendMediaMessage(
  phoneNumberId: string,
  to: string,
  kind: "image" | "audio" | "video",
  mediaId: string,
  caption?: string,
) {
  const media: Record<string, unknown> = { id: mediaId };
  if (caption && kind !== "audio") media.caption = caption; // áudio não leva caption
  return graph(`${phoneNumberId}/messages`, {
    method: "POST",
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: kind, [kind]: media }),
  });
}
```

- [ ] **Step 2: Verificar build**

Run: `npx tsc --noEmit && npm run build`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add src/lib/whatsapp/client.ts
git commit -m "feat(whatsapp): helpers de mídia da Cloud API (get/download/upload/send)"
```

---

## Task 2: Webhook baixa a mídia recebida

Imagem/áudio/vídeo que chega vira arquivo no Storage + mensagem com `media_path`. Deliverable: build limpo; best-effort.

**Files:**
- Modify: `src/app/api/whatsapp/webhook/route.ts`

**Interfaces:**
- Consumes: `getMediaInfo`, `downloadMedia` de `@/lib/whatsapp/client` (Task 1).

- [ ] **Step 1: Import**

No topo de `src/app/api/whatsapp/webhook/route.ts`, adicionar:
```ts
import { getMediaInfo, downloadMedia } from "@/lib/whatsapp/client";
```

- [ ] **Step 2: Resolver conteúdo (texto ou mídia) em `handleIncoming`**

Hoje `handleIncoming` monta `const text: string = m.text?.body ?? \`[${m.type ?? "mídia"}]\`;` e insere com `type: "text", body: text`. Substituir esse trecho (do cálculo de `text` até o objeto do insert) por uma resolução que baixa mídia:

```ts
  // Resolve o conteúdo: texto, ou mídia (imagem/áudio/vídeo) baixada da Meta.
  let msgType = "text";
  let body = "";
  const media: {
    media_path?: string;
    media_name?: string;
    media_mime?: string;
    media_size?: number;
  } = {};

  if (m.type === "text") {
    body = m.text?.body ?? "";
  } else if (m.type === "image" || m.type === "audio" || m.type === "video") {
    msgType = m.type;
    const node = m[m.type] ?? {};
    body = node.caption ?? "";
    try {
      const info = await getMediaInfo(node.id);
      const dl = await downloadMedia(info.url);
      const mime = dl.mime || info.mime || "application/octet-stream";
      const ext = (mime.split("/")[1] || "bin").split(";")[0];
      const path = `${channel.location_id}/${conv.id}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await db.storage
        .from("conversation-media")
        .upload(path, new Uint8Array(dl.bytes), { contentType: mime, upsert: false });
      if (upErr) throw upErr;
      media.media_path = path;
      media.media_name = `${m.type}.${ext}`;
      media.media_mime = mime;
      media.media_size = dl.bytes.byteLength;
    } catch {
      // Não conseguiu baixar/guardar — grava a mensagem com rótulo (nunca quebra o webhook).
      if (!body) body = `[${m.type}]`;
    }
  } else {
    body = `[${m.type ?? "mídia"}]`;
  }

  const { error: insErr } = await db.from("messages").insert({
    location_id: channel.location_id,
    conversation_id: conv.id,
    direction: "in",
    type: msgType,
    channel: "whatsapp",
    body,
    channel_id: channel.id,
    wa_message_id: waId,
    status: "delivered",
    ...media,
  });
```

Manter o restante (guarda de corrida `23505` e o `maybeAutoReply` só quando `m.text?.body`) exatamente como está — a auto-resposta continua só para texto.

⚠️ Confirmar que a atualização da conversa (preview) logo acima ainda faz sentido: se ela usa `text`, trocar por `body`. Ler o arquivo e ajustar referências ao antigo `text` para `body`.

- [ ] **Step 3: Verificar build**

Run: `npx tsc --noEmit && npm run build`
Expected: sem erros; rota `/api/whatsapp/webhook` no manifesto.

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/whatsapp/webhook/route.ts"
git commit -m "feat(whatsapp): webhook baixa mídia recebida (imagem/áudio/vídeo) e grava no Storage"
```

---

## Task 3: Rota `/api/whatsapp/send-media`

Empurra a mídia (já no nosso Storage) pra Cloud API. Deliverable: build limpo; sem sessão → 401.

**Files:**
- Create: `src/app/api/whatsapp/send-media/route.ts`

**Interfaces:**
- Consumes: `uploadMedia`, `sendMediaMessage` de `@/lib/whatsapp/client`; `createClient` de `@/lib/supabase/server`.
- Produces (HTTP): `POST` body `{ conversationId, channelId?, messageId, mediaPath, mime, kind: "image"|"audio"|"video", caption? }` → `200 { ok, waMessageId }` | 401 | 400 | 404 | 409 (janela 24h) | 429 (limite) | 502.

- [ ] **Step 1: Escrever a rota** (espelha `send/route.ts`)

Create `src/app/api/whatsapp/send-media/route.ts`:

```ts
import { createClient } from "@/lib/supabase/server";
import { uploadMedia, sendMediaMessage } from "@/lib/whatsapp/client";

/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = "force-dynamic";
const DAY_MS = 24 * 60 * 60 * 1000;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Não autenticado" }, { status: 401 });

  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "payload inválido" }, { status: 400 });
  }
  const { conversationId, channelId, messageId, mediaPath, mime, caption } = body ?? {};
  const kind = body?.kind as "image" | "audio" | "video";
  if (!conversationId || !messageId || !mediaPath || !["image", "audio", "video"].includes(kind)) {
    return Response.json({ error: "parâmetros ausentes" }, { status: 400 });
  }

  const { data: conv } = await supabase
    .from("conversations")
    .select("id, contact_id, location_id, channel_id")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conv) return Response.json({ error: "Conversa não encontrada" }, { status: 404 });

  const { data: channel } = await supabase
    .from("whatsapp_channels")
    .select("*")
    .eq("id", channelId ?? conv.channel_id)
    .maybeSingle();
  if (!channel || !channel.active) {
    return Response.json({ error: "Canal inválido ou inativo" }, { status: 400 });
  }

  const { data: contact } = await supabase
    .from("contacts")
    .select("phone")
    .eq("id", conv.contact_id)
    .maybeSingle();
  const to = (contact?.phone ?? "").replace(/\D/g, "");
  if (!to) return Response.json({ error: "Contato sem telefone" }, { status: 400 });

  // limite diário
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const { count } = await supabase
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("channel_id", channel.id)
    .eq("direction", "out")
    .gte("created_at", startOfDay.toISOString());
  if ((count ?? 0) >= channel.daily_limit) {
    return Response.json({ error: "Limite diário do canal atingido" }, { status: 429 });
  }

  // janela de 24h (mídia é texto livre — precisa da janela aberta)
  const { data: lastIn } = await supabase
    .from("messages")
    .select("created_at")
    .eq("conversation_id", conversationId)
    .eq("direction", "in")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const within24h = !!lastIn && Date.now() - new Date(lastIn.created_at).getTime() < DAY_MS;
  if (!within24h) {
    return Response.json(
      { error: "Janela de 24h fechada — só dá para enviar template", needsTemplate: true },
      { status: 409 },
    );
  }

  // lê o arquivo do nosso Storage (RLS: membro lê a pasta da própria empresa)
  const { data: blob, error: dlErr } = await supabase.storage
    .from("conversation-media")
    .download(mediaPath);
  if (dlErr || !blob) return Response.json({ error: "Mídia não encontrada" }, { status: 400 });
  const bytes = await blob.arrayBuffer();

  let waResp: any;
  try {
    const ext = (String(mime || "application/octet-stream").split("/")[1] || "bin").split(";")[0];
    const mediaId = await uploadMedia(channel.phone_number_id, bytes, mime || blob.type, `media.${ext}`);
    waResp = await sendMediaMessage(channel.phone_number_id, to, kind, mediaId, caption);
  } catch (e) {
    await supabase.from("messages").update({ status: "failed" }).eq("id", messageId);
    return Response.json(
      { error: e instanceof Error ? e.message : "Falha na Cloud API" },
      { status: 502 },
    );
  }

  const waMessageId = waResp?.messages?.[0]?.id ?? null;
  await supabase
    .from("messages")
    .update({ wa_message_id: waMessageId, status: "sent" })
    .eq("id", messageId);

  return Response.json({ ok: true, waMessageId });
}
```

- [ ] **Step 2: Verificar build**

Run: `npx tsc --noEmit && npm run build`
Expected: sem erros; rota `/api/whatsapp/send-media` no manifesto.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/whatsapp/send-media/route.ts"
git commit -m "feat(whatsapp): rota send-media (sobe pra Cloud API e envia)"
```

---

## Task 4: Repo + composer empurram a mídia pro WhatsApp

`sendMedia` devolve os ids e aceita "video"; o composer, em conversa WhatsApp, empurra pela rota; áudio grava em ogg/opus. Deliverable: build limpo.

**Files:**
- Modify: `src/lib/data/repos/db/conversations.ts`
- Modify: `src/lib/data/repos/db/whatsapp.ts`
- Modify: `src/components/inbox/composer.tsx`

**Interfaces:**
- Produces: `conversationActions.sendMedia(...)` passa a retornar `{ ok, error?, messageId?, mediaPath?, mime? }` e aceitar `kind: "image"|"file"|"audio"|"video"`; `whatsappActions.sendMedia({ conversationId, channelId, messageId, mediaPath, mime, kind, caption? }): Promise<{ ok, error? }>`.

- [ ] **Step 1: `conversations.ts` — kind "video" + retorno com ids**

Em `conversationActions.sendMedia`:
- Trocar o tipo `kind: "image" | "file" | "audio"` por `kind: "image" | "file" | "audio" | "video"` (na assinatura e onde derivar o preview: `kind === "video"` → `"🎬 Vídeo"`).
- No `return { ok: true }` final, incluir os ids: `return { ok: true, messageId: data.id, mediaPath: path, mime: file.type || undefined };`. E o tipo de retorno vira `Promise<{ ok: boolean; error?: string; messageId?: string; mediaPath?: string; mime?: string }>`.

- [ ] **Step 2: `whatsapp.ts` — ação `sendMedia` (chama a rota)**

Em `whatsappActions` (`src/lib/data/repos/db/whatsapp.ts`), adicionar:
```ts
  async sendMedia(args: {
    conversationId: string;
    channelId?: string;
    messageId: string;
    mediaPath: string;
    mime?: string;
    kind: "image" | "audio" | "video";
    caption?: string;
  }): Promise<{ ok: boolean; needsTemplate?: boolean; error?: string }> {
    const res = await fetch("/api/whatsapp/send-media", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, needsTemplate: json?.needsTemplate, error: json?.error };
    return { ok: true };
  },
```

- [ ] **Step 3: `composer.tsx` — aceitar vídeo, gravar ogg/opus, empurrar pro WhatsApp**

No composer:
- **Anexo** (handler do input de arquivo, ~linha 90): aceitar vídeo. Onde hoje calcula `kind = isImg ? "image" : "file"`, passar a considerar vídeo:
  ```ts
  const isImg = file.type.startsWith("image/");
  const isVideo = file.type.startsWith("video/");
  const kind = isImg ? "image" : isVideo ? "video" : "file";
  ```
  E incluir vídeo no `accept` do input (adicionar `video/mp4,video/3gpp` ao attribute existente) e no texto/validação (aceitar imagem, vídeo, PDF ou DOCX).
- **Áudio** (handler de gravação, ~linha 118-136): preferir `audio/ogg;codecs=opus` (aceito pelo WhatsApp) quando suportado:
  ```ts
  const mimeType =
    typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")
      ? "audio/ogg;codecs=opus"
      : "audio/webm";
  const recorder = new MediaRecorder(stream, { mimeType });
  ```
  e ao montar o `File`, usar a extensão coerente (`.ogg` ou `.webm`) e `type: mimeType`.
- **Empurrar pro WhatsApp:** após `const res = await conversationActions.sendMedia(...)` (tanto no anexo quanto no áudio), se `res.ok` e a conversa é WhatsApp e o `kind` é image/audio/video, empurrar pela Cloud API:
  ```ts
  if (res.ok && isWhatsapp && res.messageId && res.mediaPath && (kind === "image" || kind === "audio" || kind === "video")) {
    const wa = await whatsappActions.sendMedia({
      conversationId,
      channelId: conversation?.channelId,
      messageId: res.messageId,
      mediaPath: res.mediaPath,
      mime: res.mime,
      kind,
    });
    if (!wa.ok) {
      toast.error(
        wa.needsTemplate
          ? "Janela de 24h fechada — envie um template antes."
          : wa.error ?? "A mídia ficou no inbox, mas falhou ao enviar no WhatsApp.",
      );
    }
  }
  ```
  (importar `whatsappActions` no composer se ainda não estiver.)

- [ ] **Step 4: Verificar build**

Run: `npx tsc --noEmit && npm run build`
Expected: sem erros, sem símbolo não usado.

- [ ] **Step 5: Commit**

```bash
git add src/lib/data/repos/db/conversations.ts src/lib/data/repos/db/whatsapp.ts src/components/inbox/composer.tsx
git commit -m "feat(whatsapp): envia mídia (imagem/áudio/vídeo) pela Cloud API a partir do composer"
```

---

## Task 5: Player de vídeo no thread + docs

Thread mostra vídeo; documenta. Deliverable: build limpo.

**Files:**
- Modify: `src/components/inbox/thread.tsx`
- Modify: `AGENTS.md`

- [ ] **Step 1: Vídeo no thread**

Em `src/components/inbox/thread.tsx`, no componente que renderiza mídia (o `MediaContent`, que hoje trata image/audio/file via `useMediaUrl(message.mediaPath)`), adicionar o caso vídeo: quando `message.type === "video"` (ou `message.mediaMime?.startsWith("video/")`), renderizar:
```tsx
// eslint-disable-next-line jsx-a11y/media-has-caption
<video src={url ?? undefined} controls className="max-h-72 w-full rounded-lg" />
```
(Usar o mesmo `url` assinado do `useMediaUrl`. Abrir o arquivo real pra ver a estrutura do `MediaContent` e encaixar o caso vídeo junto de image/audio, mantendo o placeholder de carregamento.)

- [ ] **Step 2: Verificar build**

Run: `npx tsc --noEmit && npm run build`
Expected: sem erros.

- [ ] **Step 3: Doc no AGENTS.md (ADITIVA)**

Rodar `ls supabase/migrations/` (não criamos migração — 0019 já cobre). Em `AGENTS.md`, na seção WhatsApp, adicionar um parágrafo curto: mídia real (imagem/áudio/vídeo) — helpers em `lib/whatsapp/client.ts` (get/download/upload/sendMediaMessage); webhook baixa a mídia recebida para o bucket `conversation-media` e grava `media_path`; envio pela rota `/api/whatsapp/send-media` acionada pelo composer após o `sendMedia` local; thread renderiza imagem/áudio/vídeo por URL assinada. Áudio gravado prefere `ogg/opus` (WhatsApp não aceita webm). Sem migração/env nova.

- [ ] **Step 4: Commit**

```bash
git add src/components/inbox/thread.tsx AGENTS.md
git commit -m "feat(whatsapp): player de vídeo no thread + doc da mídia"
```

---

## Handoff (Gabriel — fora do código)

1. Nada de migração (0019 já aplicada). `WHATSAPP_TOKEN` válido na Vercel (o token permanente que você regenerar) + forma de pagamento na WABA Lito CRM — pré-requisitos para o ENVIO funcionar.
2. Merge → deploy. Receber uma foto/áudio/vídeo no número → aparece no inbox; enviar anexo/áudio → chega no WhatsApp do cliente.

## Self-Review (autor do plano)

- **Cobertura da spec:** helpers → Task 1; receber (webhook baixa) → Task 2; enviar (rota) → Task 3; composer/repo empurram + vídeo aceito + áudio ogg → Task 4; player de vídeo + docs → Task 5. Não-objetivos (documentos via WhatsApp, transcodificação, stickers) fora. ✓
- **Consistência de tipos:** `getMediaInfo/downloadMedia` (Task 1) usados no webhook (Task 2); `uploadMedia/sendMediaMessage` (Task 1) na rota (Task 3); `sendMedia` retorna `{messageId, mediaPath, mime}` (Task 4 conversations) consumido no composer (Task 4) que chama `whatsappActions.sendMedia` → `/api/whatsapp/send-media` (Task 3). `kind` alinhado (image/audio/video na Cloud API; +file/video no repo/composer). ✓
- **Sem placeholders:** código real em cada passo; verificação por tsc/build. ✓
- **Best-effort/segurança:** webhook em try/catch (fallback `[tipo]`); bucket privado + URLs assinadas; rota autenticada + 24h + daily_limit; token só no servidor. ✓
- **Ponto de atenção:** áudio `webm` (navegadores sem ogg/opus) pode falhar no WhatsApp — tratado com toast; a mensagem fica no inbox (nós tocamos webm). Mensagens `[image]` antigas NÃO retroagem (mídia não foi baixada no recebimento).
