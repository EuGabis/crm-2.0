import { brand, emailBrand } from "@/lib/config/brand";

export interface InviteEmailData {
  /** Nome de quem convidou (ex.: "Gabriel Pereira") */
  inviterName: string;
  /** Nome da empresa/location */
  companyName: string;
  /** Papel na equipe */
  role: "admin" | "user";
  /** URL de cadastro (ex.: https://app.litocrm.com.br/login) */
  signupUrl: string;
  /** E-mail convidado — usado para reforçar qual endereço usar no cadastro */
  email: string;
  /** URL pública do logo da empresa (opcional) */
  logoUrl?: string;
}

const INDIGO = "#6366f1";
const GRAPHITE = "#131826";

/**
 * E-mail de convite com a identidade do Lito CRM.
 * HTML com tabelas e estilo inline — o que os clientes de e-mail
 * (Gmail, Outlook, Apple Mail) renderizam de forma confiável.
 */
export function renderInviteEmail(data: InviteEmailData): { subject: string; html: string; text: string } {
  const roleLabel = data.role === "admin" ? "Administrador" : "Usuário";
  const subject = `${data.inviterName} convidou você para o ${brand.name}`;

  const html = `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${subject}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
      Você foi adicionado à equipe de ${data.companyName} no ${brand.name}. Crie sua conta para começar.
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,0.08);">
            <!-- Cabeçalho -->
            <tr>
              <td style="background-color:${GRAPHITE};padding:28px 32px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="padding-right:10px;">
                      ${data.logoUrl
                        ? `<img src="${data.logoUrl}" alt="${escapeHtml(data.companyName)}" width="34" height="34" style="width:34px;height:34px;border-radius:9px;object-fit:cover;display:block;" />`
                        : `<div style="width:34px;height:34px;background-color:${INDIGO};border-radius:9px;color:#ffffff;font-size:17px;font-weight:800;line-height:34px;text-align:center;">${brand.shortName[0]}</div>`}
                    </td>
                    <td style="color:#ffffff;font-size:17px;font-weight:700;">${brand.name}</td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Conteúdo -->
            <tr>
              <td style="padding:32px;">
                <p style="margin:0 0 6px;color:${INDIGO};font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;">
                  Convite de equipe
                </p>
                <h1 style="margin:0 0 16px;color:#0f172a;font-size:23px;line-height:1.25;font-weight:700;">
                  ${escapeHtml(data.inviterName)} convidou você para<br />trabalhar em ${escapeHtml(data.companyName)}
                </h1>
                <p style="margin:0 0 24px;color:#475569;font-size:15px;line-height:1.6;">
                  Você vai usar o ${brand.name} para atender leads no WhatsApp, organizar o funil de vendas
                  e acompanhar seus resultados — tudo em um lugar só.
                </p>

                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:26px;">
                  <tr>
                    <td style="padding:14px 16px;border-bottom:1px solid #e2e8f0;">
                      <span style="color:#64748b;font-size:12px;">Empresa</span><br />
                      <strong style="color:#0f172a;font-size:14px;">${escapeHtml(data.companyName)}</strong>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:14px 16px;border-bottom:1px solid #e2e8f0;">
                      <span style="color:#64748b;font-size:12px;">Seu acesso</span><br />
                      <strong style="color:#0f172a;font-size:14px;">${roleLabel}</strong>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:14px 16px;">
                      <span style="color:#64748b;font-size:12px;">Cadastre-se com este e-mail</span><br />
                      <strong style="color:#0f172a;font-size:14px;">${escapeHtml(data.email)}</strong>
                    </td>
                  </tr>
                </table>

                <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:22px;">
                  <tr>
                    <td style="background-color:${INDIGO};border-radius:10px;">
                      <a href="${data.signupUrl}" style="display:inline-block;padding:13px 26px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">
                        Criar minha conta
                      </a>
                    </td>
                  </tr>
                </table>

                <p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.6;">
                  Use exatamente o e-mail acima ao criar a conta — é assim que você entra na equipe certa.
                  Se o botão não funcionar, copie este endereço no navegador:<br />
                  <span style="color:#64748b;word-break:break-all;">${data.signupUrl}</span>
                </p>
              </td>
            </tr>

            <!-- Rodapé -->
            <tr>
              <td style="background-color:#f8fafc;padding:18px 32px;border-top:1px solid #e2e8f0;">
                <p style="margin:0;color:#94a3b8;font-size:11px;line-height:1.6;">
                  Você recebeu este e-mail porque ${escapeHtml(data.inviterName)} adicionou seu endereço à
                  equipe de ${escapeHtml(data.companyName)} no ${brand.name}.
                  Se não esperava por isso, pode ignorar esta mensagem.
                </p>
                <p style="margin:6px 0 0;color:#cbd5e1;font-size:11px;line-height:1.6;">
                  ${emailBrand.address}
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

  const text = [
    `${data.inviterName} convidou você para trabalhar em ${data.companyName} no ${brand.name}.`,
    "",
    `Empresa: ${data.companyName}`,
    `Seu acesso: ${roleLabel}`,
    `Cadastre-se com este e-mail: ${data.email}`,
    "",
    `Crie sua conta: ${data.signupUrl}`,
    "",
    "Use exatamente esse e-mail ao criar a conta — é assim que você entra na equipe certa.",
  ].join("\n");

  return { subject, html, text };
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
