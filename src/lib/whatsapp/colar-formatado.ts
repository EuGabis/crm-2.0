/**
 * Converte o HTML do clipboard (Word, Google Docs, uma página, ou o próprio
 * balão de uma mensagem do CRM copiado) para texto com a formatação do
 * WHATSAPP: `*negrito*`, `_itálico_`, `~tachado~`, ```` ```monoespaçado``` ````.
 *
 * ⚠️ Pedido do Gabriel: colar um texto formatado (lista de preço com título
 * em negrito, por exemplo) deve "vir com o formato copiado" — hoje um
 * `<textarea>` só guarda texto puro, então colar ali sempre jogou fora
 * negrito/itálico/listas de quem copiou de fora. Como o WhatsApp representa
 * formatação com SÍMBOLOS no próprio texto (não é rich text), a saída certa
 * não é preservar HTML: é traduzir a formatação visual para os símbolos que o
 * WhatsApp do cliente vai renderizar.
 *
 * ⚠️ Função PURA, sem `DOMParser` — este módulo roda no `onPaste` do composer
 * (navegador) mas precisa ser testável no Node, que não tem DOM. É
 * reconhecidamente "melhor esforço": HTML real tem casos que um regex não
 * cobre, e por isso cada passo é documentado com o caso que motivou.
 *
 * ⚠️ Google Docs/Gmail NÃO usam `<strong>`/`<em>` — eles exportam
 * `<span style="font-weight:700">`/`font-style:italic` em qualquer tag. É o
 * caso mais comum de "texto formatado colado de fora" numa equipe que escreve
 * em Doc antes de mandar pro CRM, por isso o casamento é por TAG ou por
 * ESTILO, não só por nome de tag.
 */

/** Remove o que o navegador manda sem fazer parte do texto visível. */
function removerLixo(html: string): string {
  let h = html.replace(/<!--[\s\S]*?-->(?!.*<!--\[if)/g, (m) =>
    // Mantém os comentários StartFragment/EndFragment — são o DELIMITADOR do
    // recorte real (ver `extrairFragmento`), não lixo a apagar aqui.
    /StartFragment|EndFragment/.test(m) ? m : "",
  );
  // <script>/<style> têm CONTEÚDO que não é texto da mensagem — removidos
  // por inteiro, senão uma folha de estilo de uma página vira texto na nota.
  h = h.replace(/<script[\s\S]*?<\/script>/gi, "");
  h = h.replace(/<style[\s\S]*?<\/style>/gi, "");
  h = h.replace(/<head[\s\S]*?<\/head>/gi, "");
  return h;
}

/**
 * Word/Office marcam o trecho realmente selecionado entre estes comentários;
 * sem recortar, o clipboard às vezes traz a página INTEIRA em volta da
 * seleção (cabeçalho, menu) e tudo isso viraria texto da mensagem.
 */
function extrairFragmento(html: string): string {
  const ini = html.indexOf("<!--StartFragment-->");
  const fim = html.indexOf("<!--EndFragment-->");
  if (ini === -1 || fim === -1 || fim <= ini) return html;
  return html.slice(ini + "<!--StartFragment-->".length, fim);
}

/** `<strong>x</strong>` OU `<span style="font-weight:700">x</span>` → mesmo tratamento. */
function envolverPorTagOuEstilo(
  html: string,
  tags: string[],
  padraoEstilo: string,
  marcador: string,
): string {
  const nomes = tags.join("|");
  const envolver = (inner: string): string => {
    // Vazio (ou só espaço) não ganha marcador: `**` não é negrito nenhum, é
    // dois asteriscos soltos no meio do texto.
    if (!inner.replace(/<[^>]+>/g, "").trim()) return inner;
    // O `*`/`_`/`~` tem de colar NO TEXTO para o WhatsApp reconhecer — com
    // espaço entre o marcador e a palavra ele não formata nada. Por isso o
    // espaço de dentro da tag (`<b> Básico </b>`) sai para FORA do marcador.
    const antes = inner.match(/^\s*/)?.[0] ?? "";
    const depois = inner.match(/\s*$/)?.[0] ?? "";
    const meio = inner.slice(antes.length, inner.length - depois.length);
    if (!meio) return inner;
    return `${antes}${marcador}${meio}${marcador}${depois}`;
  };
  let out = html.replace(
    new RegExp(`<(?:${nomes})(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:${nomes})>`, "gi"),
    (_m, inner) => envolver(inner),
  );
  out = out.replace(
    new RegExp(`<([a-z][a-z0-9]*)([^>]*\\bstyle="[^"]*${padraoEstilo}[^"]*"[^>]*)>([\\s\\S]*?)<\\/\\1>`, "gi"),
    (_m, _tag, _attrs, inner) => envolver(inner),
  );
  return out;
}

const ENTIDADES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodificarEntidades(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (m, nome) => ENTIDADES[nome.toLowerCase()] ?? m);
}

/** Nunca deixa um marcador abraçando só espaço (`* *`) — seria formatação fantasma. */
function limparMarcadoresVazios(s: string): string {
  return s
    .replace(/\*\s*\*/g, "")
    .replace(/_\s*_/g, "")
    .replace(/~\s*~/g, "")
    .replace(/```\s*```/g, "");
}

function normalizarLinhas(s: string): string {
  const linhas = s.split("\n").map((l) => l.replace(/[^\S\n]+$/, "").replace(/^[^\S\n]+/, ""));
  // No máximo UMA linha em branco entre parágrafos — fonte com `<br><br><br>`
  // não pode virar uma página de linhas vazias.
  const out: string[] = [];
  let vazias = 0;
  for (const l of linhas) {
    if (l.trim() === "") {
      vazias++;
      if (vazias <= 1) out.push("");
    } else {
      vazias = 0;
      out.push(l);
    }
  }
  return out.join("\n").trim();
}

/**
 * ⚠️ Só vale a pena interceptar o paste quando o HTML carrega algo que o
 * `text/plain` do mesmo clipboard NÃO carregaria: negrito, itálico, tachado,
 * monoespaçado, lista ou tabela. Texto puro (sem nenhuma dessas tags/estilos)
 * é melhor deixar passar pelo `text/plain` nativo do navegador — ele já
 * preserva quebra de linha sozinho, e evita reprocessar à toa um parágrafo
 * copiado do próprio WhatsApp Web.
 */
export function temFormatacaoRelevante(html: string): boolean {
  return /<(b|strong|i|em|s|strike|del|code|pre|li|tr)\b|style="[^"]*(font-weight\s*:\s*(bold|[6-9]00)|font-style\s*:\s*italic|text-decoration[^;"]*line-through)/i.test(
    html,
  );
}

export function htmlParaWhatsapp(htmlOriginal: string): string {
  let h = extrairFragmento(htmlOriginal);
  h = removerLixo(h);

  // Listas: o traço nasce na ABERTURA do item; a quebra de linha entre um
  // item e o próximo vem do FECHAMENTO (`</li>`, junto dos outros blocos,
  // dois passos abaixo) — se os dois adicionassem quebra, cada item ganharia
  // uma linha em branco a mais entre si.
  h = h.replace(/<li(?:\s[^>]*)?>/gi, "- ");

  // Formatação inline — PRECISA vir antes de apagar as tags, senão não sobra
  // marca nenhuma de onde era negrito/itálico.
  h = envolverPorTagOuEstilo(h, ["b", "strong"], "font-weight\\s*:\\s*(?:bold|[6-9]00)", "*");
  h = envolverPorTagOuEstilo(h, ["i", "em"], "font-style\\s*:\\s*italic", "_");
  h = envolverPorTagOuEstilo(
    h,
    ["s", "strike", "del"],
    "text-decoration[^;\"]*line-through",
    "~",
  );
  h = envolverPorTagOuEstilo(h, ["code", "pre"], "font-family[^;\"]*\\bmono", "```");

  // Blocos (parágrafo, célula, linha de tabela, título) → quebra de linha.
  h = h.replace(/<br\s*\/?>/gi, "\n");
  h = h.replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n");

  // O que sobrou não é texto da mensagem.
  h = h.replace(/<[^>]+>/g, "");
  h = decodificarEntidades(h);
  h = limparMarcadoresVazios(h);
  return normalizarLinhas(h);
}
