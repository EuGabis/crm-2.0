/**
 * Normaliza um telefone para o formato que a Cloud API do WhatsApp exige:
 * dígitos com CÓDIGO DO PAÍS, sem "+".
 *
 * Blindagem para aceitar QUALQUER país sem estragar número:
 * - Começa com "+" → é internacional (país explícito): usa os dígitos como estão
 *   (ex.: "+1 201 982-0060" → "12019820060"; "+351 912 345 678" → "351912345678").
 * - Já é BR com país (começa com 55 e tem 12–13 dígitos) → mantém.
 * - BR SEM país (10 ou 11 dígitos com DDD válido) → coloca o 55 na frente.
 * - Qualquer outro caso → devolve os dígitos como vieram (não inventa país).
 *
 * Regra prática: número estrangeiro DEVE ser salvo com o "+país" — aí funciona.
 * Só o brasileiro pode vir sem o 55 que a gente completa.
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

export function toWhatsAppNumber(raw: string | null | undefined): string {
  const trimmed = (raw ?? "").trim();
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return "";
  // Internacional explícito (tinha "+"): país já está nos dígitos.
  if (trimmed.startsWith("+")) return digits;
  // BR já com o código do país.
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) return digits;
  // BR sem país: fixo (10) ou celular (11) com DDD válido → completa o 55.
  if ((digits.length === 10 || digits.length === 11) && BR_DDD.has(digits.slice(0, 2))) {
    return "55" + digits;
  }
  // Formato desconhecido / internacional sem "+": manda como está (não adivinha).
  return digits;
}
