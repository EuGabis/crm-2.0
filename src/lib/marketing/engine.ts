import { Resend } from "resend";
import { createAdminClient } from "@/lib/supabase/admin";
import { renderTemplate } from "@/lib/automations/actions";
import { renderCampaignEmail } from "@/lib/email/marketing-template";
import { unsubscribeUrl } from "@/lib/marketing/unsubscribe";
import { falhaDeCota, falhaPassageira, motivoFalhaEmail } from "@/lib/marketing/falhas";

/* eslint-disable @typescript-eslint/no-explicit-any */

const BATCH = 100; // teto do Resend Batch API
const CAMPAIGN_LIMIT = 5; // campanhas por tick
/*
 * ⚠️ **Vários lotes por tique, dentro de um orçamento de tempo.** Era UM lote de
 * 100 por campanha por minuto — ~6 mil e-mails por hora, e a campanha de 21 mil
 * levava três horas e meia. O cron continua de minuto em minuto; o que muda é
 * cada tique enviar lotes até o orçamento acabar.
 *
 * - 45 s de orçamento: a rota tem `maxDuration = 60`, e passar disso faria a
 *   Vercel matar o tique no meio de um lote (o claim de 5 min o devolveria, mas
 *   o meio já enviado seria reenviado).
 * - Intervalo mínimo entre chamadas ao Resend: o limite padrão da conta é de
 *   poucas requisições por segundo, e cada Batch conta como UMA. Estourando, o
 *   429 devolve o lote para a fila e o tique para aquela campanha.
 */
const ORCAMENTO_MS = 45_000;
const INTERVALO_RESEND_MS = 600;
/** Gravações de status em paralelo, por fatia. */
const PARALELO = 20;

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

  const inicio = Date.now();
  let ultimaChamada = 0;
  const dentroDoOrcamento = () => Date.now() - inicio < ORCAMENTO_MS;

  /** Grava em fatias paralelas: 100 idas sequenciais ao banco custavam segundos por lote. */
  async function emParalelo<T>(itens: T[], fn: (x: T) => PromiseLike<unknown>) {
    for (let i = 0; i < itens.length; i += PARALELO) {
      await Promise.all(itens.slice(i, i + PARALELO).map(fn));
    }
  }

  for (const camp of campaigns as any[]) {
    let mexeu = false;
    lotes: while (dentroDoOrcamento()) {
      const espera = INTERVALO_RESEND_MS - (Date.now() - ultimaChamada);
      if (espera > 0) await new Promise((r) => setTimeout(r, espera));

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
        break lotes;
      }
      processed++;
      mexeu = true;

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

      /*
       * ⚠️ **Validação PERMISSIVA.** No modo padrão ("strict") o Resend recusa o
       * LOTE INTEIRO quando UM endereço é inválido — 100 destinatários marcados
       * "Falhou" por causa de um e-mail digitado errado. Permissivo, ele envia os
       * válidos e devolve `errors[]` com o índice e o motivo de cada recusado.
       */
      let res: any;
      ultimaChamada = Date.now();
      try {
        res = await resend.batch.send(payloads as any, { batchValidation: "permissive" } as any);
      } catch (e: any) {
        res = { error: { name: null, statusCode: null, message: e?.message ?? String(e) } };
      }

      const iso = new Date().toISOString();

      if (res?.error) {
        const { name, statusCode, message } = res.error;
        /*
         * Erro do REQUEST inteiro. Passageiro (limite por segundo, 5xx, rede) ou
         * cota: o lote VOLTA para a fila (solta o claim) em vez de virar "Falhou"
         * para sempre — reenviar depois resolve, e marcar falha tiraria esses
         * contatos da campanha sem que nada estivesse errado com eles.
         */
        if (falhaPassageira(name, statusCode) || falhaDeCota(name)) {
          console.warn(`[marketing] campanha ${camp.id}: lote adiado — ${name ?? "rede"} · ${message}`);
          await db
            .from("email_campaign_recipients")
            .update({ claimed_at: null })
            .in("id", (recips as any[]).map((r) => r.id));
          // Limite/cota/rede: insistir agora só gera mais 429. O próximo tique tenta.
          break lotes;
        }
        // Permanente (remetente, chave, parâmetro): vale para todos do lote.
        const motivo = motivoFalhaEmail(name, message);
        console.error(`[marketing] campanha ${camp.id}: lote recusado — ${motivo}`);
        await db
          .from("email_campaign_recipients")
          .update({ status: "failed", error: motivo })
          .in("id", (recips as any[]).map((r) => r.id));
        errorTotal += recips.length;
        // Remetente ou chave errados reprovam todo lote seguinte do mesmo jeito:
        // parar aqui evita queimar a campanha inteira em um minuto.
        break lotes;
      }

      // Permissivo: `errors` traz os índices recusados; `data` traz os ids dos
      // aceitos, na ordem em que foram enviados.
      const recusados = new Map<number, string>();
      for (const e of (res?.data?.errors ?? []) as any[]) {
        recusados.set(Number(e.index), motivoFalhaEmail("validation_error", e.message));
      }
      const ids: string[] = ((res?.data?.data ?? []) as any[]).map((d) => d.id);

      // `data` só tem os aceitos, na ordem: o k-ésimo aceito recebe o k-ésimo id.
      let k = 0;
      const gravacoes = (recips as any[]).map((r, i) => {
        const motivo = recusados.get(i);
        if (motivo) return { id: r.id, patch: { status: "failed", error: motivo } };
        return { id: r.id, patch: { status: "sent", resend_id: ids[k++] ?? null, sent_at: iso, error: null } };
      });
      const f = recusados.size;
      await emParalelo(gravacoes, (g) =>
        db.from("email_campaign_recipients").update(g.patch).eq("id", g.id),
      );
      sentTotal += k;
      errorTotal += f;
    }
    // ⚠️ Contadores RECONTADOS, não somados: com vários lotes e tiques
    // sobrepostos, `camp.sent + k` (lido no começo) perderia envios.
    if (mexeu) await recontar(db, camp.id);
  }

  return { processed, sent: sentTotal, errors: errorTotal };
}

/** Recalcula `sent`/`failed` da campanha a partir dos destinatários. */
async function recontar(db: ReturnType<typeof createAdminClient>, campaignId: string) {
  const conta = async (statuses: string[]) => {
    const { count } = await db
      .from("email_campaign_recipients")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .in("status", statuses);
    return count ?? 0;
  };
  const [sent, failed] = await Promise.all([
    conta(["sent", "delivered", "opened", "clicked", "bounced"]),
    conta(["failed"]),
  ]);
  await db
    .from("email_campaigns")
    .update({ sent, failed, updated_at: new Date().toISOString() })
    .eq("id", campaignId);
}

function flattenCustom(cf: any): Record<string, string> {
  if (!cf || typeof cf !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(cf)) out[k] = v == null ? "" : String(v);
  return out;
}
