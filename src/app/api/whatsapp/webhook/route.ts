import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdvance } from "@/lib/whatsapp/status-rank";
import { maybeAutoReply } from "@/lib/whatsapp/auto-reply";
import { getMediaInfo, downloadMedia } from "@/lib/whatsapp/client";
import { maybeRunBot } from "@/lib/bot/engine";

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
        .select("id, location_id, daily_limit, phone_number_id, bot_flow")
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

  // contato por telefone dentro da empresa — busca NORMALIZADA (0047): casa
  // "(21) 99717-0842", "5521997170842", etc. como o mesmo número. Antes era `eq`
  // por texto exato, o que criava um contato novo a cada formato diferente.
  const { data: foundId } = await db.rpc("find_contact_by_phone", {
    p_location: channel.location_id,
    p_phone: phone,
  });
  let contact: { id: string } | null = foundId ? { id: foundId as string } : null;
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
  } else if (m.type === "interactive") {
    // Resposta de botão/lista do bot: o título escolhido vira o corpo (aparece no
    // inbox), e o `id` (button_reply/list_reply) será usado pelo motor do bot.
    const r = m.interactive?.button_reply ?? m.interactive?.list_reply;
    body = r?.title ?? "[resposta]";
  } else if (
    m.type === "image" ||
    m.type === "audio" ||
    m.type === "video" ||
    m.type === "document"
  ) {
    // Documento (PDF etc.) é guardado como `file` — o tipo `document` não existe
    // no CHECK de messages. Os demais mantêm o próprio tipo.
    const isDoc = m.type === "document";
    msgType = isDoc ? "file" : m.type;
    const node = m[m.type] ?? {};
    body = node.caption ?? "";
    try {
      const info = await getMediaInfo(node.id);
      const dl = await downloadMedia(info.url);
      const mime = dl.mime || info.mime || node.mime_type || "application/octet-stream";
      const ext = (mime.split("/")[1] || "bin").split(";")[0];
      const path = `${channel.location_id}/${contact.id}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await db.storage
        .from("conversation-media")
        .upload(path, new Uint8Array(dl.bytes), { contentType: mime, upsert: false });
      if (upErr) throw upErr;
      media.media_path = path;
      // Documento chega com o nome real do arquivo; mídia comum não tem nome útil.
      media.media_name = isDoc ? node.filename ?? `documento.${ext}` : `${m.type}.${ext}`;
      media.media_mime = mime;
      media.media_size = dl.bytes.byteLength;
    } catch {
      // Não conseguiu baixar/guardar — grava a mensagem com rótulo (nunca quebra o webhook).
      if (!body) body = `[${m.type}]`;
    }
  } else {
    body = `[${m.type ?? "mídia"}]`;
  }

  // Uma conversa por NÚMERO: casa contato + channel_id (o número que recebeu),
  // não uma conversa única por contato. Assim cada número tem seu próprio
  // histórico e o número da conversa nunca "migra".
  let { data: conv } = await db
    .from("conversations")
    .select("id, unread_count, closed_at, archived_at")
    .eq("location_id", channel.location_id)
    .eq("contact_id", contact.id)
    .eq("channel_id", channel.id)
    .maybeSingle();
  // Conversa fechada/arquivada + cliente escreveu de novo = reabrir E reiniciar o
  // agente do zero (nova sessão), sem precisar apagar a conversa.
  const wasClosed = !!(conv && (conv.closed_at || conv.archived_at));
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
        // channel_id NÃO é reescrito: a conversa já é a deste número e fica nele.
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
        // Reabriu do fechado: solta o bot para poder recomeçar.
        ...(wasClosed ? { bot_paused: false } : {}),
        // Reabriu do fechado E o número tem bot: o contato volta pra FILA — tira o
        // dono anterior pra o bot re-qualificar e redistribuir (pode ir pra outro).
        ...(wasClosed && channel.bot_flow ? { assigned_to: null } : {}),
      })
      .eq("id", conv.id);
  }
  if (!conv) return;

  // Reabriu uma conversa fechada: zera a sessão do agente para ele iniciar de novo.
  if (wasClosed) {
    await db.from("bot_sessions").delete().eq("conversation_id", conv.id);
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
  if (insErr) {
    // corrida: entrega duplicada da Meta — o índice único barra o 2º insert.
    // Nesse caso NÃO responde de novo (evita auto-reply duplicado).
    if ((insErr as any).code !== "23505") throw insErr;
    return;
  }

  // Bot conversacional primeiro (fluxo com passos/botões). Se ele não tratar a
  // mensagem, cai no auto-responder de IA single-turn. Best-effort.
  const replyId =
    m.interactive?.list_reply?.id ?? m.interactive?.button_reply?.id ?? null;
  const botHandled = await maybeRunBot(db, {
    channel: {
      id: channel.id,
      phone_number_id: channel.phone_number_id,
      location_id: channel.location_id,
      bot_flow: channel.bot_flow ?? null,
    },
    conversationId: conv.id,
    contact: { id: contact.id, phone },
    text: body,
    replyId,
  }).catch(() => false);

  if (!botHandled && m.text?.body) {
    await maybeAutoReply(db, {
      locationId: channel.location_id,
      conversationId: conv.id,
      channelId: channel.id,
      phoneNumberId: channel.phone_number_id,
      toPhone: phone,
      dailyLimit: channel.daily_limit ?? 1000,
    });
  }
}

async function applyStatus(db: any, st: any) {
  const { data: msg } = await db
    .from("messages")
    .select("id, status, delivered_at")
    .eq("wa_message_id", st.id)
    .maybeSingle();
  if (!msg) return; // status de mensagem que não gravamos — ignora
  if (!isAdvance(msg.status, st.status)) return; // não rebaixa entregue/lido

  const patch: Record<string, unknown> = { status: st.status };
  const nowIso = st.timestamp
    ? new Date(Number(st.timestamp) * 1000).toISOString()
    : new Date().toISOString();
  if (st.status === "delivered") patch.delivered_at = nowIso;
  if (st.status === "read") {
    patch.read_at = nowIso;
    // "Lido" implica "entregue": a Meta às vezes pula o evento de entrega e manda
    // só o read. Sem isto, a coluna Entregue ficaria "—" numa mensagem já lida.
    if (!msg.delivered_at) patch.delivered_at = nowIso;
  }
  if (st.status === "failed") {
    patch.failed_at = nowIso;
    patch.error_detail = st.errors?.[0]?.title || st.errors?.[0]?.message || "Falha na entrega";
  }
  await db.from("messages").update(patch).eq("id", msg.id);
}
