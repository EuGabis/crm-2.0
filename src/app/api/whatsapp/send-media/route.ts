import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
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

  // lê o arquivo do nosso Storage com a chave de serviço: já autorizamos o usuário
  // e a conversa acima, então não faz sentido a leitura depender do token da sessão
  // (era o suspeito nº 1 do "Authentication Error" na hora de baixar a mídia).
  const admin = createAdminClient();
  const { data: blob, error: dlErr } = await admin.storage
    .from("conversation-media")
    .download(mediaPath);
  if (dlErr || !blob) {
    return Response.json(
      { error: "Mídia não encontrada: " + (dlErr?.message ?? "arquivo ausente") },
      { status: 400 },
    );
  }
  const bytes = await blob.arrayBuffer();
  const sendBytes = bytes;
  const sendMime = mime || blob.type || "application/octet-stream";

  let waResp: any;
  try {
    const ext = (String(sendMime || "application/octet-stream").split("/")[1] || "bin").split(";")[0];
    const mediaId = await uploadMedia(channel.phone_number_id, sendBytes, sendMime, `media.${ext}`);
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
