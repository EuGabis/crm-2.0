/**
 * Horário REAL de uma mensagem recebida da Meta.
 *
 * ⚠️ O webhook gravava a mensagem com o horário em que ELE a processou. Em
 * 2026-10-05 o webhook ficou horas apontando para um domínio morto; quando foi
 * corrigido, a Meta reenviou as mensagens retidas e todas entraram com o
 * horário do reenvio. Resultado: o CRM achava que o cliente tinha acabado de
 * escrever, liberava texto livre, e a Meta recusava com #131047 ("mais de 24h
 * desde a última resposta do cliente") — ela sabe o horário verdadeiro.
 *
 * A janela de 24h (composer e rota de envio) é calculada a partir do horário
 * da última mensagem de entrada, então esse horário tem de ser o da Meta.
 *
 * `timestamp` é o campo da Meta em SEGUNDOS desde 1970, como string.
 * Inválido, ausente ou no futuro (relógio torto) → usa o horário atual.
 */
export function horarioDaMensagem(timestamp: unknown, agoraMs = Date.now()): Date {
  const seg = Number(timestamp);
  if (!Number.isFinite(seg) || seg <= 0) return new Date(agoraMs);
  const ms = seg * 1000;
  // Mais de 5 min no futuro não é mensagem real: desconfia e usa agora.
  if (ms > agoraMs + 5 * 60_000) return new Date(agoraMs);
  return new Date(ms);
}

/** Passou da janela de 24h da Meta — qualquer resposta em texto livre seria recusada. */
export function foraDaJanela(horario: Date, agoraMs = Date.now()): boolean {
  return agoraMs - horario.getTime() > 24 * 3600_000;
}
