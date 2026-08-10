import { createHmac, timingSafeEqual } from "crypto";

/**
 * Assinatura dos links de descadastro (unsubscribe).
 *
 * Reusa o AUTOMATION_SECRET (segredo servidor) como chave HMAC — assim o link
 * `?c=<contactId>&s=<hmac>` não pode ser forjado para descadastrar terceiros.
 * Só o servidor conhece o segredo; a URL não expõe nada além do id.
 */
function secret(): string {
  return process.env.AUTOMATION_SECRET ?? "";
}

export function signUnsubscribe(contactId: string): string {
  return createHmac("sha256", secret()).update(contactId).digest("hex");
}

export function verifyUnsubscribe(contactId: string, sig: string): boolean {
  if (!sig) return false;
  const expected = signUnsubscribe(contactId);
  if (expected.length !== sig.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(sig, "utf8"));
  } catch {
    return false;
  }
}

export function unsubscribeUrl(contactId: string, campaignId?: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const c = encodeURIComponent(contactId);
  const s = signUnsubscribe(contactId);
  const q = campaignId ? `&campaign=${encodeURIComponent(campaignId)}` : "";
  return `${base}/api/marketing/unsubscribe?c=${c}&s=${s}${q}`;
}
