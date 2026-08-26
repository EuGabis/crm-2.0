import { createClient } from "@/lib/supabase/server";
import { sendText, sendTemplate } from "@/lib/whatsapp/client";
import { toWhatsAppNumber } from "@/lib/whatsapp/phone";

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
  const { conversationId, channelId, text, template, replyTo } = body ?? {};
  if (!conversationId) return Response.json({ error: "conversationId ausente" }, { status: 400 });

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  // Leituras independentes em PARALELO (antes eram ~7 em sequência, cada uma um
  // round-trip somando latência ao Enviar): perfil (nome do remetente), conversa,
  // última entrada (janela 24h), mensagem citada e — se veio no payload — o canal.
  const [profRes, convRes, lastInRes, replyRes, channelParamRes] = await Promise.all([
    supabase.from("profiles").select("name").eq("id", user.id).maybeSingle(),
    supabase
      .from("conversations")
      .select("id, contact_id, location_id, channel_id")
      .eq("id", conversationId)
      .maybeSingle(),
    supabase
      .from("messages")
      .select("created_at")
      .eq("conversation_id", conversationId)
      .eq("direction", "in")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    replyTo
      ? supabase.from("messages").select("id, wa_message_id").eq("id", replyTo).maybeSingle()
      : Promise.resolve({ data: null } as any),
    channelId
      ? supabase.from("whatsapp_channels").select("*").eq("id", channelId).maybeSingle()
      : Promise.resolve({ data: null } as any),
  ]);

  const conv = convRes.data;
  if (!conv) return Response.json({ error: "Conversa não encontrada" }, { status: 404 });
  const senderName = (profRes.data?.name ?? "").trim();

  // Canal: veio no payload (caso comum) → já temos; senão busca o da conversa.
  let channel = channelParamRes.data;
  if (!channel) {
    const r = await supabase
      .from("whatsapp_channels")
      .select("*")
      .eq("id", conv.channel_id)
      .maybeSingle();
    channel = r.data;
  }
  if (!channel || !channel.active) {
    return Response.json({ error: "Canal de WhatsApp inválido ou inativo" }, { status: 400 });
  }

  // Contato + limite diário em paralelo (ambos dependem só do que já temos).
  const [contactRes, countRes] = await Promise.all([
    supabase.from("contacts").select("phone").eq("id", conv.contact_id).maybeSingle(),
    supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("channel_id", channel.id)
      .eq("direction", "out")
      .gte("created_at", startOfDay.toISOString()),
  ]);
  const to = toWhatsAppNumber(contactRes.data?.phone);
  if (!to) return Response.json({ error: "Contato sem telefone" }, { status: 400 });
  if ((countRes.count ?? 0) >= channel.daily_limit) {
    return Response.json({ error: "Limite diário do canal atingido" }, { status: 429 });
  }

  const within24h =
    !!lastInRes.data && Date.now() - new Date(lastInRes.data.created_at).getTime() < DAY_MS;

  // Responder (0077): id local (grava o vínculo) e id na Meta (citação no WhatsApp).
  const replyToLocal: string | null = replyRes.data?.id ?? null;
  const replyToWaId: string | null = replyRes.data?.wa_message_id ?? null;

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
      // Prefixa com o nome de quem enviou (o cliente vê quem está falando).
      // Nome numa linha, linha em branco, e a mensagem embaixo. As quebras que o
      // atendente digitou são preservadas (só tira espaço das pontas).
      const outText = senderName ? `*${senderName}:*\n\n${text.trim()}` : text.trim();
      waResp = await sendText(channel.phone_number_id, to, outText, replyToWaId ?? undefined);
      bodyText = outText;
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
      // Responder (0077): só grava a coluna quando há citação — mantém o insert
      // funcional mesmo antes de a migração 0077 ser aplicada.
      ...(replyToLocal ? { reply_to: replyToLocal } : {}),
      created_by: user.id,
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
      // Responder REABRE a conversa (volta pra caixa ativa se estava finalizada/arquivada).
      closed_at: null,
      closed_by: null,
      archived_at: null,
      archived_by: null,
      // Enviar TEMPLATE (única forma de falar com a conversa finalizada) reabre E
      // atribui a quem enviou — o atendente assume o retorno do cliente.
      ...(template ? { assigned_to: user.id } : {}),
    })
    .eq("id", conversationId);

  return Response.json({ ok: true, id: msg.id, waMessageId, message: msg });
}
