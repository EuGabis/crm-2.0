import { normalize } from "@/lib/bot/types";

/**
 * Rodízio por CURSO, por vendedor (2026-11-12).
 *
 * Pedido do Gabriel: o vendedor novo (Guilherme) começa atendendo só leads de
 * Comissário; depois Comissário + Mecânico; depois + Piloto; e por fim todos —
 * "sem mexer com os outros vendedores", e voltando à regra normal no fim.
 *
 * `location_members.cursos_rodizio` (text[]): NULL ou vazio = recebe todos os
 * cursos (todo mundo hoje). Preenchido = só entra no rodízio dos leads desses
 * cursos. Limpar a lista É a volta à regra normal — nada mais a desligar.
 *
 * Funções puras para terem teste (`npm run test:rodizio`).
 */

/**
 * Os grupos que o bot de Vendas grava no card ("Comissário", "Mecânico"...).
 * Medido em 12/11: 99% dos cards com curso usam exatamente estes nomes; o resto
 * é a formação completa escolhida à mão pelo vendedor ("Comissário de Bordo
 * Teórico"), que `grupoDoCurso` reduz ao grupo.
 */
export const GRUPOS_DE_CURSO = [
  "Comissário",
  "Mecânico",
  "Piloto",
  "Pós de Engenheiros",
  "Masterclass",
] as const;

const VAZIAS = new Set(["de", "da", "do", "das", "dos", "e", "em", "para", "a", "o"]);

function palavras(s: string): string[] {
  return normalize(s)
    .split(/[^a-z0-9]+/)
    .filter((p) => p && !VAZIAS.has(p))
    .map((p) => (p.length > 3 && p.endsWith("s") ? p.slice(0, -1) : p));
}

/**
 * O GRUPO do curso: "Comissário de Bordo Teórico" → "Comissário",
 * "Mecânico de Aeronaves Básico + Célula" → "Mecânico".
 *
 * ⚠️ Casa pelo COMEÇO do nome, não por "contém": "Combate ao Fogo Comissário" e
 * "Iniciação Boeing 737 para Mecânicos" são cursos avulsos, não a formação de
 * comissário/mecânico — por "contém" iriam para o rodízio errado.
 *
 * Curso fora dos grupos conhecidos devolve o próprio texto (aparado): ele só
 * casa com uma lista que tenha exatamente aquele curso. `null` = sem curso.
 */
export function grupoDoCurso(curso: string | null | undefined): string | null {
  const t = (curso ?? "").trim();
  if (!t) return null;
  const pc = palavras(t);
  if (pc[0] === "pos") return "Pós de Engenheiros"; // "Pós-Graduação … Engenheira"
  for (const g of GRUPOS_DE_CURSO) {
    const pg = palavras(g);
    if (pg.length && pg.every((p, i) => pc[i] === p)) return g;
  }
  return t;
}

/**
 * Este vendedor entra no rodízio deste lead?
 *
 * - Sem lista (NULL/vazia): sim, sempre — é a regra normal, e é o caso de todos
 *   os vendedores que não foram configurados.
 * - Com lista e lead SEM curso: não. O lead sem curso conhecido vai para quem
 *   atende tudo; entregar ao vendedor restrito um lead que talvez não seja do
 *   curso dele é o que a restrição existe para evitar.
 */
export function atendeCurso(
  permitidos: readonly string[] | null | undefined,
  cursoDoLead: string | null | undefined,
): boolean {
  const lista = (permitidos ?? []).filter((p) => p?.trim());
  if (!lista.length) return true;
  const g = grupoDoCurso(cursoDoLead);
  if (!g) return false;
  return lista.some((p) => normalize(grupoDoCurso(p) ?? p) === normalize(g));
}

/** Chave estável do grupo para os mapas de carga ("comissario"). */
export function chaveDoGrupo(curso: string | null | undefined): string | null {
  const g = grupoDoCurso(curso);
  return g ? normalize(g) : null;
}
