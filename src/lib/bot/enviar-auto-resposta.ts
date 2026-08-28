import { respostaAplicavel, type AutoResposta } from "./auto-resposta";
import { sendText } from "@/lib/whatsapp/client";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Responde com UMA mensagem quando há janela de resposta automática ativa.
 *
 * ⚠️ **Roda ANTES do fluxo do bot e do auto-responder de IA, e é o ponto todo.**
 * Se rodasse depois, um número com fluxo configurado triaria o cliente às 3h da
 * manhã — perguntando nome, e-mail e assunto — para no fim ninguém atender. A
 * janela existe justamente para dizer "não estamos agora"; ela tem que calar os
 * dois.
 *
 * Devolve `true` quando respondeu, e aí o webhook não chama mais nada.
 */
export async function maybeAutoRespostaAgendada(
  db: any,
  args: {
    locationId: string;
    channelId: string;
    phoneNumberId: string;
    conversationId: string;
    toPhone: string;
    dailyLimit: number;
  },
): Promise<boolean> {
  const { data: linhas } = await db
    .from("auto_respostas")
    .select("*")
    .eq("location_id", args.locationId)
    .eq("ativo", true);
  if (!linhas?.length) return false;

  const regras: AutoResposta[] = linhas.map((r: any) => ({
    id: r.id,
    nome: r.nome,
    mensagem: r.mensagem,
    ativo: r.ativo,
    tipo: r.tipo,
    channelId: r.channel_id,
    diasSemana: r.dias_semana,
    horaInicio: r.hora_inicio,
    horaFim: r.hora_fim,
    inicioEm: r.inicio_em,
    fimEm: r.fim_em,
  }));

  const regra = respostaAplicavel(regras, args.channelId);
  if (!regra) return false;

  /*
   * ⚠️ **O limite diário do número é respeitado aqui também.** O Gabriel escolheu
   * responder a TODA mensagem, então quem manda cinco recebe cinco — e cada uma
   * conta no teto da Cloud API. Sem esta checagem, uma rajada num recesso
   * consumiria a cota do número e derrubaria o envio das mensagens de verdade.
   */
  const inicioDoDia = new Date();
  inicioDoDia.setHours(0, 0, 0, 0);
  const { count } = await db
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("channel_id", args.channelId)
    .eq("direction", "out")
    .gte("created_at", inicioDoDia.toISOString());
  if ((count ?? 0) >= args.dailyLimit) {
    console.warn(`[auto-resposta] limite diário do canal atingido — não respondi`);
    return false;
  }

  let waId: string | null = null;
  try {
    const r = await sendText(args.phoneNumberId, args.toPhone, regra.mensagem);
    waId = r?.messages?.[0]?.id ?? null;
  } catch (e) {
    // Best-effort, como todo o resto do webhook: falhar aqui não pode derrubar o
    // 200 para a Meta, senão ela reenvia a mensagem do cliente em looping.
    console.warn("[auto-resposta] falha ao enviar:", e);
    return false;
  }

  await db.from("messages").insert({
    location_id: args.locationId,
    conversation_id: args.conversationId,
    direction: "out",
    type: "text",
    channel: "whatsapp",
    body: regra.mensagem,
    wa_message_id: waId,
    status: waId ? "sent" : "failed",
    channel_id: args.channelId,
    // ⚠️ Marca como automática: é o que faz a conversa aparecer no filtro
    // "Conversas com automação" (0027) e o que impede esta resposta de contar
    // como ATENDIMENTO no SLA (0079) — sem isso, o cumprimento da meta ficaria
    // perfeito sem ninguém ter atendido.
    automated: true,
  });

  return true;
}
