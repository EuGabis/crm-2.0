import { Resend } from "resend";
import { createAdminClient } from "@/lib/supabase/admin";
import { renderResetEmail } from "@/lib/email/reset-template";
import { replyToAddress, senderAddress } from "@/lib/email/sender";

/** Caminho da página que troca o token pela sessão e pede a nova senha. */
export const RESET_PATH = "/login/redefinir";

export interface ResultadoRedefinicao {
  ok: boolean;
  /** Link gerado — devolvido só a quem é admin, para copiar se o e-mail falhar. */
  link?: string;
  emailSent: boolean;
  error?: string;
}

/**
 * Gera o link de redefinição pela API admin do Supabase e envia pelo Resend.
 *
 * ⚠️ Não usa `resetPasswordForEmail`: ele envia pelo SMTP embutido do Supabase,
 * que só entrega a quem é da equipe do projeto no painel do Supabase e tem
 * limite de poucos e-mails por hora — é por isso que "o e-mail de reset não
 * chega". Aqui usamos o `hashed_token` e montamos o link para a NOSSA página,
 * que chama `verifyOtp` — o fluxo recomendado com @supabase/ssr, sem depender
 * da lista de Redirect URLs do painel.
 */
export async function enviarRedefinicao(
  email: string,
  origin: string,
  name?: string
): Promise<ResultadoRedefinicao> {
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email });
  if (error || !data?.properties?.hashed_token) {
    return { ok: false, emailSent: false, error: error?.message ?? "Usuário não encontrado" };
  }

  const link = `${origin}${RESET_PATH}?token_hash=${encodeURIComponent(
    data.properties.hashed_token
  )}&type=recovery`;

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { ok: true, link, emailSent: false, error: "RESEND_API_KEY ausente" };
  }

  const { subject, html, text } = renderResetEmail({ name, link });
  try {
    const replyTo = replyToAddress();
    const { error: sendError } = await new Resend(apiKey).emails.send({
      from: senderAddress(),
      to: email,
      subject,
      html,
      text,
      ...(replyTo ? { replyTo } : {}),
    });
    if (sendError) return { ok: true, link, emailSent: false, error: sendError.message };
  } catch (e) {
    return { ok: true, link, emailSent: false, error: e instanceof Error ? e.message : "falha no envio" };
  }
  return { ok: true, link, emailSent: true };
}

export function appOrigin(request: Request): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
}
