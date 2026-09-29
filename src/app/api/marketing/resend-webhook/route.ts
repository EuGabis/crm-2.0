import { Webhook } from "svix";
import { createAdminClient } from "@/lib/supabase/admin";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

/** Eventos do Resend → tipos internos aplicados por apply_email_event. */
const TYPE_MAP: Record<string, string> = {
  "email.delivered": "delivered",
  "email.opened": "opened",
  "email.clicked": "clicked",
  "email.bounced": "bounced",
  "email.complained": "complained",
};

/**
 * Webhook do Resend (métricas de entrega/abertura/clique).
 *
 * Verificado por assinatura Svix com RESEND_WEBHOOK_SECRET. Casa o evento ao
 * destinatário por `data.email_id` (= resend_id gravado no envio) e atualiza
 * status + contadores via `public.ingest_email_event` (service role).
 */
export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    return Response.json({ error: "webhook não configurado" }, { status: 503 });
  }

  const payload = await request.text();
  const headers = {
    "svix-id": request.headers.get("svix-id") ?? "",
    "svix-timestamp": request.headers.get("svix-timestamp") ?? "",
    "svix-signature": request.headers.get("svix-signature") ?? "",
  };

  let evt: any;
  try {
    evt = new Webhook(secret).verify(payload, headers);
  } catch {
    return Response.json({ error: "assinatura inválida" }, { status: 400 });
  }

  const type = TYPE_MAP[evt?.type];
  const resendId = evt?.data?.email_id;
  if (!type || !resendId) {
    return Response.json({ ok: true, ignored: true });
  }

  const at = evt?.created_at ?? new Date().toISOString();
  try {
    const db = createAdminClient();
    await db.rpc("ingest_email_event", {
      p_resend_id: resendId,
      p_type: type,
      p_at: at,
    });
    /*
     * Bounce e reclamação chegam com o MOTIVO (caixa inexistente, caixa cheia,
     * marcado como spam). Sem gravar, a tela dizia só "Retornou" e ninguém
     * sabia se era para corrigir o e-mail ou tirar o contato da lista.
     */
    if (type === "bounced" || type === "complained") {
      const b = evt?.data?.bounce ?? {};
      const detalhe = [b.type, b.subType, b.message].filter(Boolean).join(" · ");
      const motivo =
        type === "complained"
          ? "O destinatário marcou o e-mail como spam"
          : `Retornou: a caixa do destinatário recusou a mensagem${detalhe ? ` (${detalhe})` : ""}`;
      await db.from("email_campaign_recipients").update({ error: motivo }).eq("resend_id", resendId);
    }
  } catch (error) {
    console.error("[marketing] webhook falhou:", error);
    return Response.json({ error: "erro ao processar" }, { status: 500 });
  }

  return Response.json({ ok: true });
}
