import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdvance } from "@/lib/whatsapp/status-rank";
import { maybeAutoReply } from "@/lib/whatsapp/auto-reply";
import { getMediaInfo, downloadMedia } from "@/lib/whatsapp/client";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Nunca cachear: cada chamada é um evento novo. */
export const dynamic = "force-dynamic";

/**
 * Webhook do WhatsApp (Meta Cloud API). Fora do matcher do proxy — chamada
 * máquina-a-máquina, sem sessão. GET faz o handshake da Meta; POST valida a
 * assinatura (HMAC do corpo cru com WHATSAPP_APP_SECRET) e grava nas Conversas
 * com a service role (aparece no inbox pelo Realtime já publicado).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const verify = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && verify && verify === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new Response(challenge ?? "", { status: 200 });
  }
  return new Response("forbidden", { status: 403 });
}

function validSignature(raw: string, header: string | null): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret || !header) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const raw = await request.text();
  if (!validSignature(raw, request.headers.get("x-hub-signature-256"))) {
    return new Response("assinatura inválida", { status: 401 });
  }

  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("payload inválido", { status: 400 });
  }

  let db;
  try {
    db = createAdminClient();
  } catch {
    return Response.json({ error: "webhook sem credenciais no servidor" }, { status: 503 });
  }

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (!phoneNumberId) continue;

      const { data: channel } = await db
        .from("whatsapp_channels")
        .select("id, location_id, daily_limit")
        .eq("phone_number_id", phoneNumberId)
        .maybeSingle();
      if (!channel) continue; // número não cadastrado aqui — ignora

      for (const m of value.messages ?? []) {
        try {
          await handleIncoming(db, channel, value, m);
        } catch {
          // best-effort: uma mensagem malformada/sem suporte nunca derruba o webhook.
        }
      }
      for (const st of value.statuses ?? []) {
        if (st?.id && st?.status) {
          try {
            await applyStatus(db, st);
          } catch {
            // best-effort: idem para status.
          }
        }
      }
    }
  }

  return Response.json({ ok: true });
}

async function handleIncoming(db: any, channel: any, value: any, m: any) {
  const waId = m.id;
  if (!waId) return;

  // idempotência: mesma mensagem chega mais de uma vez
  const { data: dup } = await db
    .from("messages")
    .select("id")
    .eq("wa_message_id", waId)
    .maybeSingle();
  if (dup) return;

  const phone: string = m.from ?? "";
  if (!phone) return;
  const profileName: string = value?.contacts?.[0]?.profile?.name || phone;
  const nowIso = new Date().toISOString();

  // contato por telefone dentro da empresa
  let { data: contact } = await db
    .from("contacts")
    .select("id")
    .eq("location_id", channel.location_id)
    .eq("phone", phone)
    .maybeSingle();
  if (!contact) {
    const parts = profileName.trim().split(/\s+/);
    const first = parts.shift() || phone;
    const { data: created } = await db
      .from("contacts")
      .insert({
        location_id: channel.location_id,
        first_name: first,
        last_name: parts.join(" "),
        phone,
        last_activity_channel: "whatsapp",
        last_activity_at: nowIso,
      })
      .select("id")
      .single();
    contact = created;
  }
  if (!contact) return;

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
      const path = `${channel.location_id}/${contact.id}/${crypto.randomUUID()}.${ext}`;
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

  // conversa de whatsapp desse contato
  let { data: conv } = await db
    .from("conversations")
    .select("id, unread_count")
    .eq("location_id", channel.location_id)
    .eq("contact_id", contact.id)
    .eq("channel", "whatsapp")
    .maybeSingle();
  if (!conv) {
    const { data: created } = await db
      .from("conversations")
      .insert({
        location_id: channel.location_id,
        contact_id: contact.id,
        channel: "whatsapp",
        channel_id: channel.id,
        unread_count: 1,
        last_message_at: nowIso,
        last_message_preview: body,
      })
      .select("id")
      .single();
    conv = created;
  } else {
    await db
      .from("conversations")
      .update({
        channel_id: channel.id,
        unread_count: (conv.unread_count ?? 0) + 1,
        last_message_at: nowIso,
        last_message_preview: body,
        // O cliente escreveu: a conversa volta para a caixa mesmo que alguém
        // tenha finalizado ou arquivado antes (0029). Perder mensagem de
        // cliente é pior do que desfazer um arquivamento.
        closed_at: null,
        closed_by: null,
        archived_at: null,
        archived_by: null,
      })
      .eq("id", conv.id);
  }
  if (!conv) return;

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
  if (insErr) {
    // corrida: entrega duplicada da Meta — o índice único barra o 2º insert.
    // Nesse caso NÃO responde de novo (evita auto-reply duplicado).
    if ((insErr as any).code !== "23505") throw insErr;
    return;
  }

  // Auto-responder: só para mensagens de texto de verdade, best-effort.
  if (m.text?.body) {
    await maybeAutoReply(db, {
      locationId: channel.location_id,
      conversationId: conv.id,
      channelId: channel.id,
      phoneNumberId: value?.metadata?.phone_number_id,
      toPhone: phone,
      dailyLimit: channel.daily_limit ?? 1000,
    });
  }
}

async function applyStatus(db: any, st: any) {
  const { data: msg } = await db
    .from("messages")
    .select("id, status")
    .eq("wa_message_id", st.id)
    .maybeSingle();
  if (!msg) return; // status de mensagem que não gravamos — ignora

  if (!isAdvance(msg.status, st.status)) return; // não rebaixa entregue/lido

  const patch: Record<string, unknown> = { status: st.status };
  const nowIso = st.timestamp
    ? new Date(Number(st.timestamp) * 1000).toISOString()
    : new Date().toISOString();
  if (st.status === "delivered") patch.delivered_at = nowIso;
  if (st.status === "read") patch.read_at = nowIso;
  if (st.status === "failed") {
    patch.failed_at = nowIso;
    patch.error_detail = st.errors?.[0]?.title || st.errors?.[0]?.message || "Falha na entrega";
  }
  await db.from("messages").update(patch).eq("id", msg.id);
}
