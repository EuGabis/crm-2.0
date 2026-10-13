import { normalize, type BotOption } from "./types";

/**
 * Chave do peso de uma opção no nó `score`.
 *
 * 🔴 **É o VALOR da opção, não o título** — porque é o valor que o motor guarda
 * na variável (`vars[node.var] = opt.value ?? opt.title`). O editor gravava pelo
 * título, e onde os dois diferem o peso não era achado e valia ZERO: em
 * 13/10/2026 o lead João Lucas (11 94722-1599) escolheu "Em 2 ou 3 meses" (6) +
 * "Parcelado no cartão" (8) e saiu FRIO com 8 em vez de quente com 14 — o título
 * é a forma curta que cabe na lista do WhatsApp (24 caracteres), o valor é a
 * frase inteira ("Nos próximos 2 ou 3 meses").
 */
export function chaveDoPeso(opt: Pick<BotOption, "title" | "value">): string {
  return normalize(opt.value ?? opt.title);
}

/**
 * Peso da resposta guardada na variável.
 *
 * ⚠️ Procura pela chave do VALOR e, não achando, pela do TÍTULO da opção
 * escolhida: fluxos salvos antes da correção do editor têm os pesos pelo título,
 * e sem esse segundo passo eles continuariam somando zero até alguém reabrir e
 * salvar cada bot.
 */
export function pesoDaResposta(
  tabela: Record<string, number>,
  opcoes: Pick<BotOption, "title" | "value">[] | undefined,
  resposta: unknown,
): number {
  const chave = normalize(resposta == null ? "" : String(resposta));
  if (chave in tabela) return Number(tabela[chave]) || 0;
  const opt = (opcoes ?? []).find((o) => chaveDoPeso(o) === chave || normalize(o.title) === chave);
  if (opt) {
    const porTitulo = normalize(opt.title);
    if (porTitulo in tabela) return Number(tabela[porTitulo]) || 0;
  }
  return 0;
}
