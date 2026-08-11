import { Resend } from "resend";
import { createClient } from "@/lib/supabase/server";
import { renderTemplate } from "@/lib/automations/actions";
import { renderCampaignEmail } from "@/lib/email/marketing-template";
import { unsubscribeUrl } from "@/lib/marketing/unsubscribe";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Envia UMA cópia da campanha (renderizada) para o e-mail do próprio usuário logado,
 * sem materializar fila. Serve para o botão "Enviar teste pra mim" do composer.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return Response.json({ error: "Não autenticado" }, { status: 401 });

  const { data: camp, error } = await supabase
    .from("email_campaigns")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error || !camp) return Response.json({ error: "Campanha não encontrada" }, { status: 404 });

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "Envio não configurado (RESEND_API_KEY ausente)" },
      { status: 503 },
    );
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("name")
    .eq("id", user.id)
    .maybeSingle();

  const vars: Record<string, string> = {
    nome: (profile as any)?.name ?? "",
    email: user.email,
  };
  const unsub = unsubscribeUrl(user.id, (camp as any).id);
  const { html, text } = renderCampaignEmail({
    subject: (camp as any).subject ?? "",
    bodyHtml: renderTemplate((camp as any).body_html ?? "", vars),
    unsubscribeUrl: unsub,
    accent: (camp as any).accent_color ?? undefined,
  });

  const resend = new Resend(apiKey);
  const { error: sendErr } = await resend.emails.send({
    from: (camp as any).from_email,
    to: user.email,
    subject: `[Teste] ${renderTemplate((camp as any).subject ?? "", vars)}`,
    html,
    text,
    ...((camp as any).reply_to ? { replyTo: (camp as any).reply_to } : {}),
  });
  if (sendErr) return Response.json({ error: sendErr.message }, { status: 400 });

  return Response.json({ ok: true, to: user.email });
}
