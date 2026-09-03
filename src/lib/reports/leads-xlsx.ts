/**
 * Planilha do relatório "Leads do dia".
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
  qualificados: number;
  frios: number;
  semClassificacao: number;
  pontosMedio: number | null;
}

export interface DadosLeads {
  linhas: LinhaDia[];
  total: { entraram: number; qualificados: number; frios: number; semClassificacao: number };
  dias: number;
  /** Limiar do nó `score` em vigor (9 na Triagem Comercial). */
  limiar: number;
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

/**
 * Monta o workbook sem tocar no DOM — separado do download para poder ser gerado
 * e RELIDO em teste, que é a única forma de saber se as chamadas do ExcelJS
 * estão certas antes de alguém clicar em produção.
 */
export async function montarWorkbookLeads(d: DadosLeads) {
  const ExcelJS = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "Lito CRM";
  wb.created = new Date();

  const CINZA = "FFF1F5F9";
  const cabecalho = (ws: import("exceljs").Worksheet, largura: number[]) => {
    ws.getRow(1).font = { bold: true, size: 10 };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: CINZA } };
    ws.getRow(1).alignment = { vertical: "middle" };
    largura.forEach((w, i) => (ws.getColumn(i + 1).width = w));
    ws.views = [{ state: "frozen", ySplit: 1 }];
  };

  /* ------------------------------------------------------------------ *
   * Aba 1 — Resumo
   * ------------------------------------------------------------------ */
  const ws1 = wb.addWorksheet("Resumo");
  ws1.columns = [{ width: 34 }, { width: 16 }];
  ws1.addRow(["Leads do dia", ""]).font = { bold: true, size: 14 };
  ws1.addRow([`Período: últimos ${d.dias} dias`, ""]);
  ws1.addRow([]);

  const classificados = d.total.qualificados + d.total.frios;
  const taxa = classificados > 0 ? (d.total.qualificados / classificados) * 100 : 0;

  const kpis: [string, number | string, string?][] = [
    ["Entraram", d.total.entraram],
    ["Qualificados (quente)", d.total.qualificados],
    ["Frios", d.total.frios],
    ["Não concluíram a triagem", d.total.semClassificacao],
    ["Taxa de qualificação", fracao(taxa), "0.0%"],
  ];
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
   */
  const met = [
    "Como cada número é apurado",
    `• Qualificado: soma dos pesos das respostas do bot >= ${d.limiar} (nó "score" da Triagem Comercial).`,
    "• Frio: respondeu as perguntas e ficou abaixo do limiar.",
    "• Não concluiu: abandonou a triagem antes das perguntas de pontuação — NÃO é reprovação.",
    "• Entraram: conversas criadas no período em número que roda a Triagem Comercial,",
    "  com pelo menos uma mensagem recebida (conversa aberta pelo CRM não conta).",
    "• Taxa de qualificação: qualificados / (qualificados + frios). Quem não concluiu",
    "  fica FORA da conta — senão a taxa cairia sempre que mais gente desistisse.",
  ];
  met.forEach((t, i) => {
    const r = ws1.addRow([t]);
    if (i === 0) r.font = { bold: true, size: 10 };
    else r.font = { size: 9, color: { argb: "FF64748B" } };
  });

  /* ------------------------------------------------------------------ *
   * Aba 2 — Por dia (uma linha por dia; é a que vira tabela dinâmica)
   * ------------------------------------------------------------------ */
  const ws2 = wb.addWorksheet("Por dia");
  ws2.addRow([
    "Dia",
    "Entraram",
    "Qualificados",
    "Frios",
    "Não concluíram",
    "Taxa de qualificação",
    "Pontos (média)",
  ]);
  cabecalho(ws2, [12, 11, 14, 9, 16, 20, 15]);

  d.linhas.forEach((l) => {
    const classif = l.qualificados + l.frios;
    const r = ws2.addRow([
      diaBR(l.dia),
      l.entraram,
      l.qualificados,
      l.frios,
      l.semClassificacao,
      classif > 0 ? fracao((l.qualificados / classif) * 100) : null,
      l.pontosMedio,
    ]);
    r.getCell(6).numFmt = "0.0%";
    // Dia sem classificação nenhuma fica VAZIO, não 0%: zero afirmaria que
    // ninguém qualificou, quando ninguém foi medido.
  });

  const ultima = ws2.rowCount;
  ws2.autoFilter = { from: "A1", to: `G${ultima}` };

  /*
   * Barra de dados nas colunas de volume.
   *
   * ⚠️ **Vale mais que uma imagem de gráfico**: acompanha a ordenação e o filtro
   * que o leitor aplicar. Biblioteca de XLSX no navegador não escreve gráfico
   * nativo do Excel, então a alternativa seria um PNG colado — que congela.
   */
  const barra = (coluna: string, cor: string) => {
    if (ultima < 2) return;
    ws2.addConditionalFormatting({
      ref: `${coluna}2:${coluna}${ultima}`,
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
  // As mesmas cores validadas do gráfico da tela — a planilha e a tela não podem
  // discordar sobre qual cor é "qualificado".
  barra("C", "FF059669"); // qualificados
  barra("D", "FF6366F1"); // frios
  barra("E", "FFD97706"); // não concluíram

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
  // O período entra no nome: dois downloads no mesmo dia com períodos diferentes
  // não podem virar o mesmo arquivo.
  a.download = `leads-do-dia-${d.dias}d-${new Date().toISOString().slice(0, 10)}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
