import { normalize, type BotOption } from "./types";

/**
 * O curso que o lead escolhe na lista do bot — o que vira ETIQUETA no contato e
 * CURSO no card do funil.
 *
 * 🔴 Até 14/10/2026 o motor só guardava a resposta em `vars.curso` e nada mais:
 * o lead clicava "Comissário" e chegava ao vendedor sem etiqueta e com o card em
 * "Curso: selecionar…". As duas coisas que a equipe usa para filtrar a caixa e
 * montar o relatório por curso ficavam vazias justamente no lead do bot.
 *
 * Funções puras (sem banco) para terem teste: `npm run test:bot`.
 */

type NoAsk = { type?: string; var?: string; options?: unknown[]; marcaCurso?: boolean };

/**
 * Este nó é a pergunta do curso?
 *
 * `marcaCurso` explícito vale sempre. Sem ele, vale a pergunta de LISTA cuja
 * variável é `curso` — é como os fluxos do banco já estão escritos, e exigir a
 * marca obrigaria a reabrir e salvar cada bot para a correção valer.
 *
 * ⚠️ Só pergunta COM OPÇÕES: em texto livre a resposta pode ser qualquer coisa
 * ("Muito obrigado novamente Beatriz" já foi gravado como curso), e etiqueta ou
 * curso inventado a partir disso é pior que vazio.
 */
export function ehPerguntaDeCurso(node: NoAsk | null | undefined): boolean {
  if (!node || node.type !== "ask") return false;
  if (!Array.isArray(node.options) || node.options.length === 0) return false;
  if (typeof node.marcaCurso === "boolean") return node.marcaCurso;
  return normalize(node.var) === "curso";
}

const PALAVRAS_VAZIAS = new Set(["de", "da", "do", "das", "dos", "e", "em", "para", "a", "o"]);

/** Palavras significativas, sem acento e sem o plural ("engenheiros" = "engenheiro"). */
function palavras(s: string): string[] {
  return normalize(s)
    .split(/[^a-z0-9]+/)
    .filter((p) => p && !PALAVRAS_VAZIAS.has(p))
    .map((p) => (p.length > 3 && p.endsWith("s") ? p.slice(0, -1) : p));
}

const PREFIXO = "interessado";

/**
 * Sinônimos do negócio: a opção do bot usa o nome popular, a etiqueta usa a
 * sigla. "Mecânico" é a formação MMA (Mecânico de Manutenção Aeronáutica) —
 * definido pelo Gabriel em 14/10/2026. Chave = opção normalizada, valor = o que
 * vem depois de "INTERESSADO" na etiqueta.
 */
const SINONIMOS: Record<string, string> = {
  mecanico: "MMA",
};

/**
 * A etiqueta do catálogo que corresponde à opção escolhida.
 *
 * Ordem:
 *  1. `opt.tag` explícita (o nome é devolvido na grafia do catálogo, se existir);
 *  2. "INTERESSADO <opção>" exato;
 *  3. a ÚNICA etiqueta "INTERESSADO …" que contém todas as palavras da opção.
 *
 * ⚠️ Mais de uma candidata = nenhuma. "Piloto" casaria com "INTERESSADO PP" e
 * "INTERESSADO PC" se a regra fosse frouxa, e "Masterclass" com as quatro de
 * masterclass — etiquetar o lead com o curso errado é pior que deixar sem, porque
 * a partir dali o filtro da caixa passa a mentir. Nesses casos, quem configura o
 * bot preenche `tag` na opção.
 *
 * ⚠️ Só devolve etiqueta que EXISTE no catálogo (ou a explícita): o catálogo é
 * curado pelo admin, e o bot criando etiqueta nova é o que a 202609091600 veio
 * acabar.
 */
export function etiquetaDoCurso(
  catalogo: readonly string[],
  opt: Pick<BotOption, "title" | "value"> & { tag?: string },
): string | null {
  const porNome = (nome: string) => catalogo.find((c) => normalize(c) === normalize(nome)) ?? null;

  if (opt.tag?.trim()) return porNome(opt.tag) ?? opt.tag.trim();

  const rotulos = [opt.value, opt.title].filter((s): s is string => !!s?.trim());
  for (const r of rotulos) {
    const sigla = SINONIMOS[palavras(r).join(" ")];
    const viaSinonimo = sigla ? porNome(`${PREFIXO} ${sigla}`) : null;
    if (viaSinonimo) return viaSinonimo;
  }
  for (const r of rotulos) {
    const exata = porNome(`${PREFIXO} ${r}`);
    if (exata) return exata;
  }

  const interessados = catalogo.filter((c) => palavras(c)[0] === PREFIXO);
  for (const r of rotulos) {
    const alvo = palavras(r);
    if (!alvo.length) continue;
    const candidatas = interessados.filter((c) => {
      const tem = new Set(palavras(c).slice(1));
      return alvo.every((p) => tem.has(p));
    });
    if (candidatas.length === 1) return candidatas[0];
  }
  return null;
}

/**
 * O texto que vai para `opportunities.course`.
 *
 * `opt.curso` explícito vale sempre. Sem ele, se a opção é exatamente uma
 * formação da lista oficial (`CURSOS`), usa a grafia de lá; senão, o que o lead
 * escolheu ("Comissário"). ⚠️ Não chuta a formação: "Comissário" é "Comissário
 * de Bordo Teórico" ou "… + Selva"? Só o vendedor sabe, e ele troca no card.
 */
export function cursoDaOpcao(
  cursos: readonly string[],
  opt: Pick<BotOption, "title" | "value"> & { curso?: string },
): string | null {
  if (opt.curso?.trim()) return opt.curso.trim();
  const escolhido = (opt.value ?? opt.title ?? "").trim();
  if (!escolhido) return null;
  return cursos.find((c) => normalize(c) === normalize(escolhido)) ?? escolhido;
}

/** Acrescenta a etiqueta sem repetir (comparação sem caixa, como o catálogo). */
export function comEtiqueta(tags: readonly string[] | null | undefined, etiqueta: string): string[] | null {
  const atual = Array.isArray(tags) ? tags : [];
  if (atual.some((t) => normalize(t) === normalize(etiqueta))) return null;
  return [...atual, etiqueta];
}
