/**
 * Anexos das campanhas de e-mail — entregues como LINK de download no corpo.
 *
 * ⚠️ Não é anexo MIME de propósito: o envio em lote do Resend não aceita
 * `attachments`, e anexo pesado em e-mail de massa derruba a entrega (spam).
 * Ver a migração 202610271000. Puro e sem dependência, para ter teste.
 */
export interface AnexoEmail {
  name: string;
  url: string;
  size: number;
  type: string;
}

export const ANEXO_MAX_BYTES = 20 * 1024 * 1024;
export const IMAGEM_MAX_BYTES = 5 * 1024 * 1024;
export const MAX_ANEXOS = 10;

export const TIPOS_DE_IMAGEM = ["image/png", "image/jpeg", "image/gif", "image/webp"];

/** Lê o jsonb com defesa: coluna ausente (migração atrasada) ou lixo vira []. */
export function anexosDe(v: unknown): AnexoEmail[] {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (a): a is AnexoEmail =>
      !!a && typeof a === "object" && typeof (a as AnexoEmail).url === "string" &&
      typeof (a as AnexoEmail).name === "string",
  );
}

export function formatarTamanho(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

/** Nome seguro para caminho do Storage, preservando a extensão. */
export function nomeSeguro(nome: string): string {
  const limpo = nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|-+$/g, "");
  return (limpo || "arquivo").slice(-80);
}

function esc(v: string): string {
  return v
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Bloco "Anexos" do e-mail (tabela com estilo inline — o que o Outlook entende). */
export function blocoDeAnexosHtml(anexos: AnexoEmail[], accent: string): string {
  if (anexos.length === 0) return "";
  const linhas = anexos
    .map((a) => {
      const tam = formatarTamanho(a.size);
      return `<tr><td style="padding:10px 12px;border:1px solid #e2e8f0;border-radius:10px;background-color:#f8fafc;">
<a href="${esc(a.url)}" target="_blank" style="color:${accent};text-decoration:none;font-weight:600;font-size:14px;">📎 ${esc(a.name)}</a>${
        tam ? `<span style="color:#94a3b8;font-size:12px;"> · ${tam}</span>` : ""
      }<br /><a href="${esc(a.url)}" target="_blank" style="color:#64748b;font-size:12px;text-decoration:underline;">Baixar arquivo</a>
</td></tr><tr><td style="height:8px;line-height:8px;font-size:0;">&nbsp;</td></tr>`;
    })
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;">
<tr><td style="padding-bottom:8px;color:#0f172a;font-size:13px;font-weight:700;">Anexos</td></tr>${linhas}</table>`;
}

export function blocoDeAnexosTexto(anexos: AnexoEmail[]): string {
  if (anexos.length === 0) return "";
  return `\n\nAnexos:\n${anexos.map((a) => `- ${a.name}: ${a.url}`).join("\n")}`;
}
