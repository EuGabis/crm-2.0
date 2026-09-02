/**
 * Normaliza um telefone para o formato que a Cloud API do WhatsApp exige:
 * dígitos com CÓDIGO DO PAÍS, sem "+".
 *
 * Blindagem para aceitar QUALQUER país sem estragar número:
 * - Começa com "+" → é internacional (país explícito): usa os dígitos como estão
 *   (ex.: "+1 201 982-0060" → "12019820060"; "+351 912 345 678" → "351912345678").
 * - Já é BR com país (começa com 55 e tem 12–13 dígitos) → mantém.
 * - BR SEM país → coloca o 55 na frente **só quando o número tem FORMA de
 *   número brasileiro** (ver `pareceBrasileiro`).
 * - Qualquer outro caso → devolve os dígitos como vieram (não inventa país).
 *
 * ⚠️ **O DDD sozinho NÃO decide, e isso era um bug em produção (02/09/2026).**
 * A versão anterior prefixava 55 em qualquer número de 10–11 dígitos cujos dois
 * primeiros fossem um DDD válido — e vários códigos de país COLIDEM com DDD
 * brasileiro. Medido no banco:
 *
 *   61412914627  (+61 412 914 627, Austrália) → 5561412914627   ← "61" = DF
 *   15149635422  (+1 514 963 5422, Canadá)    → 5515149635422   ← "15" = Sorocaba
 *   16472895906  (+1 647 289 5906, Canadá)    → 5516472895906   ← "16" = Ribeirão
 *
 * Os três viraram números inexistentes, e a Meta respondeu **#131026 Message
 * Undeliverable**. Eram 219 contatos nessa situação. Todos tinham ESCRITO para
 * nós (a entrada funciona: quem resolve o número é a Meta) e nenhum jamais
 * recebeu resposta — o que fazia parecer erro da conta, não nosso.
 */

// DDDs válidos no Brasil (evita "completar 55" num número estrangeiro de 10–11
// dígitos cujo começo não é um DDD real).
const BR_DDD = new Set([
  "11", "12", "13", "14", "15", "16", "17", "18", "19",
  "21", "22", "24", "27", "28",
  "31", "32", "33", "34", "35", "37", "38",
  "41", "42", "43", "44", "45", "46", "47", "48", "49",
  "51", "53", "54", "55",
  "61", "62", "63", "64", "65", "66", "67", "68", "69",
  "71", "73", "74", "75", "77", "79",
  "81", "82", "83", "84", "85", "86", "87", "88", "89",
  "91", "92", "93", "94", "95", "96", "97", "98", "99",
]);

/**
 * O número tem FORMA de telefone brasileiro sem o código do país?
 *
 * Exige DDD válido **e** a forma do assinante, que é o que separa um número
 * brasileiro de um estrangeiro cujo código de país parece um DDD:
 *   - celular: 11 dígitos, e o assinante começa com **9** (obrigatório no Brasil
 *     desde 2016, em todos os DDDs);
 *   - fixo: 10 dígitos, e o assinante começa com **2 a 5**.
 *
 * ⚠️ Sobra UM caso genuinamente ambíguo: 10 dígitos que são, ao mesmo tempo,
 * fixo brasileiro plausível e internacional plausível (`9549373665` = "(95)
 * 4937-3665" ou "+1 954 937 3665"). Pelos dígitos não há como decidir, e aqui a
 * escolha é tratar como brasileiro — é o caso muito mais comum nesta base. Para
 * esses, o que resolve é o número estar salvo com "+", e é o que a migração
 * 202609021*, junto com o webhook, garante daqui para frente.
 */
function pareceBrasileiro(digits: string): boolean {
  if (!BR_DDD.has(digits.slice(0, 2))) return false;
  const assinante = digits.slice(2);
  if (digits.length === 11) return assinante.startsWith("9");
  if (digits.length === 10) return /^[2-5]/.test(assinante);
  return false;
}

export function toWhatsAppNumber(raw: string | null | undefined): string {
  const trimmed = (raw ?? "").trim();
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return "";
  // Internacional explícito (tinha "+"): país já está nos dígitos.
  if (trimmed.startsWith("+")) return digits;
  // BR já com o código do país.
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) return digits;
  // BR sem país: só completa o 55 quando a FORMA é de número brasileiro.
  if (pareceBrasileiro(digits)) return "55" + digits;
  // Formato desconhecido / internacional sem "+": manda como está (não adivinha).
  return digits;
}
