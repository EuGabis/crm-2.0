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
