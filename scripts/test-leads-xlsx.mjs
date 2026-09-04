/**
 * Gera a planilha de "Leads do dia" e a RELÊ — para os dois fluxos.
 *
 * ⚠️ Existe por causa de um defeito real: na planilha de Atendimento, uma regra
 * de `dataBar` sem `cfvo` estoura no `writeBuffer` ("Cannot read properties of
 * undefined (reading 'forEach')" em `databar-xform.js`) e **TODO download
 * quebraria em produção** — invisível em revisão de código, invisível no `tsc`.
 * A única forma de saber é gerar e reler.
 *
 * ⚠️ E aqui há um segundo motivo: a planilha virou GENÉRICA por fluxo (colunas
 * dinâmicas, letra da coluna calculada). Com o comercial tendo 2 séries e a
 * secretaria 3, um erro de índice na barra de dados pintaria a coluna errada em
 * um dos dois e ninguém veria no outro.
 *
 * Roda direto no Node 24 (`npm run test:leads-xlsx`), sem runner de teste.
 */
import { montarWorkbookLeads } from "../src/lib/reports/leads-xlsx.ts";

let ok = 0;
let falhas = 0;
function eq(rotulo, obtido, esperado) {
  const bate = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (bate) ok++;
  else {
    falhas++;
    console.error(`  ✗ ${rotulo}\n      obtido:   ${JSON.stringify(obtido)}\n      esperado: ${JSON.stringify(esperado)}`);
  }
}

const COMERCIAL = {
  dias: 7,
  fluxoKey: "triagem",
  fluxoNome: "Triagem Comercial",
  mostraPontos: true,
  naoConcluiuCor: "#64748b",
  series: [
    { chave: "quente", rotulo: "Qualificados", cor: "#059669" },
    { chave: "frio", rotulo: "Frios", cor: "#6366f1" },
  ],
  linhas: [
    { dia: "2026-09-03", entraram: 10, concluiram: 8, desfechos: { quente: 5, frio: 3 }, pontosMedio: 9.4 },
    { dia: "2026-09-02", entraram: 4, concluiram: 0, desfechos: {}, pontosMedio: null },
  ],
  total: { entraram: 14, concluiram: 8, desfechos: { quente: 5, frio: 3 } },
  horas: Array.from({ length: 24 }, (_, h) => ({
    hora: h,
    entraram: h === 12 ? 9 : h === 9 ? 5 : 0,
    concluiram: h === 12 ? 6 : h === 9 ? 2 : 0,
    desfechos: h === 12 ? { quente: 4, frio: 2 } : h === 9 ? { quente: 1, frio: 1 } : {},
    pontosMedio: null,
  })),
};

// Dados REAIS de produção (03/09/2026), para o teste não medir só um caso feliz.
const SECRETARIA = {
  dias: 7,
  fluxoKey: "triagem-secretaria",
  fluxoNome: "Triagem Secretaria",
  mostraPontos: false,
  naoConcluiuCor: "#64748b",
  series: [
    { chave: "docs", rotulo: "Documentos/Prova Sub", cor: "#0891b2" },
    { chave: "imersao", rotulo: "Imersão Pres. MMA", cor: "#6366f1" },
    { chave: "outros", rotulo: "Outros", cor: "#d97706" },
  ],
  linhas: [
    { dia: "2026-09-03", entraram: 21, concluiram: 16, desfechos: { docs: 3, imersao: 6, outros: 7 }, pontosMedio: null },
    { dia: "2026-09-02", entraram: 34, concluiram: 25, desfechos: { docs: 2, imersao: 10, outros: 13 }, pontosMedio: null },
    // Dia com desfecho de UM assunto só: as outras colunas têm de sair 0, não vazio.
    { dia: "2026-08-30", entraram: 3, concluiram: 1, desfechos: { docs: 1 }, pontosMedio: null },
  ],
  total: { entraram: 58, concluiram: 42, desfechos: { docs: 6, imersao: 16, outros: 20 } },
  /*
   * Distribuição REAL de produção (secretaria, 30 dias): pico às 12h (37), a
   * hora 2 com ZERO e 17% fora do expediente. A hora vazia é o caso que importa
   * — ela tem de aparecer como linha, não faltar na aba.
   */
  horas: [2, 2, 0, 2, 2, 2, 2, 9, 20, 33, 28, 20, 37, 24, 32, 29, 24, 17, 17, 11, 10, 9, 6, 1].map(
    (n, h) => ({
      hora: h,
      entraram: n,
      concluiram: Math.round(n * 0.66),
      desfechos: n > 0 ? { docs: Math.round(n * 0.1), imersao: Math.round(n * 0.2), outros: Math.round(n * 0.36) } : {},
      pontosMedio: null,
    })
  ),
};

async function relê(dados) {
  const montado = await montarWorkbookLeads(dados);
  // ⚠️ O `writeBuffer` é o passo que quebra com `dataBar` mal formada. Chamar
  // `montarWorkbook` sozinho NÃO exercita isso.
  const buf = await montado.xlsx.writeBuffer();
  const ExcelJS = (await import("exceljs")).default;
  const lido = new ExcelJS.Workbook();
  await lido.xlsx.load(buf);
  // ⚠️ O ExcelJS NÃO reconstrói `autoFilter` ao ler o arquivo, então essa
  // asserção precisa do workbook montado. Descobri pelo teste falhando com
  // `undefined` — e a diferença importa: "não foi gravado" e "não é relido"
  // parecem a mesma coisa e pedem correções opostas.
  return { lido, montado };
}

/**
 * Rótulo da coluna A → NÚMERO da linha.
 *
 * ⚠️ `eachRow` PULA as linhas vazias, então a posição no array não é o número da
 * linha — foi o que fez 5 asserções lerem a célula errada e devolverem o valor
 * de outro KPI ("6" no lugar de "0,625"). Usar o `n` que o próprio `eachRow`
 * entrega é a única leitura confiável.
 */
function porRotulo(ws) {
  const mapa = new Map();
  ws.eachRow((r, n) => mapa.set(String(r.getCell(1).value ?? ""), n));
  return mapa;
}

console.log("── Comercial (2 séries, com pontuação) ──");
{
  const { lido: wb, montado } = await relê(COMERCIAL);
  eq("abas e ordem", wb.worksheets.map((w) => w.name), ["Resumo", "Por dia", "Por hora"]);

  const ws = wb.getWorksheet("Por dia");
  eq("cabeçalho", ws.getRow(1).values.slice(1), [
    "Dia", "Entraram", "Qualificados", "Frios", "Não concluíram", "Pontos (média)",
  ]);
  eq("linha 1", ws.getRow(2).values.slice(1), ["03/09/2026", 10, 5, 3, 2, 9.4]);
  // Dia sem classificação: média VAZIA, não zero — zero afirmaria que a média é
  // zero, quando não houve o que medir.
  eq("média nula fica vazia", ws.getRow(3).getCell(6).value, null);
  eq("não concluíram = entraram - concluíram", ws.getRow(3).getCell(5).value, 4);
  eq("cabeçalho congelado", ws.views?.[0]?.state, "frozen");
  eq("filtro automático até F", montado.getWorksheet("Por dia").autoFilter?.to, "F3");

  const res = wb.getWorksheet("Resumo");
  const linhaDe = porRotulo(res);
  eq("nome do fluxo no topo", res.getRow(2).getCell(1).value, "Triagem Comercial");
  eq("tem taxa de qualificação", linhaDe.has("Taxa de qualificação"), true);
  // 5 de 8 classificados = 62,5%
  const taxa = res.getRow(linhaDe.get("Taxa de qualificação")).getCell(2);
  eq("taxa como fração de 4 casas", taxa.value, 0.625);
  eq("formato de porcentagem", taxa.numFmt, "0.0%");
  eq("metodologia cita o limiar 9", [...linhaDe.keys()].some((r) => r.includes(">= 9")), true);
}

console.log("── Secretaria (3 séries, SEM pontuação) ──");
{
  const { lido: wb, montado } = await relê(SECRETARIA);
  const ws = wb.getWorksheet("Por dia");
  eq("cabeçalho sem coluna de pontos", ws.getRow(1).values.slice(1), [
    "Dia", "Entraram", "Documentos/Prova Sub", "Imersão Pres. MMA", "Outros", "Não concluíram",
  ]);
  eq("linha real de produção", ws.getRow(2).values.slice(1), ["03/09/2026", 21, 3, 6, 7, 5]);
  // Assunto ausente no mapa tem de virar 0 na célula, não vazio: vazio na
  // planilha lê como "não medido".
  eq("assunto ausente vira 0", ws.getRow(4).values.slice(1), ["30/08/2026", 3, 1, 0, 0, 2]);
  eq("filtro automático até F", montado.getWorksheet("Por dia").autoFilter?.to, "F4");

  const res = wb.getWorksheet("Resumo");
  const linhaDe = porRotulo(res);
  const rotulos = [...linhaDe.keys()];
  /*
   * ⚠️ A régua da secretaria NÃO pode falar de qualificação — é o pedido do
   * Gabriel escrito como teste ("a secretaria não tem qualificado ou perdido").
   */
  eq("sem taxa de qualificação", linhaDe.has("Taxa de qualificação"), false);
  eq("tem 'Escolheram o assunto'", linhaDe.has("Escolheram o assunto"), true);
  eq(
    "metodologia diz que este bot não classifica",
    rotulos.some((r) => r.includes("NÃO classifica lead")),
    true
  );
  eq("metodologia não cita limiar", rotulos.some((r) => r.includes(">= 9")), false);
  // 42 de 58 = 72,41% → 0.7241 (arredondado em 4 casas; sem isso viria
  // 0.7241379310344828 gravado na célula).
  eq("escolheram o assunto, em fração", res.getRow(linhaDe.get("Escolheram o assunto")).getCell(2).value, 0.7241);
  eq("os três assuntos aparecem no resumo", d3(rotulos), true);
}

function d3(rotulos) {
  return ["Documentos/Prova Sub", "Imersão Pres. MMA", "Outros"].every((r) => rotulos.includes(r));
}

console.log("── Aba Por hora ──");
{
  const { lido: wb, montado } = await relê(SECRETARIA);
  eq("três abas, na ordem", wb.worksheets.map((w) => w.name), ["Resumo", "Por dia", "Por hora"]);

  const ws = wb.getWorksheet("Por hora");
  eq("cabeçalho", ws.getRow(1).values.slice(1), [
    "Hora", "Entraram", "% do total",
    "Documentos/Prova Sub", "Imersão Pres. MMA", "Outros", "Não concluíram",
  ]);
  // 24 horas + cabeçalho. ⚠️ É a asserção que garante que a hora com ZERO lead
  // não desaparece da planilha: sem ela a tabela pularia da 01h para a 03h e
  // quem somasse a coluna acharia que a madrugada não existe.
  eq("24 linhas de hora", ws.rowCount, 25);
  eq("a hora 02h existe e vale 0", ws.getRow(4).values.slice(1, 3), ["02h", 0]);
  // Pico real: 12h com 37 leads (linha 2 + 12).
  eq("pico às 12h", ws.getRow(14).values.slice(1, 3), ["12h", 37]);
  // 37 de 339 = 10,91% → 0.1091 (4 casas; sem o arredondamento viria
  // 0.10914454277286136 gravado na célula).
  eq("porcentagem em fração de 4 casas", ws.getRow(14).getCell(3).value, 0.1091);
  eq("formato de porcentagem", ws.getRow(14).getCell(3).numFmt, "0.0%");
  // ⚠️ "08h" como TEXTO, não o número 8: número viraria eixo contínuo no Excel
  // e a ordenação alfabética de um relatório colado perderia a 0h.
  eq("hora é texto com zero à esquerda", ws.getRow(10).getCell(1).value, "08h");
  eq("filtro automático até G", montado.getWorksheet("Por hora").autoFilter?.to, "G25");
}

console.log("── Bordas ──");
{
  // Período sem nenhum dado: não pode estourar, e a barra de dados não pode ser
  // aplicada num intervalo vazio.
  const vazio = {
    ...SECRETARIA,
    linhas: [],
    horas: Array.from({ length: 24 }, (_, h) => ({ hora: h, entraram: 0, concluiram: 0, desfechos: {}, pontosMedio: null })),
    total: { entraram: 0, concluiram: 0, desfechos: {} },
  };
  const { lido: wb } = await relê(vazio);
  eq("período vazio ainda gera as três abas", wb.worksheets.map((w) => w.name), ["Resumo", "Por dia", "Por hora"]);
  eq("só o cabeçalho na aba Por dia", wb.getWorksheet("Por dia").rowCount, 1);
  const res = wb.getWorksheet("Resumo");
  const rot = porRotulo(res);
  // Sem ninguém entrando, a porcentagem fica VAZIA e não 0% — 0% afirmaria que
  // ninguém escolheu o assunto, quando ninguém foi medido.
  eq("porcentagem vazia sem dado", res.getRow(rot.get("Escolheram o assunto")).getCell(2).value, null);
  // Hora sem nada medido: célula VAZIA e não 0% — 0% afirmaria que aquela hora
  // não recebe lead, quando nada foi medido.
  eq("% da hora fica vazia sem dado", wb.getWorksheet("Por hora").getRow(2).getCell(3).value, null);
}

console.log(`\n${ok} asserção(ões) ok · ${falhas} falha(s)`);
process.exit(falhas > 0 ? 1 : 0);
