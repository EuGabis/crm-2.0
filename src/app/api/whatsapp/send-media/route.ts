import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { uploadMedia, sendMediaMessage } from "@/lib/whatsapp/client";
import { inspecionarAudio, resumoDaInspecao } from "@/lib/whatsapp/audio";
import { toWhatsAppNumber } from "@/lib/whatsapp/phone";

/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = "force-dynamic";
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Marca a mensagem como falha e GRAVA O MOTIVO.
 *
 * ⚠️ **Duas coisas estavam erradas aqui, e juntas tornavam o problema
 * indiagnosticável** — foi o que apareceu como "usuários tentando enviar áudio
 * e falhando", com o balão dizendo só "falhou".
 *
 * 1. **O motivo não era gravado.** A rota fazia `update({ status: "failed" })` e
 *    devolvia o texto do erro na resposta HTTP, que virava um toast e sumia.
 *    `messages.error_detail` existe desde a 0031 e o webhook já o usa para falha
 *    de ENTREGA; a falha de ENVIO simplesmente não escrevia nele. Sem isso não
 *    há como distinguir "janela de 24h fechada" de "formato recusado pela Meta"
 *    — e a conduta do atendente é oposta nos dois casos.
 *
 * 2. **A escrita usava a sessão do usuário, e a RLS a recusava em silêncio.** A
 *    policy `membros editam` de `messages` (0074) exige
 *    `private.conv_assigned_to_me(conversation_id)` — ou ver tudo, sem bot e sem
 *    atribuição. Então um atendente que manda áudio numa conversa atribuída a
 *    OUTRA pessoa (ou com bot) não conseguia gravar status nenhum, e **UPDATE
 *    recusado pela RLS não vem com erro**: afeta 0 linhas, calado. É a mesma
 *    armadilha já documentada em `conversationActions.removeMessage`.
 *    Isso explica o "alguns usuários": dependia de a conversa ser sua.
 *
 * O padrão certo é o do projeto: **a sessão AUTORIZA, a service role ESCREVE**
 * (igual `resolveGuruUserToken` e a rota de transcrição). Quem não pode ver a
 * conversa já levou 404 muito antes daqui.
 */
async function marcarFalha(
  admin: ReturnType<typeof createAdminClient>,
  messageId: string,
  motivo: string,
) {
  await admin
    .from("messages")
    .update({
      status: "failed",
      failed_at: new Date().toISOString(),
      // Coluna de texto livre; corto para não guardar um stack inteiro.
      error_detail: motivo.slice(0, 500),
    })
    .eq("id", messageId);
}

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
  const { conversationId, channelId, messageId, mediaPath, mime, caption, filename } = body ?? {};
  const kind = body?.kind as "image" | "audio" | "video" | "document";
  if (
    !conversationId ||
    !messageId ||
    !mediaPath ||
    !["image", "audio", "video", "document"].includes(kind)
  ) {
    return Response.json({ error: "parâmetros ausentes" }, { status: 400 });
  }

  const { data: conv } = await supabase
    .from("conversations")
    .select("id, contact_id, location_id, channel_id")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conv) return Response.json({ error: "Conversa não encontrada" }, { status: 404 });

  // A partir daqui a sessão JÁ autorizou (o select acima passou pela RLS), então
  // toda escrita usa a service role — inclusive as de falha abaixo. Ver
  // `marcarFalha`.
  const admin = createAdminClient();
  /** Recusa que o atendente precisa ver NO BALÃO, não num toast que sumiu. */
  const recusar = async (motivo: string, status: number, extra?: Record<string, unknown>) => {
    await marcarFalha(admin, messageId, motivo);
    return Response.json({ error: motivo, ...extra }, { status });
  };

  const { data: channel } = await supabase
    .from("whatsapp_channels")
    .select("*")
    .eq("id", channelId ?? conv.channel_id)
    .maybeSingle();
  if (!channel || !channel.active) {
    return recusar("Canal de WhatsApp inválido ou inativo", 400);
  }

  const { data: contact } = await supabase
    .from("contacts")
    .select("phone")
    .eq("id", conv.contact_id)
    .maybeSingle();
  const to = toWhatsAppNumber(contact?.phone);
  if (!to) return recusar("Contato sem telefone válido", 400);

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
    return recusar(`Limite diário do canal atingido (${channel.daily_limit})`, 429);
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
    // Marca como falha de propósito: a mídia ficou no inbox e o cliente NÃO
    // recebeu. Sem a marca o balão nascia sem indicador nenhum, e o atendente
    // não tinha como saber que o áudio não saiu.
    return recusar("Janela de 24h fechada — envie um template antes", 409, {
      needsTemplate: true,
    });
  }

  // lê o arquivo do nosso Storage com a chave de serviço: já autorizamos o usuário
  // e a conversa acima, então não faz sentido a leitura depender do token da sessão
  // (era o suspeito nº 1 do "Authentication Error" na hora de baixar a mídia).
  const { data: blob, error: dlErr } = await admin.storage
    .from("conversation-media")
    .download(mediaPath);
  if (dlErr || !blob) {
    return recusar("Mídia não encontrada: " + (dlErr?.message ?? "arquivo ausente"), 400);
  }
  const bytes = await blob.arrayBuffer();
  const sendBytes = bytes;
  const sendMime = mime || blob.type || "application/octet-stream";

  /*
   * ⚠️ **Conferir o áudio ANTES de mandar, porque a Meta mente sobre o momento
   * da recusa.** Ela aceita o upload, devolve 200 com id de mensagem — o toast
   * chegava a dizer "Áudio enviado" — e só recusa DEPOIS, ao processar, num
   * webhook de status cujo `errors[0].title` é "Media upload error": um rótulo de
   * CATEGORIA que não diz o que está errado.
   *
   * Lendo os bytes aqui, a recusa passa a ter motivo específico e verificável,
   * gravado em `error_detail`, sem pagar a ida à Meta para receber um rótulo
   * genérico de volta.
   *
   * Inconclusivo NÃO bloqueia: `inspecionarAudio` só reprova o que dá para
   * afirmar pelos bytes (vazio, contêiner errado, sem Opus, canais > 1).
   */
  if (kind === "audio") {
    const insp = inspecionarAudio(bytes);
    console.log(`[send-media] áudio ${messageId}: ${resumoDaInspecao(insp)}`);
    if (!insp.aceitavel) {
      return recusar(`${insp.motivo} (${resumoDaInspecao(insp)})`, 422);
    }
  }

  let waResp: any;
  try {
    const ext = (String(sendMime || "application/octet-stream").split("/")[1] || "bin").split(";")[0];
    const uploadName = kind === "document" && filename ? String(filename) : `media.${ext}`;
    const mediaId = await uploadMedia(channel.phone_number_id, sendBytes, sendMime, uploadName);
    waResp = await sendMediaMessage(channel.phone_number_id, to, kind, mediaId, caption, filename);
  } catch (e) {
    // `graphError` já monta a mensagem com o código e o subcódigo da Meta — é
    // essa string que o atendente precisa ver, e era ela que se perdia.
    const motivo = e instanceof Error ? e.message : "Falha na Cloud API";
    await marcarFalha(admin, messageId, motivo);
    return Response.json({ error: motivo }, { status: 502 });
  }

  const waMessageId = waResp?.messages?.[0]?.id ?? null;
  // ⚠️ **Escrita pela SERVICE ROLE, não pela sessão** — a sessão já autorizou lá
  // em cima. Ver o comentário de `marcarFalha`: com a sessão, esta gravação
  // falhava EM SILÊNCIO para quem não é dono da conversa, e o áudio ficava sem
  // marca de enviado mesmo tendo chegado no cliente.
  await admin
    .from("messages")
    .update({ wa_message_id: waMessageId, status: "sent", error_detail: null, failed_at: null })
    .eq("id", messageId);

  return Response.json({ ok: true, waMessageId });
}
