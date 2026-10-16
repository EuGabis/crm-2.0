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
 * sigla. Lista do Gabriel em 14/10/2026. Chave = opção normalizada (sem acento,
 * sem plural, sem "de"); valor = o que vem depois de "INTERESSADO".
 *
 * ⚠️ "Piloto" dá DUAS etiquetas (PP e PC): o bot não pergunta qual das duas
 * formações, e marcar só uma esconderia o lead do filtro da outra.
 */
const SINONIMOS: Record<string, string[]> = {
  mecanico: ["MMA"],
  piloto: ["PP", "PC"],
  "pos eng": ["PÓS ENGENHEIROS"],
  "pos engenheiro": ["PÓS ENGENHEIROS"],
  comissario: ["COMISSÁRIO"],
};

/**
 * A etiqueta do catálogo que corresponde à opção escolhida.
 *
 * Ordem:
 *  1. `opt.tag` explícita (o nome é devolvido na grafia do catálogo, se existir);
 *  2. os SINÔNIMOS do negócio (Mecânico → MMA, Piloto → PP + PC);
 *  3. "INTERESSADO <opção>" exato;
 *  4. a ÚNICA etiqueta "INTERESSADO …" que contém todas as palavras da opção.
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
export function etiquetasDoCurso(
  catalogo: readonly string[],
  opt: Pick<BotOption, "title" | "value"> & { tag?: string },
): string[] {
  const porNome = (nome: string) => catalogo.find((c) => normalize(c) === normalize(nome)) ?? null;

  if (opt.tag?.trim()) return [porNome(opt.tag) ?? opt.tag.trim()];

  const rotulos = [opt.value, opt.title].filter((s): s is string => !!s?.trim());
  for (const r of rotulos) {
    const siglas = SINONIMOS[palavras(r).join(" ")];
    const achadas = (siglas ?? [])
      .map((sg) => porNome(`${PREFIXO} ${sg}`))
      .filter((x): x is string => !!x);
    if (achadas.length) return achadas;
  }
  for (const r of rotulos) {
    const exata = porNome(`${PREFIXO} ${r}`);
    if (exata) return [exata];
  }

  const interessados = catalogo.filter((c) => palavras(c)[0] === PREFIXO);
  for (const r of rotulos) {
    const alvo = palavras(r);
    if (!alvo.length) continue;
    const candidatas = interessados.filter((c) => {
      const tem = new Set(palavras(c).slice(1));
      return alvo.every((p) => tem.has(p));
    });
    if (candidatas.length === 1) return candidatas;
  }
  return [];
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

/** Acrescenta as etiquetas sem repetir (comparação sem caixa, como o catálogo).
 *  `null` = nada a acrescentar. */
export function comEtiquetas(
  tags: readonly string[] | null | undefined,
  etiquetas: readonly string[],
): string[] | null {
  const atual = Array.isArray(tags) ? [...tags] : [];
  let mudou = false;
  for (const e of etiquetas) {
    if (atual.some((t) => normalize(t) === normalize(e))) continue;
    atual.push(e);
    mudou = true;
  }
  return mudou ? atual : null;
}

/**
 * Nome de curso para o RELATÓRIO, a partir das etiquetas do contato.
 *
 * Rede para o lead cujo card ficou sem `course` (card criado depois da resposta,
 * marcado à mão na conversa, triagem anterior a 14/10) mas que TEM a etiqueta
 * "INTERESSADO …". Os nomes saem iguais aos que o bot grava no card
 * ("Mecânico", "Piloto"…), senão a mesma formação viraria duas linhas.
 * PP e PC viram "Piloto" (é o que o bot grava). Sem etiqueta de curso → null.
 */
const CURSO_DA_SIGLA: Record<string, string> = {
  mma: "Mecânico",
  pp: "Piloto",
  pc: "Piloto",
  "pos engenheiro": "Pós de Engenheiros",
  comissario: "Comissário",
};

export function cursoDasEtiquetas(tags: readonly string[] | null | undefined): string | null {
  for (const t of tags ?? []) {
    const p = palavras(t);
    if (p[0] !== PREFIXO || p.length < 2) continue;
    const resto = p.slice(1).join(" ");
    if (CURSO_DA_SIGLA[resto]) return CURSO_DA_SIGLA[resto];
    if (resto.startsWith("masterclas")) return "Masterclass";
    // Grafia do próprio catálogo, sem o prefixo.
    return t.trim().replace(/^interessad[oa]s?\s+/i, "");
  }
  return null;
}
