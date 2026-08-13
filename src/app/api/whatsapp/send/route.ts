import { createClient } from "@/lib/supabase/server";
import { sendText, sendTemplate } from "@/lib/whatsapp/client";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Envia mensagem de WhatsApp pela Cloud API. Autenticada (getUser + a RLS
 * garante que o usuário é membro da empresa da conversa). Dentro da janela de
 * 24h manda texto livre; fora, exige template aprovado. Respeita o limite
 * diário do canal e grava a mensagem de saída.
 */
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
  const { conversationId, channelId, text, template } = body ?? {};
  if (!conversationId) return Response.json({ error: "conversationId ausente" }, { status: 400 });

  // conversa (RLS filtra por membership)
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
    return Response.json({ error: "Canal de WhatsApp inválido ou inativo" }, { status: 400 });
  }

  const { data: contact } = await supabase
    .from("contacts")
    .select("phone")
    .eq("id", conv.contact_id)
    .maybeSingle();
  const to = (contact?.phone ?? "").replace(/\D/g, "");
  if (!to) return Response.json({ error: "Contato sem telefone" }, { status: 400 });

  // limite diário (conta saídas do canal hoje)
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

  // janela de 24h = última mensagem de entrada
  const { data: lastIn } = await supabase
    .from("messages")
    .select("created_at")
    .eq("conversation_id", conversationId)
    .eq("direction", "in")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const within24h =
    !!lastIn && Date.now() - new Date(lastIn.created_at).getTime() < DAY_MS;

  let waResp: any;
  let bodyText: string;
  try {
    if (template) {
      waResp = await sendTemplate(
        channel.phone_number_id,
        to,
        template.name,
        template.language,
        template.components,
      );
      bodyText = `[template: ${template.name}]`;
    } else {
      if (!within24h) {
        return Response.json(
          { error: "Janela de 24h fechada — envie um template", needsTemplate: true },
          { status: 409 },
        );
      }
      if (!text?.trim()) return Response.json({ error: "Mensagem vazia" }, { status: 400 });
      waResp = await sendText(channel.phone_number_id, to, text.trim());
      bodyText = text.trim();
    }
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Falha na Cloud API" },
      { status: 502 },
    );
  }

  const waMessageId = waResp?.messages?.[0]?.id ?? null;
  const { data: msg, error: insErr } = await supabase
    .from("messages")
    .insert({
      location_id: conv.location_id,
      conversation_id: conversationId,
      direction: "out",
      type: "text",
      channel: "whatsapp",
      body: bodyText,
      channel_id: channel.id,
      wa_message_id: waMessageId,
      status: "sent",
      template_name: template ? template.name : null,
    })
    .select()
    .single();
  if (insErr || !msg) {
    return Response.json({ error: "Enviado, mas falhou ao gravar a mensagem" }, { status: 500 });
  }

  await supabase
    .from("conversations")
    .update({
      last_message_at: msg.created_at,
      last_message_preview: bodyText,
      sla_days: 0,
      bot_paused: true,
    })
    .eq("id", conversationId);

  return Response.json({ ok: true, id: msg.id, waMessageId });
}
