/**
 * Disparo das mensagens agendadas (migração 0028).
 *
 * Roda no batimento de minuto que já existe (`/api/automations/tick`, chamado
 * pelo pg_cron) — de propósito: reaproveitar o job evita um segundo cron, um
 * segundo segredo e mais um passo manual em produção.
 *
 * Antes disso, "Programar" só gravava a data e a mensagem ficava eternamente
 * com o selo AGENDADA. Agora o ciclo é
 * `pendente → enviando → enviada | falhou`.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { sendText } from "@/lib/whatsapp/client";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Teto por tick: o cron roda a cada minuto, não vale segurar a rota. */
const BATCH = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ScheduledResult {
  dispatched: number;
  failed: number;
}

export async function dispatchScheduledMessages(): Promise<ScheduledResult> {
  const db = createAdminClient();
  const now = new Date().toISOString();

  const { data: due, error } = await db
    .from("messages")
    .select("id, conversation_id, location_id, channel, body, internal, scheduled_for")
    .eq("schedule_status", "pendente")
    .lte("scheduled_for", now)
    .order("scheduled_for", { ascending: true })
    .limit(BATCH);

  if (error || !due?.length) return { dispatched: 0, failed: 0 };

  let dispatched = 0;
  let failed = 0;

  for (const msg of due) {
    // Claim: só um tick pega a mensagem, mesmo com dois rodando ao mesmo tempo.
    const { data: claimed } = await db
      .from("messages")
      .update({ schedule_status: "enviando" })
      .eq("id", msg.id)
      .eq("schedule_status", "pendente")
      .select("id")
      .maybeSingle();
    if (!claimed) continue; // outro tick levou, ou o usuário cancelou

    const outcome = await deliver(db, msg);

    if (outcome.ok) {
      await db
        .from("messages")
        .update({
          schedule_status: "enviada",
          dispatched_at: new Date().toISOString(),
          schedule_error: null,
          ...(outcome.waMessageId ? { wa_message_id: outcome.waMessageId, status: "sent" } : {}),
        })
        .eq("id", msg.id);

      // A conversa sobe na lista como qualquer mensagem enviada agora.
      await db
        .from("conversations")
        .update({
          last_message_at: new Date().toISOString(),
          last_message_preview: msg.internal ? "Comentário interno" : msg.body,
          sla_days: 0,
        })
        .eq("id", msg.conversation_id);

      dispatched++;
    } else {
      await db
        .from("messages")
        .update({
          schedule_status: "falhou",
          dispatched_at: new Date().toISOString(),
          schedule_error: outcome.error.slice(0, 500),
        })
        .eq("id", msg.id);
      failed++;
    }
  }

  return { dispatched, failed };
}

type Delivery = { ok: true; waMessageId?: string | null } | { ok: false; error: string };

/**
 * Entrega de fato. WhatsApp sai pela Cloud API; comentário interno não sai da
 * caixa; os demais canais ainda não têm integração de envio — nesses a
 * "entrega" é publicar na conversa, que é exatamente o que o composer faz hoje.
 */
async function deliver(db: any, msg: any): Promise<Delivery> {
  if (msg.internal) return { ok: true };
  if (msg.channel !== "whatsapp") return { ok: true };

  const { data: conv } = await db
    .from("conversations")
    .select("id, contact_id, channel_id")
    .eq("id", msg.conversation_id)
    .maybeSingle();
  if (!conv) return { ok: false, error: "Conversa não encontrada" };
  if (!conv.channel_id) {
    return { ok: false, error: "Conversa sem canal de WhatsApp conectado" };
  }

  const { data: channel } = await db
    .from("whatsapp_channels")
    .select("id, phone_number_id, active, daily_limit")
    .eq("id", conv.channel_id)
    .maybeSingle();
  if (!channel || !channel.active) {
    return { ok: false, error: "Canal de WhatsApp inativo" };
  }

  const { data: contact } = await db
    .from("contacts")
    .select("phone")
    .eq("id", conv.contact_id)
    .maybeSingle();
  const to = (contact?.phone ?? "").replace(/\D/g, "");
  if (!to) return { ok: false, error: "Contato sem telefone" };

  // Mesmo limite diário que a rota interativa respeita.
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const { count, error: limiteErr } = await db
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("channel_id", channel.id)
    .eq("direction", "out")
    .gte("created_at", startOfDay.toISOString());
  // Sem conseguir contar, segue enviando (travar o atendimento por lentidão do
  // banco é pior) — mas diz, em vez de ler o vazio como zero.
  if (limiteErr) console.warn("[limite diario] contagem falhou, nao conferido:", limiteErr.message);
  if ((count ?? 0) >= channel.daily_limit) {
    return { ok: false, error: "Limite diário do canal atingido" };
  }

  // Janela de 24h da Meta: fora dela, texto livre é recusado e só template
  // passa — e template agendado é escolha do usuário, não nossa.
  const { data: lastIn } = await db
    .from("messages")
    .select("created_at")
    .eq("conversation_id", msg.conversation_id)
    .eq("direction", "in")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const within24h = !!lastIn && Date.now() - new Date(lastIn.created_at).getTime() < DAY_MS;
  if (!within24h) {
    return {
      ok: false,
      error: "Janela de 24h do WhatsApp fechada na hora do disparo — reenvie por template",
    };
  }

  try {
    const resp = await sendText(channel.phone_number_id, to, msg.body);
    return { ok: true, waMessageId: resp?.messages?.[0]?.id ?? null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Falha na Cloud API" };
  }
}
