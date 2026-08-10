import { brand } from "@/lib/config/brand";

/**
 * Envolve o corpo HTML de uma campanha (saída do editor rico) no shell da marca,
 * com cabeçalho e rodapé com link de descadastro. Estilo inline com tabelas — o
 * que Gmail/Outlook/Apple Mail renderizam de forma confiável (igual ao invite).
 *
 * As variáveis ({{nome}} etc.) já vêm resolvidas em `bodyHtml` pelo motor de envio.
 */
const INDIGO = "#6366f1";
const GRAPHITE = "#131826";

export function renderCampaignEmail(opts: {
  subject: string;
  bodyHtml: string;
  unsubscribeUrl: string;
}): { html: string; text: string } {
  const { subject, bodyHtml, unsubscribeUrl } = opts;

  const html = `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,0.08);">
            <tr>
              <td style="background-color:${GRAPHITE};padding:22px 32px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="padding-right:10px;">
                      <div style="width:32px;height:32px;background-color:${INDIGO};border-radius:9px;color:#ffffff;font-size:16px;font-weight:800;line-height:32px;text-align:center;">
                        ${brand.shortName[0]}
                      </div>
                    </td>
                    <td style="color:#ffffff;font-size:16px;font-weight:700;">${brand.name}</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;color:#334155;font-size:15px;line-height:1.6;">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="background-color:#f8fafc;padding:18px 32px;border-top:1px solid #e2e8f0;">
                <p style="margin:0;color:#94a3b8;font-size:11px;line-height:1.6;">
                  Você recebeu este e-mail do ${brand.name}. Se não quiser mais receber nossas
                  campanhas, <a href="${unsubscribeUrl}" style="color:#64748b;text-decoration:underline;">descadastre-se aqui</a>.
                </p>
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0;color:#94a3b8;font-size:11px;">${brand.name} · ${brand.tagline}</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = `${stripHtml(bodyHtml)}\n\n—\nPara descadastrar: ${unsubscribeUrl}`;

  return { html, text };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>(?=\s*)/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
