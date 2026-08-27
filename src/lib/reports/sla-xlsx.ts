import type { SlaAgregado, SlaLinha } from "./sla";
import { FAIXA_SEM_RESPOSTA, faixaDe, dur } from "./sla";
import { pngCumprimentoPorDia, pngDistribuicao } from "./sla-graficos";

/**
 * Relatório executivo de atendimento em XLSX.
 *
 * Substitui o CSV de uma coluna por planilha com abas, formatação e gráficos.
 *
 * ⚠️ **A aba "Atendimentos" NÃO é enfeite: ela é o CSV que saiu.** Uma linha por
 * conversa, com a situação já resolvida em texto. Sem ela, quem hoje baixa para
 * montar tabela dinâmica ou cruzar com a planilha da equipe perderia a única
 * coisa que o CSV fazia bem — e trocar uma capacidade por outra não é melhorar.
 *
 * ⚠️ **`exceljs` entra por import DINÂMICO.** São ~940 KB minificados; num
 * import estático isso vai para o bundle de quem só abre o painel e nunca baixa
 * relatório. Carrega no clique.
 */

/** Cinza-grafite dos cabeçalhos, alinhado à sidebar do CRM. */
const AZUL = "FF1E293B";
const VERDE = "FF10B981";
const VERMELHO = "FFF43F5E";

export interface DadosDoRelatorio {
  ag: SlaAgregado;
  linhas: SlaLinha[];
  nomes: Record<string, string>;
  meta: number;
  dias: number;
  de: string;
  ate: string;
  empresa: string;
  usuario: string;
  /** Recorte ativo em texto ("Responsável: Cibelle"), vazio quando não há. */
  recorte: string[];
}

/**
 * Porcentagem como FRAÇÃO, para a célula ter formato `0.0%` de verdade.
 *
 * ⚠️ Arredondada em 4 casas de propósito: `72.4 / 100` dá
 * `0.7240000000000001` em ponto flutuante. Com o formato de exibição atual
 * ninguém vê, mas fica ruído gravado na célula — e basta alguém aumentar as
 * decimais para ele aparecer num relatório que circula.
 */
function fracao(v: number): number {
  return Math.round((v / 100) * 10000) / 10000;
}

function pct(v: number): string {
  return `${v.toFixed(1).replace(".", ",")}%`;
}

/**
 * Monta o workbook, sem tocar no DOM.
 *
 * Separado do download de propósito: assim a planilha inteira — abas, formatação,
 * barras de dados, fórmulas de coluna — pode ser gerada e RELIDA num teste, o
 * que é a única forma de saber se as chamadas do ExcelJS estão certas antes de
 * alguém clicar em produção. Os gráficos precisam de canvas e são pulados fora
 * do navegador (`pngX` devolve null).
 */
export async function montarWorkbook(d: DadosDoRelatorio) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = d.empresa;
  wb.created = new Date();

  /* ------------------------------------------------------------------ *
   * Aba 1 — Resumo (é o que vira apresentação)
   * ------------------------------------------------------------------ */
  const r = wb.addWorksheet("Resumo", {
    views: [{ showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1 },
  });
  r.columns = [
    { width: 3 },
    { width: 30 },
    { width: 18 },
    { width: 18 },
    { width: 18 },
    { width: 30 },
  ];

  const titulo = r.getCell("B2");
  titulo.value = "Análise de Atendimento (SLA)";
  titulo.font = { size: 18, bold: true, color: { argb: AZUL } };
  r.getCell("B3").value = `${d.empresa} · ${d.de} a ${d.ate} (${d.dias} dias)`;
  r.getCell("B3").font = { size: 11, color: { argb: "FF64748B" } };
  r.getCell("B4").value =
    `Gerado por ${d.usuario} em ${new Date().toLocaleString("pt-BR")}` +
    (d.recorte.length ? ` · recorte: ${d.recorte.join(" · ")}` : "");
  r.getCell("B4").font = { size: 9, italic: true, color: { argb: "FF94A3B8" } };

  // KPIs numa faixa: número grande em cima, rótulo embaixo. Mesma leitura do
  // painel — o número primeiro, a explicação depois.
  const k = d.ag.kpis;
  const kpis: [string, string, string][] = [
    [pct(k.pct_na_meta), "Dentro da meta", `${k.dentro_da_meta} de ${k.recebidas} em até ${d.meta} min`],
    [dur(k.mediana_min), "Resposta típica", `metade responde nisso · p90 ${dur(k.p90_min)}`],
    [String(k.sem_resposta), "Sem resposta", `${k.so_o_bot} só o bot atendeu`],
    [String(k.esperando_agora), "Esperando agora", `mais antiga ${dur(k.maior_espera_aberta)}`],
  ];
  kpis.forEach(([valor, rotulo, hint], i) => {
    const linha = 6 + i * 3;
    const cv = r.getCell(`B${linha}`);
    cv.value = valor;
    cv.font = { size: 22, bold: true, color: { argb: i === 0 && k.pct_na_meta < 50 ? VERMELHO : AZUL } };
    const cr = r.getCell(`C${linha}`);
    cr.value = rotulo;
    cr.font = { size: 11, bold: true, color: { argb: AZUL } };
    const ch = r.getCell(`C${linha + 1}`);
    ch.value = hint;
    ch.font = { size: 9, color: { argb: "FF94A3B8" } };
  });

  /*
   * ⚠️ Bloco de metodologia, e ele não é burocracia: as definições MUDAM o
   * número. Este projeto já mediu que a média era 675 min e a mediana 14, que
   * descartar respostas acima de 24h escondia justamente as piores, e que
   * ignorar o expediente fazia o p90 saltar de 2h33 para 45h. Relatório que
   * circula sem dizer a régua produz discussão sobre o número em vez de sobre o
   * atendimento.
   */
  const linhaMet = 6 + kpis.length * 3 + 1;
  r.mergeCells(`B${linhaMet}:F${linhaMet}`);
  const met = r.getCell(`B${linhaMet}`);
  met.value = "Como estes números são calculados";
  met.font = { size: 11, bold: true, color: { argb: AZUL } };
  const regras = [
    `Mede o tempo até a PRIMEIRA RESPOSTA HUMANA. Resposta do bot não conta como atendimento.`,
    `Conta só dentro do expediente: seg a sex, 8h às 19h (America/Sao_Paulo). Fim de semana congela o relógio.`,
    `Meta de ${d.meta} minutos úteis.`,
    `Conversas NUNCA respondidas entram no denominador do cumprimento — medir só entre as respondidas premiaria abandonar a conversa.`,
    `"Resposta típica" é a MEDIANA, não a média: a média é distorcida pelos casos extremos.`,
  ];
  regras.forEach((t, i) => {
    const c = r.getCell(`B${linhaMet + 1 + i}`);
    r.mergeCells(`B${linhaMet + 1 + i}:F${linhaMet + 1 + i}`);
    c.value = `• ${t}`;
    c.font = { size: 9, color: { argb: "FF475569" } };
    c.alignment = { wrapText: true, vertical: "top" };
    r.getRow(linhaMet + 1 + i).height = 24;
  });

  // Gráficos como imagem — ver o comentário em `sla-graficos.ts` sobre por que
  // não há gráfico nativo do Excel aqui.
  let linhaImg = linhaMet + regras.length + 3;
  const g1 = pngCumprimentoPorDia(d.ag.serie);
  if (g1) {
    r.getCell(`B${linhaImg}`).value = "Cumprimento da meta por dia";
    r.getCell(`B${linhaImg}`).font = { size: 11, bold: true, color: { argb: AZUL } };
    const id = wb.addImage({ base64: g1, extension: "png" });
    r.addImage(id, { tl: { col: 1, row: linhaImg }, ext: { width: 900, height: 260 } });
    linhaImg += 16;
  }
  const g2 = pngDistribuicao(d.ag.distribuicao);
  if (g2) {
    r.getCell(`B${linhaImg}`).value = "Em quanto tempo respondemos";
    r.getCell(`B${linhaImg}`).font = { size: 11, bold: true, color: { argb: AZUL } };
    const id = wb.addImage({ base64: g2, extension: "png" });
    r.addImage(id, { tl: { col: 1, row: linhaImg }, ext: { width: 900, height: 260 } });
  }

  /* ------------------------------------------------------------------ *
   * Abas de tabela
   * ------------------------------------------------------------------ */

  /** Cabeçalho escuro, congelado, com filtro automático. */
  function cabecalho(ws: import("exceljs").Worksheet, colunas: { h: string; w: number }[]) {
    ws.columns = colunas.map((c) => ({ width: c.w }));
    const linha = ws.getRow(1);
    colunas.forEach((c, i) => {
      const cel = linha.getCell(i + 1);
      cel.value = c.h;
      cel.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
      cel.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AZUL } };
      cel.alignment = { vertical: "middle", wrapText: true };
    });
    linha.height = 26;
    // Congelar e filtrar: a planilha é para trabalhar, não só para olhar.
    ws.views = [{ state: "frozen", ySplit: 1 }];
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: colunas.length } };
  }

  /**
   * Barra de dados NATIVA do Excel na coluna.
   *
   * ⚠️ É o único "gráfico" que a biblioteca escreve de verdade, e vale mais que
   * uma imagem aqui: acompanha a ordenação e o filtro da própria planilha, então
   * continua correta depois de o leitor mexer na tabela.
   */
  function barraDeDados(
    ws: import("exceljs").Worksheet,
    coluna: string,
    ultimaLinha: number,
    cor: string
  ) {
    if (ultimaLinha < 2) return;
    ws.addConditionalFormatting({
      ref: `${coluna}2:${coluna}${ultimaLinha}`,
      rules: [
        {
          type: "dataBar",
          /*
           * ⚠️ **`cfvo` é OBRIGATÓRIO** — sem ele o ExcelJS estoura em
           * `databar-xform.js` ("Cannot read properties of undefined (reading
           * 'forEach')") no `writeBuffer`, ou seja: TODO download quebraria em
           * produção. A primeira versão escondeu isso com `as never`, que calou
           * exatamente o erro de tipo que estava avisando. Só apareceu porque o
           * teste gera a planilha e a relê.
           *
           * `min`/`max` faz a barra escalar pelo próprio intervalo da coluna,
           * que é o que se quer numa tabela ordenável.
           */
          cfvo: [{ type: "min" }, { type: "max" }],
          priority: 1,
          /*
           * ⚠️ `color` existe no RUNTIME (`databar-xform.js` faz
           * `this.colorXform.render(xmlStream, model.color)`) e falta no
           * `.d.ts` do ExcelJS. O cast é sobre a declaração INCOMPLETA da
           * biblioteca, não sobre um erro nosso — diferente do `as never` que
           * estava aqui antes e escondia a falta do `cfvo`. O teste que gera e
           * relê a planilha é o que sustenta esta afirmação.
           */
          ...({ color: { argb: cor } } as object),
        },
      ],
    });
  }

  // --- Por responsável ---
  const ws2 = wb.addWorksheet("Por responsável", { views: [{ showGridLines: false }] });
  cabecalho(ws2, [
    { h: "Responsável", w: 30 },
    { h: "Conversas", w: 12 },
    { h: "Dentro da meta", w: 15 },
    { h: "Mediana (min úteis)", w: 18 },
    { h: "P90 (min úteis)", w: 16 },
    { h: "Sem resposta", w: 14 },
  ]);
  d.ag.agentes.forEach((a) =>
    ws2.addRow([a.nome, a.conversas, fracao(a.pct_na_meta), a.mediana_min, a.p90_min, a.sem_resposta])
  );
  ws2.getColumn(3).numFmt = "0.0%";
  barraDeDados(ws2, "B", ws2.rowCount, "FF6366F1");
  barraDeDados(ws2, "C", ws2.rowCount, VERDE);

  // --- Por canal ---
  const ws3 = wb.addWorksheet("Por canal", { views: [{ showGridLines: false }] });
  cabecalho(ws3, [
    { h: "Canal", w: 22 },
    { h: "Conversas", w: 12 },
    { h: "Dentro da meta", w: 15 },
    { h: "Mediana (min úteis)", w: 18 },
  ]);
  d.ag.canais.forEach((c) => ws3.addRow([c.canal, c.conversas, fracao(c.pct_na_meta), c.mediana_min]));
  ws3.getColumn(3).numFmt = "0.0%";
  barraDeDados(ws3, "B", ws3.rowCount, "FF6366F1");

  // --- Distribuição ---
  const ws4 = wb.addWorksheet("Distribuição", { views: [{ showGridLines: false }] });
  cabecalho(ws4, [
    { h: "Faixa de tempo", w: 22 },
    { h: "Conversas", w: 12 },
    { h: "Situação", w: 16 },
  ]);
  d.ag.distribuicao.forEach((f) => {
    const linha = ws4.addRow([f.faixa, f.conversas, f.violacao ? "fora da meta" : "na meta"]);
    // Cor E texto: em impressão preto e branco, ou para quem não distingue
    // verde de vermelho, a cor sozinha não informa nada.
    linha.getCell(3).font = { color: { argb: f.violacao ? VERMELHO : VERDE }, bold: true, size: 10 };
  });
  barraDeDados(ws4, "B", ws4.rowCount, "FF6366F1");

  // --- Fila de ação ---
  const ws5 = wb.addWorksheet("Fila de ação", { views: [{ showGridLines: false }] });
  cabecalho(ws5, [
    { h: "Contato", w: 30 },
    { h: "Canal", w: 14 },
    { h: "Responsável", w: 26 },
    { h: "Situação", w: 16 },
    { h: "Espera útil (min)", w: 16 },
    { h: "Primeira mensagem", w: 20 },
  ]);
  d.ag.criticos.forEach((c) => {
    const linha = ws5.addRow([
      c.contato,
      c.canal,
      c.responsavel ?? "Sem responsável",
      c.situacao === "esperando" ? "esperando agora" : "violou a meta",
      Math.round(c.espera_util_min),
      new Date(c.primeira_entrada).toLocaleString("pt-BR"),
    ]);
    if (c.situacao === "esperando") {
      linha.getCell(4).font = { color: { argb: "FFD97706" }, bold: true, size: 10 };
    }
  });
  barraDeDados(ws5, "E", ws5.rowCount, VERMELHO);

  /* --- Atendimentos: é o CSV que saiu, preservado como aba --- */
  const ws6 = wb.addWorksheet("Atendimentos", { views: [{ showGridLines: false }] });
  cabecalho(ws6, [
    { h: "Contato", w: 30 },
    { h: "Canal", w: 14 },
    { h: "Responsável", w: 26 },
    { h: "Situação", w: 22 },
    { h: "Espera útil (min)", w: 16 },
    { h: "Espera corrida (min)", w: 18 },
    { h: "Faixa", w: 16 },
    { h: "Primeira mensagem", w: 20 },
    { h: "Primeira resposta", w: 20 },
    { h: "Só o bot respondeu", w: 16 },
    { h: "Finalizada", w: 12 },
  ]);
  for (const l of d.linhas) {
    // `situacao` já resolvida em texto: a planilha não deveria ter que
    // reproduzir a regra do SLA em fórmula.
    const situacao = !l.respondida
      ? l.fechada
        ? "sem resposta (finalizada)"
        : "esperando agora"
      : l.dentro_da_meta
        ? "dentro da meta"
        : "fora da meta";
    ws6.addRow([
      l.contato,
      l.canal,
      l.assigned_to ? (d.nomes[l.assigned_to] ?? "—") : "Sem responsável",
      situacao,
      Math.round(l.espera_util_min * 10) / 10,
      Math.round(l.espera_corrida_min * 10) / 10,
      l.respondida ? faixaDe(l) : FAIXA_SEM_RESPOSTA,
      new Date(l.primeira_entrada).toLocaleString("pt-BR"),
      l.primeira_resposta ? new Date(l.primeira_resposta).toLocaleString("pt-BR") : "",
      l.respondida_por_bot ? "sim" : "não",
      l.fechada ? "sim" : "não",
    ]);
  }
  barraDeDados(ws6, "E", ws6.rowCount, VERMELHO);

  return wb;
}

/** Gera e baixa. O nome do arquivo carrega período e recorte. */
export async function baixarRelatorioXlsx(d: DadosDoRelatorio): Promise<void> {
  const wb = await montarWorkbook(d);
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  // O nome carrega o período E se havia recorte: dois downloads do mesmo dia com
  // filtros diferentes não podem virar o mesmo arquivo.
  a.download = `relatorio-atendimento-${d.dias}d${d.recorte.length ? "-filtrado" : ""}-${new Date()
    .toISOString()
    .slice(0, 10)}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
