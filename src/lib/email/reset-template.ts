import { brand, emailBrand } from "@/lib/config/brand";

const INDIGO = "#6366f1";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );
}

/**
 * E-mail de redefinição de senha com a identidade do CRM — enviado pelo Resend,
 * não pelo SMTP embutido do Supabase (que só entrega a membros da equipe do
 * projeto no Supabase e tem limite de poucos e-mails por hora).
 */
export function renderResetEmail(data: { name?: string; link: string }): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = `Redefinir sua senha do ${brand.name}`;
  const saudacao = data.name ? `Olá, ${esc(data.name)}!` : "Olá!";
  const html = `<!doctype html>
<html lang="pt-BR">
  <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${subject}</title></head>
  <body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;">
          <tr><td style="padding:32px;">
            <p style="margin:0 0 16px;font-size:18px;font-weight:700;color:#0f172a;">${saudacao}</p>
            <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#334155;">
              Recebemos um pedido para redefinir a senha da sua conta no ${brand.name}.
              Clique no botão abaixo para escolher uma nova senha.
            </p>
            <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:8px;background:${INDIGO};">
              <a href="${esc(data.link)}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">Redefinir senha</a>
            </td></tr></table>
            <p style="margin:24px 0 0;font-size:12px;line-height:1.6;color:#64748b;">
              O link vale por tempo limitado e só pode ser usado uma vez. Se você não pediu
              a redefinição, ignore este e-mail — sua senha continua a mesma.
            </p>
          </td></tr>
        </table>
        <p style="margin:16px 0 0;font-size:11px;color:#94a3b8;">${esc(emailBrand.address)}</p>
      </td></tr>
    </table>
  </body>
</html>`;
  const text = `${data.name ? `Olá, ${data.name}!` : "Olá!"}

Recebemos um pedido para redefinir a senha da sua conta no ${brand.name}.
Abra o link abaixo para escolher uma nova senha:

${data.link}

O link vale por tempo limitado e só pode ser usado uma vez. Se você não pediu a redefinição, ignore este e-mail.`;
  return { subject, html, text };
}
