/**
 * Datas de relatório como texto "AAAA-MM-DD", no fuso da OPERAÇÃO.
 *
 * ⚠️ **O dia dos relatórios é o dia em São Paulo**, não o do relógio de quem
 * abre a tela nem o do processo: a Vercel roda em UTC, e as funções do banco
 * (`triagem_leads`, `sla_conversations`, `business_minutes`) resolvem o dia com
 * `at time zone 'America/Sao_Paulo'`. Um seletor que calculasse "hoje" de outro
 * jeito pediria um dia que ainda não existe no dado.
 *
 * ⚠️ **E por isso a moeda aqui é TEXTO, não `Date`.** `new Date("2026-09-09")`
 * é interpretado como meia-noite **UTC**, que no Brasil é 08/09 às 21h — voltar
 * para texto devolveria "2026-09-08". Esse erro de um dia é silencioso: o
 * relatório mostra o dia errado e nada acusa. Quem precisa de `Date` (o
 * calendário) converte pelas funções daqui, que usam as partes LOCAIS e o
 * MEIO-DIA, nunca `toISOString()`.
 *
 * Comparar texto "AAAA-MM-DD" com `<` e `>` já é comparar cronologicamente.
 */

const FUSO = "America/Sao_Paulo";

/** Hoje no fuso da operação. `en-CA` é o atalho para o formato ISO. */
export function hojeSP(agora = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: FUSO }).format(agora);
}

/**
 * "AAAA-MM-DD" → `Date` ao MEIO-DIA local.
 *
 * Meio-dia, e não meia-noite, para que somar ou subtrair dias nunca tropece
 * numa virada de horário de verão (o Brasil não tem desde 2019, mas o navegador
 * pode estar em outro fuso que tenha).
 */
export function paraData(dia: string): Date {
  const [a, m, d] = dia.split("-").map(Number);
  return new Date(a, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0);
}

/** `Date` → "AAAA-MM-DD" pelas partes LOCAIS. Nunca `toISOString()`. */
export function deData(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function somaDias(dia: string, n: number): string {
  const d = paraData(dia);
  d.setDate(d.getDate() + n);
  return deData(d);
}

/** Quantidade de dias de `de` até `ate`, INCLUSIVE (um dia só = 1). */
export function diasEntre(de: string, ate: string): number {
  const ms = paraData(ate).getTime() - paraData(de).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

/** Primeiro dia do mês de `dia`. */
export function inicioDoMes(dia: string): string {
  return `${dia.slice(0, 7)}-01`;
}

/** Último dia do mês de `dia`. */
export function fimDoMes(dia: string): string {
  const d = paraData(dia);
  return deData(new Date(d.getFullYear(), d.getMonth() + 1, 0, 12));
}

/** "11/09" */
export function curto(dia: string): string {
  return `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
}

/** "11/09/2026" */
export function longo(dia: string): string {
  return `${curto(dia)}/${dia.slice(0, 4)}`;
}

export interface Periodo {
  de: string;
  ate: string;
}

/**
 * O período por extenso, para subtítulo e planilha.
 *
 * Um dia só não vira "de 09/09 a 09/09": a frase precisa dizer que o recorte é
 * daquele dia, que é justamente o caso de quem escolheu uma data específica.
 */
export function rotuloDoPeriodo(p: Periodo): string {
  if (p.de === p.ate) return `em ${longo(p.de)}`;
  return `de ${curto(p.de)} a ${longo(p.ate)}`;
}

export const PERIODO_MAX_DIAS = 180;

/**
 * Ajusta o que o usuário (ou uma URL torta) pediu para o que a tela sabe
 * responder: inverte se vier ao contrário, não deixa passar de hoje e aplica o
 * teto de dias puxando o INÍCIO para frente — o fim é o que a pessoa quis ver.
 */
export function ajustarPeriodo(p: Periodo, maxDias = PERIODO_MAX_DIAS, hoje = hojeSP()): Periodo {
  let de = p.de <= p.ate ? p.de : p.ate;
  let ate = p.de <= p.ate ? p.ate : p.de;
  if (ate > hoje) ate = hoje;
  if (de > ate) de = ate;
  if (diasEntre(de, ate) > maxDias) de = somaDias(ate, -(maxDias - 1));
  return { de, ate };
}

export const DIA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Texto que é mesmo uma data — `2026-13-40` casa com o formato e não existe. */
export function ehDiaValido(dia: string | null | undefined): dia is string {
  if (!dia || !DIA_ISO.test(dia)) return false;
  return deData(paraData(dia)) === dia;
}

/* ------------------------------------------------------------------ *
 * Atalhos do seletor
 *
 * ⚠️ Moram AQUI, e não no componente, para poderem ser TESTADOS: o Node roda
 * TypeScript nativamente mas não JSX, então regra de data dentro de um `.tsx`
 * não tem como ser exercitada — e "mês passado" e "ontem" são exatamente o tipo
 * de conta que erra em silêncio na virada de mês.
 * ------------------------------------------------------------------ */

export type PresetKey =
  "hoje" | "ontem" | "7d" | "15d" | "30d" | "90d" | "mes" | "mes-passado" | "personalizado";

export const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "hoje", label: "Hoje" },
  { key: "ontem", label: "Ontem" },
  { key: "7d", label: "Últimos 7 dias" },
  { key: "15d", label: "Últimos 15 dias" },
  { key: "30d", label: "Últimos 30 dias" },
  { key: "90d", label: "Últimos 90 dias" },
  { key: "mes", label: "Este mês" },
  { key: "mes-passado", label: "Mês passado" },
  { key: "personalizado", label: "Personalizado" },
];

export function resolvePreset(key: PresetKey, hoje = hojeSP()): Periodo {
  switch (key) {
    case "hoje":
      return { de: hoje, ate: hoje };
    case "ontem": {
      const o = somaDias(hoje, -1);
      return { de: o, ate: o };
    }
    case "7d":
      return { de: somaDias(hoje, -6), ate: hoje };
    case "15d":
      return { de: somaDias(hoje, -14), ate: hoje };
    case "30d":
      return { de: somaDias(hoje, -29), ate: hoje };
    case "90d":
      return { de: somaDias(hoje, -89), ate: hoje };
    case "mes":
      return { de: inicioDoMes(hoje), ate: hoje };
    case "mes-passado": {
      // Um dia ANTES do dia 1 cai sempre no último dia do mês anterior — sem
      // precisar saber se ele tem 28, 30 ou 31.
      const noMesPassado = somaDias(inicioDoMes(hoje), -1);
      return { de: inicioDoMes(noMesPassado), ate: fimDoMes(noMesPassado) };
    }
    case "personalizado":
      return { de: somaDias(hoje, -29), ate: hoje };
  }
}

/**
 * Qual atalho corresponde ao período aplicado — para o botão dizer "Últimos 30
 * dias" em vez de repetir as datas, e para o popover reabrir no atalho certo.
 *
 * ⚠️ DERIVADO do período, nunca guardado ao lado dele: guardar os dois faria o
 * rótulo mentir no dia seguinte — "Hoje", escolhido ontem, continuaria escrito
 * "Hoje" apontando para a data de ontem.
 */
export function presetDoPeriodo(p: Periodo, hoje = hojeSP()): PresetKey {
  for (const { key } of PRESETS) {
    if (key === "personalizado") continue;
    const r = resolvePreset(key, hoje);
    if (r.de === p.de && r.ate === p.ate) return key;
  }
  return "personalizado";
}

/** O texto do botão: o nome do atalho, ou as datas quando é personalizado. */
export function rotuloDoBotao(p: Periodo, hoje = hojeSP()): string {
  const key = presetDoPeriodo(p, hoje);
  if (key !== "personalizado") return PRESETS.find((x) => x.key === key)!.label;
  return p.de === p.ate ? longo(p.de) : `${longo(p.de)} – ${longo(p.ate)}`;
}
