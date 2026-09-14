/**
 * O texto que o bot envia: troca as variáveis e limpa a sobra.
 *
 * Mora fora do motor para poder ser TESTADO: `engine.ts` importa o cliente da
 * Meta e o Supabase, então um teste que o carregasse precisaria de ambiente.
 * Aqui é função pura — mesmo motivo de `devolvivel`, `limiteDoTique` e
 * `mesclarMensagens` existirem separadas.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Espaço HORIZONTAL: tudo o que `\s` cobre, MENOS a quebra de linha.
 *
 * 🔴 É a correção de 2026-09-14. A limpeza usava `\s`, e `\s` inclui `\n` —
 * então `.replace(/\s{2,}/g, " ")` engolia a linha em branco entre dois
 * parágrafos e devolvia tudo grudado. O relato foi exatamente esse: *"no bot da
 * mensagem de fim de semana, ao pular linha, quando o bot responde, não pula na
 * mensagem"*.
 *
 * ⚠️ **E era INTERMITENTE, o que faz o defeito parecer coisa do WhatsApp.** Um
 * Enter (`\n` sozinho) sobrevivia, porque `\s{2,}` precisa de dois caracteres.
 * Quem pulava linha UMA vez via funcionar; quem pulava DUAS — o jeito normal de
 * separar parágrafo — ou colava texto com CRLF do Windows (`\r\n` já são dois)
 * via a mensagem chegar numa linha só. Medido antes de mexer:
 *
 *     "Olá!\nBom dia."            -> preservava
 *     "Olá!\n\nNosso horário..."  -> "Olá! Nosso horário..."
 *     "Olá!\r\nBom dia."          -> "Olá! Bom dia."
 *
 * ⚠️ A limpeza precisa continuar existindo: ela é o que evita "Perfeito, !" e
 * o espaço duplo que sobra quando `{{first_name}}` sai da frase. O erro nunca
 * foi limpar — foi limpar a QUEBRA junto com o espaço.
 */
const HORIZ = "[^\\S\\n]";
const h = (padrao: string) => new RegExp(padrao.replaceAll("H", HORIZ), "g");

export function renderTextoDoBot(text: string, vars: Record<string, any>): string {
  // first_name é o único nome opcional. Quando vazio (a pessoa recusou/não deu o
  // nome), remove o placeholder E a pontuação órfã ao redor pra não sair
  // "Perfeito, !" nem ", clique...".
  const firstName = vars.first_name != null ? String(vars.first_name).trim() : "";
  // CRLF/CR viram LF na entrada: o resto passa a lidar com UMA forma de quebra,
  // e o `\r` deixa de contar como "segundo espaço".
  let out = text.replace(/\r\n?/g, "\n");
  if (!firstName) {
    /*
     * ⚠️ O espaço em volta do placeholder é HORIZONTAL. Com `\s*`, um
     * "{{first_name}},\nBom dia" sem nome comia a quebra junto e colava as duas
     * linhas — o mesmo defeito, por outra porta.
     */
    out = out
      // "{{first_name}}, " (nome + pontuação logo depois)
      .replace(h("\\{\\{\\s*first_name\\s*\\}\\}H*[,:;–-]H*"), "")
      // ", {{first_name}}" (pontuação antes) ou o placeholder sozinho
      .replace(h("H*[,:;–-]?H*\\{\\{\\s*first_name\\s*\\}\\}"), "");
  }
  out = out.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k) => (vars[k] != null ? String(vars[k]) : ""));
  out = out
    // espaço antes de pontuação (sobra de placeholder removido)
    .replace(h("H+([,.!?;:])"), "$1")
    // 2+ espaços viram 1 — mas a QUEBRA fica
    .replace(h("H{2,}"), " ")
    // espaço grudado na quebra (indentação de quem digitou) some
    .replace(h("H*\\nH*"), "\n")
    // no máximo UMA linha em branco: três Enters não viram um buraco no balão
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  // Se removemos o nome do começo, recapitaliza a 1ª letra.
  if (!firstName && out) out = out[0].toUpperCase() + out.slice(1);
  return out;
}
