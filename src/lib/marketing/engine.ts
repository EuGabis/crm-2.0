import { Resend } from "resend";
import { createAdminClient } from "@/lib/supabase/admin";
import { renderTemplate } from "@/lib/automations/actions";
import { renderCampaignEmail } from "@/lib/email/marketing-template";
import { unsubscribeUrl } from "@/lib/marketing/unsubscribe";

/* eslint-disable @typescript-eslint/no-explicit-any */

const BATCH = 100; // teto do Resend Batch API
const CAMPAIGN_LIMIT = 5; // campanhas por tick

/**
 * Processa campanhas em envio: para cada uma, pega até 100 destinatários pendentes
 * e dispara em lote via Resend Batch, gravando `resend_id` + status.
 *
 * NB (v1): não há claim atômico do lote — dois ticks sobrepostos poderiam reenviar
 * os mesmos pendentes. Com o cron de 1 min e lotes rápidos o risco é baixo; se virar
 * problema, adicionar um estado 'sending' no destinatário com reclaim de itens presos.
 */
export async function processDueCampaigns(): Promise<{
  processed: number;
  sent: number;
  errors: number;
}> {
  const db = createAdminClient();

  // 1. Promove agendadas vencidas para "sending".
  await db
    .from("email_campaigns")
    .update({ status: "sending", updated_at: new Date().toISOString() })
    .eq("status", "scheduled")
    .lte("scheduled_at", new Date().toISOString());

  // 2. Campanhas em envio.
  const { data: campaigns } = await db
    .from("email_campaigns")
    .select("*")
    .eq("status", "sending")
    .limit(CAMPAIGN_LIMIT);

  if (!campaigns?.length) return { processed: 0, sent: 0, errors: 0 };

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { processed: 0, sent: 0, errors: campaigns.length };
  const resend = new Resend(apiKey);

  let processed = 0;
  let sentTotal = 0;
  let errorTotal = 0;

  for (const camp of campaigns as any[]) {
    // Claim atômico do lote (FOR UPDATE SKIP LOCKED): dois ticks nunca pegam o mesmo
    // destinatário → sem envio duplicado. Só claima se a campanha ainda estiver 'sending'.
    const { data: recips } = await db.rpc("claim_recipients", {
      p_campaign_id: camp.id,
      p_limit: BATCH,
    });

    if (!recips?.length) {
      // Nada a claimar agora. Só finaliza se NÃO sobrou nenhum pendente (evita marcar
      // 'sent' enquanto outro tick ainda está processando um lote reivindicado).
      const { count } = await db
        .from("email_campaign_recipients")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", camp.id)
        .eq("status", "pending");
      if ((count ?? 0) === 0) {
        await db
          .from("email_campaigns")
          .update({ status: "sent", updated_at: new Date().toISOString() })
          .eq("id", camp.id);
      }
      continue;
    }
    processed++;

    const payloads = (recips as any[]).map((r) => {
      const vars: Record<string, string> = {
        nome: [r.first_name, r.last_name].filter(Boolean).join(" "),
        email: r.email ?? "",
        ...flattenCustom(r.custom_fields),
      };
      const unsub = unsubscribeUrl(r.contact_id, camp.id);
      const bodyHtml = renderTemplate(camp.body_html ?? "", vars);
      const { html, text } = renderCampaignEmail({
        subject: camp.subject ?? "",
        bodyHtml,
        unsubscribeUrl: unsub,
        accent: camp.accent_color ?? undefined,
      });
      return {
        from: camp.from_email,
        to: r.email,
        subject: renderTemplate(camp.subject ?? "", vars),
        html,
        text,
        ...(camp.reply_to ? { replyTo: camp.reply_to } : {}),
        headers: {
          "List-Unsubscribe": `<${unsub}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
        tags: [
          { name: "campaign_id", value: camp.id },
          { name: "recipient_id", value: r.id },
        ],
      };
    });

    let ids: string[] = [];
    let failed = false;
    try {
      const res = await resend.batch.send(payloads as any);
      if (res.error) failed = true;
      else ids = (res.data?.data ?? []).map((d: any) => d.id);
    } catch {
      failed = true;
    }

    if (failed) {
      const iso = new Date().toISOString();
      for (const r of recips as any[]) {
        await db
          .from("email_campaign_recipients")
          .update({ status: "failed", error: "Falha no envio em lote" })
          .eq("id", r.id);
      }
      await db
        .from("email_campaigns")
        .update({ failed: (camp.failed ?? 0) + recips.length, updated_at: iso })
        .eq("id", camp.id);
      errorTotal += recips.length;
      continue;
    }

    const iso = new Date().toISOString();
    let k = 0;
    for (let i = 0; i < recips.length; i++) {
      const r = (recips as any[])[i];
      await db
        .from("email_campaign_recipients")
        .update({ status: "sent", resend_id: ids[i] ?? null, sent_at: iso })
        .eq("id", r.id);
      k++;
    }
    await db
      .from("email_campaigns")
      .update({ sent: (camp.sent ?? 0) + k, updated_at: iso })
      .eq("id", camp.id);
    sentTotal += k;
  }

  return { processed, sent: sentTotal, errors: errorTotal };
}

function flattenCustom(cf: any): Record<string, string> {
  if (!cf || typeof cf !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(cf)) out[k] = v == null ? "" : String(v);
  return out;
}
