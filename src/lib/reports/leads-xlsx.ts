/**
 * Planilha do relatório "Leads do dia".
 *
 * ⚠️ **É genérica por FLUXO**, e tem de ser: a Triagem Comercial classifica em
 * quente/frio e a Triagem Secretaria em assuntos escolhidos pelo cliente, sem
 * nota nenhuma. Colunas fixas ("Qualificados", "Frios") só serviriam a um dos
 * dois — e uma segunda função para o outro faria as duas divergirem na primeira
 * mudança de régua.
 *
 * Mesmo desenho da planilha de Atendimento (`sla-xlsx.ts`), e por isso as mesmas
 * armadilhas já resolvidas valem aqui — em especial o `cfvo` obrigatório da
 * `dataBar`, sem o qual TODO download quebra no `writeBuffer`.
 *
 * ⚠️ `exceljs` entra por import DINÂMICO (~940 KB). Estático colocaria isso no
 * pacote de quem só abre o relatório e nunca baixa nada.
 */

export interface LinhaDia {
  dia: string;
  entraram: number;
  concluiram: number;
  /** Mapa desfecho → quantidade. As chaves são as do fluxo. */
  desfechos: Record<string, number>;
  pontosMedio: number | null;
}

export interface SerieDesfecho {
  chave: string;
  rotulo: string;
  /** Hex `#rrggbb` — a MESMA cor validada do gráfico da tela. */
  cor: string;
}

export interface DadosLeads {
  linhas: LinhaDia[];
  total: { entraram: number; concluiram: number; desfechos: Record<string, number> };
  dias: number;
  fluxoKey: string;
  fluxoNome: string;
  /** Fluxo com nó de pontuação: ganha a coluna de média de pontos. */
  mostraPontos: boolean;
  series: SerieDesfecho[];
  naoConcluiuCor: string;
}

/**
 * Porcentagem como FRAÇÃO, para a célula ter formato `0.0%` de verdade.
 *
 * ⚠️ Arredondada em 4 casas: `72.4 / 100` dá `0.7240000000000001` em ponto
 * flutuante. Invisível no formato de exibição, mas é ruído gravado — basta
 * alguém aumentar as decimais num relatório que circula.
 */
function fracao(v: number): number {
  return Math.round((v / 100) * 10000) / 10000;
}

/** "2026-09-03" → "03/09/2026", sem depender de fuso. */
function diaBR(iso: string): string {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

/** "#059669" → "FF059669" (ARGB do ExcelJS). */
function argb(hex: string): string {
  return `FF${hex.replace("#", "").toUpperCase()}`;
}

/** Coluna do Excel por índice 1-based: 1 → "A", 27 → "AA". */
function colLetra(n: number): string {
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Quem entrou e não recebeu desfecho nenhum. Nunca negativo. */
function naoConcluiu(l: LinhaDia): number {
  return Math.max(l.entraram - l.concluiram, 0);
}

/**
 * Monta o workbook sem tocar no DOM — separado do download para poder ser gerado
 * e RELIDO em teste, que é a única forma de saber se as chamadas do ExcelJS
 * estão certas antes de alguém clicar em produção.
 */
export async function montarWorkbookLeads(d: DadosLeads) {
  /*
   * ⚠️ `.default` importa: o `exceljs` é CJS, e sem ele
   * `ExcelJS.Workbook` não é construtor fora do bundler. É o mesmo
   * padrão de `sla-xlsx.ts` — a primeira versão daqui divergia, e foi o
   * teste que pegou.
   */
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Lito CRM";
  wb.created = new Date();

  const CINZA = "FFF1F5F9";

  /* ------------------------------------------------------------------ *
   * Aba 1 — Resumo
   * ------------------------------------------------------------------ */
  const ws1 = wb.addWorksheet("Resumo");
  ws1.columns = [{ width: 34 }, { width: 16 }];
  ws1.addRow(["Leads do dia", ""]).font = { bold: true, size: 14 };
  ws1.addRow([d.fluxoNome, ""]).font = { bold: true, size: 11 };
  ws1.addRow([`Período: últimos ${d.dias} dias`, ""]);
  ws1.addRow([]);

  const semDesfecho = Math.max(d.total.entraram - d.total.concluiram, 0);

  const kpis: [string, number | null, string?][] = [
    ["Entraram", d.total.entraram],
    ...d.series.map(
      (s) => [s.rotulo, d.total.desfechos[s.chave] ?? 0] as [string, number | null, string?]
    ),
    ["Não concluíram a triagem", semDesfecho],
  ];

  if (d.mostraPontos) {
    // Taxa de qualificação: só existe em fluxo que classifica.
    const quente = d.total.desfechos.quente ?? 0;
    kpis.push([
      "Taxa de qualificação",
      d.total.concluiram > 0 ? fracao((quente / d.total.concluiram) * 100) : null,
      "0.0%",
    ]);
  } else {
    // Na secretaria o número que importa é quanta gente CHEGOU ao atendente.
    kpis.push([
      "Escolheram o assunto",
      d.total.entraram > 0 ? fracao((d.total.concluiram / d.total.entraram) * 100) : null,
      "0.0%",
    ]);
  }

  kpis.forEach(([rot, val, fmt]) => {
    const r = ws1.addRow([rot, val]);
    r.getCell(1).font = { bold: true, size: 10 };
    if (fmt) r.getCell(2).numFmt = fmt;
  });

  ws1.addRow([]);
  /*
   * ⚠️ **O bloco de metodologia não é burocracia.** Este projeto já mediu que
   * uma métrica sem régua declarada gera discussão sobre o número em vez de
   * sobre a operação (o "tempo médio de resposta" que era média de tempo
   * corrido). Relatório que circula sem a régua volta como pergunta.
   *
   * ⚠️ E a régua é DIFERENTE por fluxo — escrever a do comercial na planilha da
   * secretaria seria pior que não escrever nenhuma.
   */
  const met: string[] = ["Como cada número é apurado"];
  if (d.mostraPontos) {
    met.push(
      '• Qualificado: soma dos pesos das respostas do bot >= 9 (nó "score" da Triagem Comercial).',
      "• Frio: respondeu as perguntas e ficou abaixo do limiar.",
      "• Taxa de qualificação: qualificados / classificados. Quem não concluiu fica FORA da",
      "  conta — senão a taxa cairia sempre que mais gente desistisse."
    );
  } else {
    met.push(
      "• Este bot NÃO classifica lead: não existe qualificado nem perdido. O cliente escolhe",
      "  um assunto na lista e cada ramo vai para um atendente.",
      "• Escolheram o assunto: chegaram ao fim da triagem e foram para um atendente."
    );
  }
  met.push(
    "• Não concluiu: parou antes de receber desfecho — NÃO é reprovação nem recusa.",
    `• Entraram: conversas criadas no período em número que roda a ${d.fluxoNome},`,
    "  com pelo menos uma mensagem recebida (conversa aberta pelo CRM não conta).",
    "• O desfecho é contado no dia em que a conversa ENTROU, não no dia em que o bot",
    "  classificou — senão as colunas não somariam com quem entrou."
  );
  met.forEach((t, i) => {
    const r = ws1.addRow([t]);
    if (i === 0) r.font = { bold: true, size: 10 };
    else r.font = { size: 9, color: { argb: "FF64748B" } };
  });

  /* ------------------------------------------------------------------ *
   * Aba 2 — Por dia (uma linha por dia; é a que vira tabela dinâmica)
   * ------------------------------------------------------------------ */
  const ws2 = wb.addWorksheet("Por dia");
  const colunas = [
    "Dia",
    "Entraram",
    ...d.series.map((s) => s.rotulo),
    "Não concluíram",
    ...(d.mostraPontos ? ["Pontos (média)"] : []),
  ];
  ws2.addRow(colunas);
  ws2.getRow(1).font = { bold: true, size: 10 };
  ws2.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: CINZA } };
  ws2.getRow(1).alignment = { vertical: "middle" };
  colunas.forEach((c, i) => (ws2.getColumn(i + 1).width = Math.max(11, c.length + 3)));
  ws2.views = [{ state: "frozen", ySplit: 1 }];

  d.linhas.forEach((l) => {
    ws2.addRow([
      diaBR(l.dia),
      l.entraram,
      ...d.series.map((s) => l.desfechos[s.chave] ?? 0),
      naoConcluiu(l),
      // ⚠️ Dia sem nenhum lead classificado fica VAZIO, não 0: zero afirmaria
      // que a média é zero, quando não houve o que medir.
      ...(d.mostraPontos ? [l.pontosMedio] : []),
    ]);
  });

  const ultima = ws2.rowCount;
  ws2.autoFilter = { from: "A1", to: `${colLetra(colunas.length)}${ultima}` };

  /*
   * Barra de dados nas colunas de volume.
   *
   * ⚠️ **Vale mais que uma imagem de gráfico**: acompanha a ordenação e o filtro
   * que o leitor aplicar. Biblioteca de XLSX no navegador não escreve gráfico
   * nativo do Excel, então a alternativa seria um PNG colado — que congela.
   */
  const barra = (indiceColuna: number, cor: string) => {
    if (ultima < 2) return;
    const c = colLetra(indiceColuna);
    ws2.addConditionalFormatting({
      ref: `${c}2:${c}${ultima}`,
      rules: [
        {
          type: "dataBar",
          /*
           * ⚠️ **`cfvo` é OBRIGATÓRIO.** Sem ele o ExcelJS estoura em
           * `databar-xform.js` no `writeBuffer` — TODO download quebraria. Está
           * documentado no AGENTS.md porque já aconteceu na planilha de
           * Atendimento, e o `as never` da primeira versão calou justamente o
           * erro de tipo que avisava.
           */
          cfvo: [{ type: "min" }, { type: "max" }],
          // `color` existe no RUNTIME e falta no `.d.ts` do ExcelJS
          // (`databar-xform.js` faz `colorXform.render(stream, model.color)`).
          color: { argb: cor },
        } as never,
      ],
    });
  };
  /*
   * As MESMAS cores validadas do gráfico da tela — a planilha e a tela não podem
   * discordar sobre qual cor é qual desfecho. A coluna 1 é o dia e a 2 é
   * "Entraram", então as séries começam na 3.
   */
  d.series.forEach((s, i) => barra(3 + i, argb(s.cor)));
  barra(3 + d.series.length, argb(d.naoConcluiuCor));

  return wb;
}

export async function baixarRelatorioLeadsXlsx(d: DadosLeads): Promise<void> {
  const wb = await montarWorkbookLeads(d);
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  /*
   * O FLUXO e o período entram no nome. Sem o fluxo, baixar a visão da
   * secretaria depois da do comercial sobrescreveria o arquivo anterior — e as
   * duas planilhas têm colunas diferentes, então o leitor abriria a errada
   * achando que é a outra.
   */
  const curto = d.fluxoKey.replace("triagem-", "").replace("triagem", "comercial");
  a.download = `leads-do-dia-${curto}-${d.dias}d-${new Date().toISOString().slice(0, 10)}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
