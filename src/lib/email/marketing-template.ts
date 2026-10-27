import { emailBrand } from "@/lib/config/brand";
import { blocoDeAnexosHtml, blocoDeAnexosTexto, type AnexoEmail } from "@/lib/email/anexos";
import { cssDaFonte, normalizarDesign, type DesignEmail } from "@/lib/email/design";

/**
 * Envolve o corpo HTML de uma campanha (saída do editor rico) no shell da marca,
 * com cabeçalho e rodapé com link de descadastro. Estilo inline com tabelas — o
 * que Gmail/Outlook/Apple Mail renderizam de forma confiável (igual ao invite).
 *
 * A aparência vem do `design` da campanha (`lib/email/design.ts`), sempre
 * passado por `normalizarDesign`: é ele que garante que cor é hex e número está
 * na faixa antes de virar `style`. Sem design, sai o visual de sempre.
 *
 * As variáveis ({{nome}} etc.) já vêm resolvidas em `bodyHtml` pelo motor de envio.
 *
 * ⚠️ O link de descadastro no rodapé NÃO é opcional e não há opção para tirá-lo:
 * e-mail de marketing sem ele viola a política do Resend e a LGPD, e derruba a
 * reputação do domínio.
 */
export function renderCampaignEmail(opts: {
  subject: string;
  bodyHtml: string;
  unsubscribeUrl: string;
  /** Legado (`accent_color`): vale quando o design não traz a cor de destaque. */
  accent?: string;
  /** Arquivos da campanha, como links de download abaixo do corpo. */
  anexos?: AnexoEmail[];
  design?: unknown;
}): { html: string; text: string } {
  const { subject, bodyHtml, unsubscribeUrl } = opts;
  const d: DesignEmail = normalizarDesign(opts.design, opts.accent);
  const fonte = cssDaFonte(d.fonte);
  const anexos = opts.anexos ?? [];
  const nomeCabecalho = d.textoCabecalho.trim() || emailBrand.name;

  const body = bodyHtml
    // Cor de destaque nos links do corpo — só nos que ainda não têm estilo
    // (o botão do editor traz o próprio, e um segundo `style` seria ignorado).
    .replace(/<a\b(?![^>]*\bstyle=)/gi, `<a style="color:${d.corDestaque};text-decoration:underline"`)
    // Imagem sem estilo (colada por URL antiga) não pode estourar a largura.
    .replace(
      /<img\b(?![^>]*\bstyle=)/gi,
      '<img style="max-width:100%;height:auto;border:0;display:block;margin:8px 0;border-radius:8px;"',
    )
    // Títulos com a cor de título do design, quando o editor não definiu outra.
    .replace(/<(h[1-3])\b(?![^>]*\bstyle=)/gi, `<$1 style="color:${d.corTitulo};margin:16px 0 8px;line-height:1.3;"`)
    .replace(/<blockquote\b(?![^>]*\bstyle=)/gi, `<blockquote style="margin:12px 0;padding:4px 0 4px 14px;border-left:3px solid ${d.corDestaque};color:#64748b;"`)
    .replace(/<hr\b(?![^>]*\bstyle=)/gi, '<hr style="border:0;border-top:1px solid #e2e8f0;margin:20px 0;"');

  const alinhar = d.alinhamentoCabecalho === "centro" ? "center" : "left";
  const cabecalho =
    d.cabecalho === "nenhum"
      ? ""
      : `<tr>
              <td align="${alinhar}" style="background-color:${d.corCabecalho};padding:22px ${d.espacamento}px;">
                ${
                  d.cabecalho === "logo" && d.logoUrl
                    ? `<img src="${esc(d.logoUrl)}" alt="${esc(nomeCabecalho)}" height="${d.alturaLogo}" style="height:${d.alturaLogo}px;width:auto;max-width:100%;border:0;display:inline-block;" />`
                    : `<table role="presentation" cellpadding="0" cellspacing="0"${alinhar === "center" ? ' align="center"' : ""}>
                  <tr>
                    <td style="padding-right:10px;">
                      <div style="width:32px;height:32px;background-color:${d.corDestaque};border-radius:9px;color:#ffffff;font-size:16px;font-weight:800;line-height:32px;text-align:center;">
                        ${esc(nomeCabecalho[0] ?? emailBrand.shortName[0])}
                      </div>
                    </td>
                    <td style="color:${d.corTextoCabecalho};font-size:16px;font-weight:700;">${esc(nomeCabecalho)}</td>
                  </tr>
                </table>`
                }
              </td>
            </tr>`;

  const rodapeExtra = d.textoRodape.trim()
    ? `<p style="margin:0 0 8px;color:#64748b;font-size:12px;line-height:1.6;">${esc(d.textoRodape).replace(/\n/g, "<br />")}</p>`
    : "";

  const html = `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(subject)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:${d.corFundo};font-family:${fonte};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${d.corFundo};padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:${d.largura}px;background-color:${d.corConteudo};border-radius:${d.cantos}px;overflow:hidden;${d.faixaDestaque ? `border-top:4px solid ${d.corDestaque};` : ""}box-shadow:0 1px 3px rgba(15,23,42,0.08);">
            ${cabecalho}
            <tr>
              <td style="padding:${d.espacamento}px;color:${d.corTexto};font-family:${fonte};font-size:${d.tamanhoFonte}px;line-height:1.6;">
                ${body}
                ${blocoDeAnexosHtml(anexos, d.corDestaque)}
              </td>
            </tr>
            <tr>
              <td style="background-color:${d.corRodape};padding:18px ${d.espacamento}px;border-top:1px solid #e2e8f0;font-family:${fonte};">
                ${rodapeExtra}
                <p style="margin:0;color:#94a3b8;font-size:11px;line-height:1.6;">
                  Você recebeu este e-mail de ${esc(nomeCabecalho)}. Se não quiser mais receber nossas
                  campanhas, <a href="${unsubscribeUrl}" style="color:#64748b;text-decoration:underline;">descadastre-se aqui</a>.
                </p>
                ${d.mostrarEndereco ? `<p style="margin:6px 0 0;color:#cbd5e1;font-size:11px;line-height:1.6;">${emailBrand.address}</p>` : ""}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = `${stripHtml(bodyHtml)}${blocoDeAnexosTexto(anexos)}\n\n—\n${d.textoRodape.trim() ? `${d.textoRodape.trim()}\n` : ""}Para descadastrar: ${unsubscribeUrl}${d.mostrarEndereco ? `\n${emailBrand.address}` : ""}`;

  return { html, text };
}

function esc(value: string): string {
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
