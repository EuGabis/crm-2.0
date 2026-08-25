/**
 * Agregação do SLA de atendimento.
 *
 * ⚠️ Isto morava dentro da rota, que devolvia os números já somados. Com os
 * gráficos ficando clicáveis, cada clique exigiria uma ida ao servidor para
 * recontar — e filtrar deixaria de ser instantâneo. Agora a rota devolve UMA
 * LINHA POR CONVERSA (245 em 30 dias, ~40 KB) e quem soma é esta função, no
 * navegador, dentro de um `useMemo`.
 *
 * Consequência boa: o recorte que o clique cria e o recorte do painel de
 * filtros passam pelo mesmo caminho — não existe "filtro que o gráfico entende
 * e a tabela não".
 */

/** Uma conversa, com o SLA já resolvido pelo banco (`sla_conversations`). */
export interface SlaLinha {
  conversation_id: string;
  contact_id: string | null;
  contato: string;
  canal: string;
  assigned_to: string | null;
  primeira_entrada: string;
  primeira_resposta: string | null;
  espera_util_min: number;
  espera_corrida_min: number;
  respondida: boolean;
  dentro_da_meta: boolean;
  fechada: boolean;
  respondida_por_bot: boolean;
}

export type Situacao = "na_meta" | "fora_da_meta" | "sem_resposta" | "esperando";

export interface SlaFiltros {
  faixa: string | null;
  dia: string | null;
  /** userId, ou `SEM_RESPONSAVEL` para as que ninguém assumiu. */
  responsavel: string | null;
  canal: string | null;
  situacao: Situacao | null;
  estado: "aberta" | "fechada" | null;
  /** Só as conversas em que o bot respondeu mas nenhuma pessoa. */
  soBot: boolean;
}

export const SEM_RESPONSAVEL = "__sem__";

export const FILTROS_VAZIOS: SlaFiltros = {
  faixa: null,
  dia: null,
  responsavel: null,
  canal: null,
  situacao: null,
  estado: null,
  soBot: false,
};

export function temFiltro(f: SlaFiltros): boolean {
  return (
    f.faixa !== null ||
    f.dia !== null ||
    f.responsavel !== null ||
    f.canal !== null ||
    f.situacao !== null ||
    f.estado !== null ||
    f.soBot
  );
}

/**
 * Faixas de espera. A ordem é a do gráfico, e "sem resposta" é a última de
 * propósito: ela não é um tempo, é a ausência de um.
 */
export const FAIXAS = [
  { rotulo: "até 5 min", violacao: false, teste: (m: number) => m <= 5 },
  { rotulo: "5 a 15 min", violacao: false, teste: (m: number) => m > 5 && m <= 15 },
  { rotulo: "15 a 60 min", violacao: true, teste: (m: number) => m > 15 && m <= 60 },
  { rotulo: "1h a 4h", violacao: true, teste: (m: number) => m > 60 && m <= 240 },
  { rotulo: "mais de 4h", violacao: true, teste: (m: number) => m > 240 },
] as const;

export const FAIXA_SEM_RESPOSTA = "sem resposta";

/** Em que faixa a conversa cai — a MESMA conta que desenha a barra e que filtra. */
export function faixaDe(l: SlaLinha): string {
  if (!l.respondida) return FAIXA_SEM_RESPOSTA;
  return FAIXAS.find((f) => f.teste(l.espera_util_min))?.rotulo ?? FAIXA_SEM_RESPOSTA;
}

/** Dia no fuso de São Paulo — o gráfico tem que bater com o relógio de quem olha. */
export function diaBr(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

export function rotuloDia(dia: string): string {
  return `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
}

export function percentil(valores: number[], p: number): number | null {
  if (valores.length === 0) return null;
  const ord = [...valores].sort((a, b) => a - b);
  const pos = (ord.length - 1) * p;
  const baixo = Math.floor(pos);
  const alto = Math.ceil(pos);
  if (baixo === alto) return ord[baixo];
  return ord[baixo] + (ord[alto] - ord[baixo]) * (pos - baixo);
}

function pct(parte: number, total: number): number {
  return total ? Math.round((parte / total) * 1000) / 10 : 0;
}

export function aplicarFiltros(linhas: SlaLinha[], f: SlaFiltros): SlaLinha[] {
  return linhas.filter((l) => {
    if (f.faixa && faixaDe(l) !== f.faixa) return false;
    if (f.dia && diaBr(l.primeira_entrada) !== f.dia) return false;
    if (f.responsavel) {
      const chave = l.assigned_to ?? SEM_RESPONSAVEL;
      if (chave !== f.responsavel) return false;
    }
    if (f.canal && l.canal !== f.canal) return false;
    if (f.estado === "aberta" && l.fechada) return false;
    if (f.estado === "fechada" && !l.fechada) return false;
    if (f.soBot && !(l.respondida_por_bot && !l.respondida)) return false;
    if (f.situacao === "na_meta" && !l.dentro_da_meta) return false;
    if (f.situacao === "fora_da_meta" && !(l.respondida && !l.dentro_da_meta)) return false;
    if (f.situacao === "sem_resposta" && l.respondida) return false;
    // "Esperando" é o subconjunto acionável de "sem resposta": ninguém
    // respondeu E a conversa continua aberta. Sem resposta numa conversa já
    // finalizada é histórico, não fila de trabalho.
    if (f.situacao === "esperando" && (l.respondida || l.fechada)) return false;
    return true;
  });
}

export interface SlaAgregado {
  kpis: {
    recebidas: number;
    respondidas: number;
    sem_resposta: number;
    esperando_agora: number;
    dentro_da_meta: number;
    pct_na_meta: number;
    mediana_min: number | null;
    p90_min: number | null;
    maior_espera_aberta: number | null;
    so_o_bot: number;
  };
  distribuicao: { faixa: string; conversas: number; violacao: boolean }[];
  serie: { dia: string; rotulo: string; recebidas: number; pct_na_meta: number }[];
  agentes: {
    userId: string;
    nome: string;
    conversas: number;
    pct_na_meta: number;
    mediana_min: number | null;
    p90_min: number | null;
    sem_resposta: number;
  }[];
  canais: { canal: string; conversas: number; pct_na_meta: number; mediana_min: number | null }[];
  criticos: (SlaLinha & { situacao: "esperando" | "violou"; responsavel: string | null })[];
}

/**
 * Soma tudo o que a tela desenha, a partir das linhas JÁ filtradas.
 *
 * `todosOsDias` vem de fora (das linhas sem filtro) para o gráfico manter o eixo
 * do período inteiro: filtrando por um responsável, os dias em que ele não
 * atendeu devem aparecer como zero, não desaparecer — senão a linha muda de
 * escala e parece outra coisa.
 */
export function agregar(
  linhas: SlaLinha[],
  nomeDe: Record<string, string>,
  todosOsDias: string[]
): SlaAgregado {
  const respondidas = linhas.filter((l) => l.respondida);
  const esperas = respondidas.map((l) => l.espera_util_min);
  const semResposta = linhas.filter((l) => !l.respondida);
  const esperando = semResposta.filter((l) => !l.fechada);
  const naMeta = linhas.filter((l) => l.dentro_da_meta);

  const distribuicao = [
    ...FAIXAS.map((f) => ({
      faixa: f.rotulo as string,
      conversas: respondidas.filter((l) => f.teste(l.espera_util_min)).length,
      violacao: f.violacao,
    })),
    { faixa: FAIXA_SEM_RESPOSTA, conversas: semResposta.length, violacao: true },
  ];

  const porDia = new Map<string, { recebidas: number; naMeta: number }>();
  for (const dia of todosOsDias) porDia.set(dia, { recebidas: 0, naMeta: 0 });
  for (const l of linhas) {
    const dia = diaBr(l.primeira_entrada);
    const cur = porDia.get(dia) ?? { recebidas: 0, naMeta: 0 };
    cur.recebidas += 1;
    if (l.dentro_da_meta) cur.naMeta += 1;
    porDia.set(dia, cur);
  }
  const serie = [...porDia.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([dia, v]) => ({
      dia,
      rotulo: rotuloDia(dia),
      recebidas: v.recebidas,
      pct_na_meta: v.recebidas ? Math.round((v.naMeta / v.recebidas) * 100) : 0,
    }));

  const porAgente = new Map<
    string,
    { nome: string; conversas: number; naMeta: number; esperas: number[]; semResposta: number }
  >();
  for (const l of linhas) {
    const chave = l.assigned_to ?? SEM_RESPONSAVEL;
    const cur =
      porAgente.get(chave) ??
      {
        nome: l.assigned_to ? (nomeDe[l.assigned_to] ?? "Atendente") : "Sem responsável",
        conversas: 0,
        naMeta: 0,
        esperas: [] as number[],
        semResposta: 0,
      };
    cur.conversas += 1;
    if (l.dentro_da_meta) cur.naMeta += 1;
    if (l.respondida) cur.esperas.push(l.espera_util_min);
    else cur.semResposta += 1;
    porAgente.set(chave, cur);
  }

  const porCanal = new Map<string, { conversas: number; naMeta: number; esperas: number[] }>();
  for (const l of linhas) {
    const cur = porCanal.get(l.canal) ?? { conversas: 0, naMeta: 0, esperas: [] as number[] };
    cur.conversas += 1;
    if (l.dentro_da_meta) cur.naMeta += 1;
    if (l.respondida) cur.esperas.push(l.espera_util_min);
    porCanal.set(l.canal, cur);
  }

  const criticos = [
    ...esperando
      .slice()
      .sort((a, b) => b.espera_util_min - a.espera_util_min)
      .map((l) => ({ ...l, situacao: "esperando" as const })),
    ...respondidas
      .filter((l) => !l.dentro_da_meta)
      .sort((a, b) => b.espera_util_min - a.espera_util_min)
      .map((l) => ({ ...l, situacao: "violou" as const })),
  ]
    .slice(0, 100)
    .map((l) => ({
      ...l,
      responsavel: l.assigned_to ? (nomeDe[l.assigned_to] ?? "Atendente") : null,
    }));

  return {
    kpis: {
      recebidas: linhas.length,
      respondidas: respondidas.length,
      sem_resposta: semResposta.length,
      esperando_agora: esperando.length,
      dentro_da_meta: naMeta.length,
      // As não respondidas ficam no DENOMINADOR de propósito: medir só entre as
      // respondidas premiaria abandonar a conversa.
      pct_na_meta: pct(naMeta.length, linhas.length),
      mediana_min: percentil(esperas, 0.5),
      p90_min: percentil(esperas, 0.9),
      maior_espera_aberta: esperando.length
        ? Math.max(...esperando.map((l) => l.espera_util_min))
        : null,
      so_o_bot: semResposta.filter((l) => l.respondida_por_bot).length,
    },
    distribuicao,
    serie,
    agentes: [...porAgente.entries()]
      .map(([userId, v]) => ({
        userId,
        nome: v.nome,
        conversas: v.conversas,
        pct_na_meta: pct(v.naMeta, v.conversas),
        mediana_min: percentil(v.esperas, 0.5),
        p90_min: percentil(v.esperas, 0.9),
        sem_resposta: v.semResposta,
      }))
      .sort((a, b) => b.conversas - a.conversas),
    canais: [...porCanal.entries()]
      .map(([canal, v]) => ({
        canal,
        conversas: v.conversas,
        pct_na_meta: pct(v.naMeta, v.conversas),
        mediana_min: percentil(v.esperas, 0.5),
      }))
      .sort((a, b) => b.conversas - a.conversas),
    criticos,
  };
}

/** Minutos → texto curto. */
export function dur(min: number | null | undefined): string {
  if (min == null) return "—";
  if (min < 1) return "menos de 1 min";
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h < 24) return m ? `${h}h ${m}min` : `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}
