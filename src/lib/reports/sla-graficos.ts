/**
 * Gráficos do relatório de atendimento, desenhados em canvas para virarem PNG.
 *
 * ⚠️ **Por que imagem, e não gráfico nativo do Excel.** Nenhuma biblioteca de
 * XLSX que roda no navegador escreve gráfico de verdade: o SheetJS não escreve
 * nenhum e no ExcelJS isso está em aberto há anos. Então "planilha com gráfico"
 * só existe de duas formas — barra de dados em célula (nativa, e o relatório usa)
 * e imagem embutida. Aqui é a segunda.
 *
 * ⚠️ **Canvas e não SVG→PNG.** O caminho por SVG exige serializar, carregar numa
 * `Image` e esperar `onload` — assíncrono, sujeito a bloqueio por CSP em `data:`
 * e com fonte que pode não resolver. Canvas desenha e devolve na hora.
 *
 * Desenhado em 2× e exportado no tamanho lógico: no Excel a imagem é ampliada
 * quando se aumenta o zoom, e em 1× o texto do eixo sai borrado.
 */

const ESCALA = 2;

/** Tons do relatório: status (meta/violação) + o indocolor da linha. */
const COR = {
  dentro: "#10b981",
  fora: "#f43f5e",
  linha: "#6366f1",
  areaLinha: "rgba(99,102,241,0.12)",
  eixo: "#cbd5e1",
  grade: "#e9edf3",
  texto: "#475569",
  textoFraco: "#94a3b8",
} as const;

interface Ctx {
  ctx: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
  L: number;
  A: number;
}

function novo(largura: number, altura: number): Ctx | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = largura * ESCALA;
  canvas.height = altura * ESCALA;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(ESCALA, ESCALA);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, largura, altura);
  ctx.textBaseline = "middle";
  return { ctx, canvas, L: largura, A: altura };
}

function fonte(ctx: CanvasRenderingContext2D, px: number, peso = "400") {
  ctx.font = `${peso} ${px}px Segoe UI, Arial, sans-serif`;
}

/**
 * Cumprimento da meta por dia — linha com área.
 *
 * Linha e não barras porque o dado é TENDÊNCIA no tempo: a pergunta é "está
 * melhorando?", e barra por dia num mês vira uma cerca ilegível.
 */
export function pngCumprimentoPorDia(
  serie: { rotulo: string; pct_na_meta: number; recebidas: number }[]
): string | null {
  const c = novo(900, 260);
  if (!c) return null;
  const { ctx, L, A } = c;
  const m = { esq: 46, dir: 16, topo: 18, baixo: 34 };
  const larg = L - m.esq - m.dir;
  const alt = A - m.topo - m.baixo;

  // Grade e eixo Y em 0/25/50/75/100 — escala FIXA, porque porcentagem tem
  // limite conhecido e escala automática faria 40% parecer "quase cheio".
  fonte(ctx, 10);
  for (const p of [0, 25, 50, 75, 100]) {
    const y = m.topo + alt - (p / 100) * alt;
    ctx.strokeStyle = COR.grade;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(m.esq, y);
    ctx.lineTo(m.esq + larg, y);
    ctx.stroke();
    ctx.fillStyle = COR.textoFraco;
    ctx.textAlign = "right";
    ctx.fillText(`${p}%`, m.esq - 8, y);
  }

  if (serie.length === 0) {
    ctx.fillStyle = COR.textoFraco;
    ctx.textAlign = "center";
    ctx.fillText("sem dados no período", L / 2, A / 2);
    return c.canvas.toDataURL("image/png");
  }

  const x = (i: number) =>
    serie.length === 1 ? m.esq + larg / 2 : m.esq + (i / (serie.length - 1)) * larg;
  const y = (p: number) => m.topo + alt - (Math.max(0, Math.min(100, p)) / 100) * alt;

  // Área sob a linha primeiro, depois a linha: a linha fica nítida por cima.
  ctx.beginPath();
  ctx.moveTo(x(0), m.topo + alt);
  serie.forEach((d, i) => ctx.lineTo(x(i), y(d.pct_na_meta)));
  ctx.lineTo(x(serie.length - 1), m.topo + alt);
  ctx.closePath();
  ctx.fillStyle = COR.areaLinha;
  ctx.fill();

  ctx.beginPath();
  serie.forEach((d, i) => (i ? ctx.lineTo(x(i), y(d.pct_na_meta)) : ctx.moveTo(x(i), y(d.pct_na_meta))));
  ctx.strokeStyle = COR.linha;
  ctx.lineWidth = 2;
  ctx.stroke();

  serie.forEach((d, i) => {
    ctx.beginPath();
    ctx.arc(x(i), y(d.pct_na_meta), 2.5, 0, Math.PI * 2);
    ctx.fillStyle = COR.linha;
    ctx.fill();
  });

  // Rótulos do eixo X ralos de propósito: 30 datas lado a lado ficam ilegíveis,
  // então mostra no máximo ~8, sempre incluindo o primeiro e o último dia.
  const passo = Math.max(1, Math.ceil(serie.length / 8));
  ctx.fillStyle = COR.texto;
  ctx.textAlign = "center";
  fonte(ctx, 10);
  serie.forEach((d, i) => {
    if (i % passo !== 0 && i !== serie.length - 1) return;
    ctx.fillText(d.rotulo, x(i), m.topo + alt + 16);
  });
  ctx.strokeStyle = COR.eixo;
  ctx.beginPath();
  ctx.moveTo(m.esq, m.topo + alt);
  ctx.lineTo(m.esq + larg, m.topo + alt);
  ctx.stroke();

  return c.canvas.toDataURL("image/png");
}

/**
 * Em quanto tempo respondemos — barras horizontais por faixa.
 *
 * Horizontal porque os rótulos são frases ("15 a 60 min", "sem resposta"): na
 * vertical eles se inclinam ou truncam. A cor é STATUS (dentro/fora da meta),
 * não identidade — e vem acompanhada do rótulo em texto, porque status por cor
 * sozinha não se lê em impressão em preto e branco nem por quem não distingue
 * verde de vermelho.
 */
export function pngDistribuicao(
  dist: { faixa: string; conversas: number; violacao: boolean }[]
): string | null {
  const c = novo(900, 260);
  if (!c) return null;
  const { ctx, L, A } = c;
  const m = { esq: 96, dir: 76, topo: 14, baixo: 26 };
  const larg = L - m.esq - m.dir;
  const alt = A - m.topo - m.baixo;
  const maior = Math.max(1, ...dist.map((d) => d.conversas));
  const hLinha = dist.length ? alt / dist.length : alt;
  const hBarra = Math.min(26, hLinha * 0.62);

  dist.forEach((d, i) => {
    const cy = m.topo + i * hLinha + hLinha / 2;
    fonte(ctx, 11);
    ctx.fillStyle = COR.texto;
    ctx.textAlign = "right";
    ctx.fillText(d.faixa, m.esq - 10, cy);

    // Piso de 2 px: faixa com 1 conversa não pode desaparecer, senão a tabela
    // e o gráfico discordam sobre quantas faixas existem.
    const w = d.conversas > 0 ? Math.max(2, (d.conversas / maior) * larg) : 0;
    ctx.fillStyle = d.violacao ? COR.fora : COR.dentro;
    ctx.beginPath();
    ctx.roundRect(m.esq, cy - hBarra / 2, w, hBarra, 3);
    ctx.fill();

    ctx.fillStyle = COR.texto;
    ctx.textAlign = "left";
    fonte(ctx, 11, "600");
    ctx.fillText(String(d.conversas), m.esq + w + 8, cy);
    fonte(ctx, 9);
    ctx.fillStyle = d.violacao ? COR.fora : COR.dentro;
    ctx.fillText(d.violacao ? "fora da meta" : "na meta", m.esq + w + 8, cy + 13);
  });

  ctx.strokeStyle = COR.eixo;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(m.esq, m.topo);
  ctx.lineTo(m.esq, m.topo + alt);
  ctx.stroke();

  return c.canvas.toDataURL("image/png");
}
