import { contarRecortes, type LeadContado } from "./quadro-leads";

/**
 * O relatório por CURSO marcado, na aba "Leads do dia".
 *
 * Pedido do Gabriel (2026-09-22): *"Leads tem os cursos marcados — adicione a
 * opção de ver um relatório por cursos e a opção de filtro de datas e
 * responsável. Precisamos de um relatório detalhado dos leads de cada curso
 * marcado."*
 *
 * 🔴 **Não precisou de migração nem de rota nova, e isso é a decisão central.**
 * A rota `/api/relatorios/leads-diarios` já devolve uma LINHA POR LEAD com
 * `curso` (202609092130) e `atendente`/`contato`/`telefone` (202609161400) —
 * mesmo desenho de `sla_conversations`. Agrupar por curso é recortar o que já
 * está na mão; uma função SQL nova traria de volta o defeito que aquele desenho
 * evita: **dois lugares somando "entrou"**, para discordarem na primeira
 * mudança. O período continua vindo do seletor do topo, e a mesma resposta serve
 * o gráfico diário, o quadro por atendente e este relatório.
 *
 * ⚠️ **Mede o que ENTROU pelo bot no período, não o acervo do funil.** O curso
 * mora em `opportunities.course` e a função casa a oportunidade mais recente do
 * contato; um card com curso marcado cujo lead não passou pela triagem (criado à
 * mão, ou "Enviar para pipeline" de um contato antigo) **não aparece aqui**. É a
 * mesma régua do card "Cursos marcados" logo acima — e é de propósito: dois
 * números de "leads do curso X" na mesma tela, com definições diferentes, é
 * exatamente o que faz ninguém confiar no relatório.
 *
 * Fica em `lib/` para rodar em teste sem JSX — a regra é pequena e o estrago de
 * ela divergir da lista é invisível em revisão de código.
 */

/** O mínimo que este relatório precisa ler de um lead. */
export interface LeadDeCurso extends LeadContado {
  /** Curso marcado no card do funil. `null` = ninguém marcou. */
  curso: string | null;
  /** Com quem o lead está AGORA. `null` = ninguém assumiu. */
  atendente: string | null;
}

/**
 * A linha dos leads SEM curso marcado.
 *
 * ⚠️ **Ela é uma LINHA do relatório, não uma nota de rodapé** — e é a mais
 * importante. Medido no print do pedido: 184 de 6.052 leads têm curso marcado.
 * Um quadro que mostrasse só os 184 faria "88 em Mecânico de Aeronaves" parecer
 * a operação inteira, quando a leitura verdadeira é "quase ninguém marcou". É a
 * mesma decisão de "Sem responsável" ser uma linha no quadro por atendente.
 */
export const SEM_CURSO = "__sem_curso__";

/** Valor do seletor para "leads que ninguém assumiu". */
export const SEM_RESPONSAVEL = "__sem_responsavel__";

/** Uma linha do relatório por curso. */
export interface LinhaDeCurso {
  /** Nome do curso, ou `SEM_CURSO`. */
  curso: string;
  recebeu: number;
  qualificados: number;
  frios: number;
  finalizadas: number;
  ganhas: number;
  /** Quantos leads deste curso cada atendente tem hoje (id → n). */
  porAtendente: Record<string, number>;
}

/**
 * Filtra por responsável. `""` = todos.
 *
 * ⚠️ "Sem responsável" precisa de um valor PRÓPRIO: com string vazia para os
 * dois, escolher "sem responsável" seria indistinguível de não filtrar — e o
 * lead que ninguém assumiu é justamente o que se quer poder isolar.
 */
export function filtrarPorResponsavel<T extends { atendente: string | null }>(
  leads: T[],
  valor: string
): T[] {
  if (!valor) return leads;
  if (valor === SEM_RESPONSAVEL) return leads.filter((l) => !l.atendente);
  return leads.filter((l) => l.atendente === valor);
}

/**
 * Os leads de UM curso.
 *
 * 🔴 **É esta função que a lista aberta pelo clique usa** — a mesma que alimenta
 * a contagem em `agruparPorCurso`. Contado de um jeito e filtrado de outro, o
 * quadro diria "88" abrindo uma lista de 86, sem erro nenhum. Foi por isso que
 * `noRecorte` virou função compartilhada em 16/09, e a lição vale igual aqui.
 */
export function leadsDoCurso<T extends LeadDeCurso>(leads: T[], curso: string): T[] {
  if (curso === SEM_CURSO) return leads.filter((l) => !l.curso);
  return leads.filter((l) => l.curso === curso);
}

/**
 * Agrupa por curso, do maior para o menor, com os sem marcação no FIM.
 *
 * ⚠️ O desempate é alfabético e não "a ordem em que apareceram": com vários
 * cursos empatados em 1 lead, a ordem de chegada faz a tabela embaralhar entre
 * dois carregamentos do mesmo período — e quem está comparando dois recortes
 * acha que o dado mudou.
 */
export function agruparPorCurso<T extends LeadDeCurso>(leads: T[]): LinhaDeCurso[] {
  const nomes = new Set<string>();
  let temSemCurso = false;
  for (const l of leads) {
    if (l.curso) nomes.add(l.curso);
    else temSemCurso = true;
  }

  const linhas = [...nomes].map((curso) => linhaDe(leads, curso));
  linhas.sort((a, b) => b.recebeu - a.recebeu || a.curso.localeCompare(b.curso, "pt-BR"));
  if (temSemCurso) linhas.push(linhaDe(leads, SEM_CURSO));
  return linhas;
}

function linhaDe<T extends LeadDeCurso>(leads: T[], curso: string): LinhaDeCurso {
  const dele = leadsDoCurso(leads, curso);
  const porAtendente: Record<string, number> = {};
  for (const l of dele) {
    if (l.atendente) porAtendente[l.atendente] = (porAtendente[l.atendente] ?? 0) + 1;
  }
  return { curso, ...contarRecortes(dele), porAtendente };
}

/**
 * Os totais do recorte, para o cabeçalho do relatório.
 *
 * `comCurso` e `semMarcacao` somam `leads.length` por construção — é o que
 * mantém a frase "X de Y leads com curso marcado" verdadeira sob qualquer
 * filtro.
 */
export interface LinhaCursoXlsx {
  curso: string;
  leads: number;
  quentes: number;
  frios: number;
  finalizadas: number;
  ganhas: number;
  /** "Alberto: 12 · Paulo: 3", já montado. */
  atendentes: string;
}

export interface LeadDeCursoXlsx {
  curso: string;
  contato: string;
  telefone: string;
  /** "AAAA-MM-DD" — convertido para BR na gravação. */
  dia: string;
  responsavel: string;
  /** "quente" | "frio" | "sem nota" | o assunto do fluxo da secretaria. */
  temperatura: string;
  pontos: number | null;
  situacao: string;
}

/** O que a planilha precisa além do que `LeadDeCurso` exige. */
export interface LeadExportavel extends LeadDeCurso {
  contato: string | null;
  telefone: string | null;
  dia: string;
  pontos: number | null;
}

/** Nome do curso como a planilha e a tela escrevem. */
export const SEM_CURSO_ROTULO = "Sem curso marcado";

/**
 * As duas abas de curso da planilha, montadas a partir das MESMAS linhas que a
 * tela desenha.
 *
 * 🔴 Mora aqui, e não no `leads-xlsx.ts`, por dois motivos: reusa
 * `agruparPorCurso`/`leadsDoCurso` (então a planilha não pode discordar da
 * tela), e roda em teste sem carregar o `exceljs`.
 *
 * ⚠️ **A exportação NÃO leva o filtro de responsável.** O botão de baixar fica
 * no topo da aba, longe do seletor que vive dentro do card — um arquivo
 * silenciosamente recortado por um filtro que quem clicou talvez nem tenha visto
 * seria pior do que um arquivo completo. A coluna "Responsável" está lá para a
 * planilha filtrar sozinha.
 */
export function abasDeCurso<T extends LeadExportavel>(
  leads: T[] | undefined,
  /** id → nome. A planilha não consulta equipe. */
  nomeDe: (id: string | null) => string
): { cursos?: LinhaCursoXlsx[]; leadsPorCurso?: LeadDeCursoXlsx[] } {
  if (!leads || leads.length === 0) return {};

  const rotulo = (curso: string) => (curso === SEM_CURSO ? SEM_CURSO_ROTULO : curso);

  const cursos: LinhaCursoXlsx[] = agruparPorCurso(leads).map((l) => ({
    curso: rotulo(l.curso),
    leads: l.recebeu,
    quentes: l.qualificados,
    frios: l.frios,
    finalizadas: l.finalizadas,
    ganhas: l.ganhas,
    atendentes: Object.entries(l.porAtendente)
      .sort((a, b) => b[1] - a[1])
      .map(([id, n]) => `${nomeDe(id)}: ${n}`)
      .join(" · "),
  }));

  const leadsPorCurso: LeadDeCursoXlsx[] = leads.map((l) => ({
    curso: l.curso ?? SEM_CURSO_ROTULO,
    contato: l.contato ?? "sem nome",
    telefone: l.telefone ?? "",
    dia: l.dia,
    responsavel: l.atendente ? nomeDe(l.atendente) : "sem responsável",
    /*
     * ⚠️ "sem nota" e não vazio: célula vazia se lê como falha de exportação, e
     * aqui ela é um ESTADO — o lead abandonou a triagem antes de ser pontuado.
     */
    temperatura: l.resultado ?? "sem nota",
    pontos: l.pontos,
    /*
     * ⚠️ A situação já vem RESOLVIDA em texto, para a planilha não precisar
     * reproduzir a regra em fórmula. Mesma decisão da coluna `situacao` no CSV
     * de Atendimento.
     */
    situacao: l.ganha ? "ganho" : l.finalizada ? "finalizada" : "em aberto",
  }));

  return { cursos, leadsPorCurso };
}

export function totaisDeCurso<T extends LeadDeCurso>(leads: T[]) {
  const comCurso = leads.filter((l) => !!l.curso).length;
  return {
    total: leads.length,
    comCurso,
    semMarcacao: leads.length - comCurso,
    cursosDistintos: new Set(leads.filter((l) => l.curso).map((l) => l.curso)).size,
  };
}
