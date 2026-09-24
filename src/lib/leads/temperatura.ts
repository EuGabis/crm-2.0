/**
 * Temperatura do lead a partir do desfecho da triagem do bot.
 * Compartilhada entre a caixa de entrada (client) e o FUP de perdido quente
 * (servidor) — ver `bot-desfechos.ts`.
 */
export type Desfecho = { pontos: number | null; limiar: number | null };

export type Temperatura = "frio" | "quente" | null;

/**
 * A temperatura do lead, ou `null` quando o fluxo não pontua.
 *
 * 🔴 **Decide pela ARITMÉTICA, não pelo texto de `resultado`.** A tentação era
 * `resultado === "frio"`, e ela quebra por dois motivos:
 *
 *  1. os valores saem de `hotValue`/`coldValue` do nó `score`, que são
 *     **configuráveis no editor de bot** — renomear "frio" para "morno" apagaria
 *     o selo da tela sem ninguém relacionar as duas coisas;
 *  2. o fluxo da SECRETARIA grava o ASSUNTO em `resultado` ("docs", "outros"),
 *     e comparar texto ali classificaria assunto como temperatura.
 *
 * `pontos` e `limiar` são o par que só existe quando houve nota: a secretaria
 * grava os dois NULL de propósito — "NULL diz não pontuou; um zero diria
 * pontuou zero, que é outra coisa" (202609031955).
 *
 * Exportada para ter teste: a regra é curta, e errar aqui pinta de frio um lead
 * quente sem gerar erro nenhum.
 */
export function temperaturaDe(d: Desfecho | undefined): Temperatura {
  if (!d) return null;
  const { pontos, limiar } = d;
  if (pontos == null || limiar == null) return null;
  if (!Number.isFinite(Number(pontos)) || !Number.isFinite(Number(limiar))) return null;
  return Number(pontos) < Number(limiar) ? "frio" : "quente";
}

