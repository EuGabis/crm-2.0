import { brand } from "@/lib/config/brand";

/**
 * Remetente dos e-mails transacionais.
 *
 * Usa `EMAIL_FROM`, MAS ignora o remetente de teste do Resend (`@resend.dev`),
 * que só entrega ao dono da conta e derruba envios em produção. Se `EMAIL_FROM`
 * estiver vazio ou apontar para resend.dev, cai no domínio verificado da marca.
 */
const VERIFIED_DEFAULT = `${brand.name} <nao-responder@news.litoaviation.com>`;

export function senderAddress(): string {
  const configured = process.env.EMAIL_FROM?.trim();
  if (!configured || /@resend\.dev>?/i.test(configured)) {
    return VERIFIED_DEFAULT;
  }
  return configured;
}

/**
 * Endereço de resposta (Reply-To) dos e-mails transacionais. Não precisa ser do
 * domínio verificado — é só para onde vão as respostas. Deixar de ser "no-reply
 * puro" ajuda a reputação/entregabilidade. Retorna null se EMAIL_REPLY_TO não estiver
 * definido (aí o e-mail sai sem Reply-To).
 */
export function replyToAddress(): string | null {
  const v = process.env.EMAIL_REPLY_TO?.trim();
  return v && v.includes("@") ? v : null;
}
