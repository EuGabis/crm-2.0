/**
 * Origem dos leads — regras puras (sem banco), com teste: `npm run test:origem`.
 * Ver migração 202610221000_origem_dos_leads.sql.
 */

/** Sem 0/O/1/I/L: o código é lido e às vezes redigitado pelo cliente. */
const ALFABETO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const TAM_CODIGO = 6;

export function gerarCodigo(rand: () => number = Math.random): string {
  let s = "";
  for (let i = 0; i < TAM_CODIGO; i++) s += ALFABETO[Math.floor(rand() * ALFABETO.length)];
  return s;
}

/**
 * O código que o botão do site põe na mensagem pronta: "… (cód. AB12CD)".
 * Aceita variações que o cliente produz ao editar ("cod AB12CD", "ref: ab12cd").
 * ⚠️ Só o formato COM o rótulo: um código solto de 6 letras casaria com palavras
 * comuns ("BRASIL") e ligaria o lead a um clique aleatório.
 */
export function extrairCodigo(texto: string | null | undefined): string | null {
  if (!texto) return null;
  const m = texto.match(/\b(?:c[oó]d(?:igo)?|ref)\.?\s*[:#]?\s*([a-z0-9]{6})\b/i);
  if (!m) return null;
  const c = m[1].toUpperCase();
  return [...c].every((ch) => ALFABETO.includes(ch)) ? c : null;
}

export type Clique = {
  gclid?: string | null;
  gbraid?: string | null;
  wbraid?: string | null;
  fbclid?: string | null;
  utm_source?: string | null;
};

/** De que plataforma veio o clique na página. Os ids de clique decidem antes das UTMs. */
export function plataformaDoClique(c: Clique): "google" | "meta" | "site" {
  if (c.gclid || c.gbraid || c.wbraid) return "google";
  if (c.fbclid) return "meta";
  const src = (c.utm_source ?? "").toLowerCase();
  if (/google|adwords|gads/.test(src)) return "google";
  if (/facebook|instagram|\bfb\b|\big\b|meta/.test(src)) return "meta";
  return "site";
}

/** O `referral` que a Cloud API manda na 1ª mensagem de anúncio click-to-WhatsApp. */
export type ReferralMeta = {
  source_url?: string;
  source_id?: string;
  source_type?: string;
  headline?: string;
  body?: string;
  ctwa_clid?: string;
};

export function origemDaMeta(r: ReferralMeta | null | undefined) {
  if (!r || (!r.source_id && !r.ctwa_clid && !r.source_url)) return null;
  return {
    plataforma: "meta" as const,
    via: "anuncio_whatsapp" as const,
    meta_source_id: r.source_id ?? null,
    meta_source_type: r.source_type ?? null,
    meta_source_url: r.source_url ?? null,
    meta_headline: r.headline ?? null,
    meta_body: r.body ?? null,
    ctwa_clid: r.ctwa_clid ?? null,
  };
}

/** Só dígitos — para casar o número do link wa.me com `whatsapp_channels.phone_e164`. */
export function soDigitos(s: string | null | undefined): string {
  return (s ?? "").replace(/\D/g, "");
}
