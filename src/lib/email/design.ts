/**
 * Aparência do e-mail de campanha (`email_campaigns.design`, 202610271000).
 *
 * Puro e sem dependência para ter teste. Tudo o que vem daqui vai parar em
 * atributo `style` de um HTML que sai para milhares de caixas de entrada, então
 * `normalizarDesign` é a ÚNICA porta de entrada: cor só passa se for hex, número
 * é preso a uma faixa, texto é escapado no template e URL de logo tem de ser
 * https. Um valor torto vira o padrão, nunca CSS injetado.
 *
 * ⚠️ `DESIGN_PADRAO` reproduz o visual que existia antes do painel de design —
 * campanha antiga (sem `design`) e o e-mail das automações não mudam de cara.
 */

export type FonteKey = "sistema" | "arial" | "helvetica" | "verdana" | "trebuchet" | "georgia" | "times";

/** Só fontes seguras em e-mail: fonte web (Google Fonts) o Outlook ignora. */
export const FONTES: { key: FonteKey; label: string; css: string }[] = [
  {
    key: "sistema",
    label: "Padrão do sistema",
    css: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
  },
  { key: "arial", label: "Arial", css: "Arial,Helvetica,sans-serif" },
  { key: "helvetica", label: "Helvetica", css: "'Helvetica Neue',Helvetica,Arial,sans-serif" },
  { key: "verdana", label: "Verdana", css: "Verdana,Geneva,sans-serif" },
  { key: "trebuchet", label: "Trebuchet", css: "'Trebuchet MS',Tahoma,sans-serif" },
  { key: "georgia", label: "Georgia (serifa)", css: "Georgia,'Times New Roman',serif" },
  { key: "times", label: "Times (serifa)", css: "'Times New Roman',Times,serif" },
];

export type Cabecalho = "marca" | "logo" | "nenhum";

export interface DesignEmail {
  corDestaque: string;
  corFundo: string;
  corConteudo: string;
  corTexto: string;
  corTitulo: string;
  fonte: FonteKey;
  tamanhoFonte: number;
  largura: number;
  cantos: number;
  espacamento: number;
  cabecalho: Cabecalho;
  corCabecalho: string;
  corTextoCabecalho: string;
  textoCabecalho: string;
  logoUrl: string | null;
  alturaLogo: number;
  alinhamentoCabecalho: "esquerda" | "centro";
  faixaDestaque: boolean;
  corRodape: string;
  textoRodape: string;
  mostrarEndereco: boolean;
}

export const DESIGN_PADRAO: DesignEmail = {
  corDestaque: "#6366f1",
  corFundo: "#f1f5f9",
  corConteudo: "#ffffff",
  corTexto: "#334155",
  corTitulo: "#0f172a",
  fonte: "sistema",
  tamanhoFonte: 15,
  largura: 600,
  cantos: 16,
  espacamento: 32,
  cabecalho: "marca",
  corCabecalho: "#131826",
  corTextoCabecalho: "#ffffff",
  textoCabecalho: "",
  logoUrl: null,
  alturaLogo: 40,
  alinhamentoCabecalho: "esquerda",
  faixaDestaque: true,
  corRodape: "#f8fafc",
  textoRodape: "",
  mostrarEndereco: true,
};

export const LIMITES = {
  tamanhoFonte: [12, 20],
  largura: [480, 720],
  cantos: [0, 32],
  espacamento: [16, 48],
  alturaLogo: [24, 96],
} as const;

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export function corValida(v: unknown): v is string {
  return typeof v === "string" && HEX.test(v.trim());
}

function cor(v: unknown, padrao: string): string {
  return corValida(v) ? v.trim().toLowerCase() : padrao;
}

function num(v: unknown, [min, max]: readonly [number, number], padrao: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return padrao;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function texto(v: unknown, max: number): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}

/**
 * Lê o jsonb (ou o que vier) e devolve um design COMPLETO e seguro.
 * `corLegada` é a coluna `accent_color` de antes do painel: vale quando o
 * design não diz a cor de destaque.
 */
export function normalizarDesign(raw: unknown, corLegada?: string | null): DesignEmail {
  const d = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const P = DESIGN_PADRAO;
  const fonte = FONTES.some((f) => f.key === d.fonte) ? (d.fonte as FonteKey) : P.fonte;
  const cab: Cabecalho = d.cabecalho === "logo" || d.cabecalho === "nenhum" ? d.cabecalho : "marca";
  const logo = typeof d.logoUrl === "string" && /^https:\/\/[^\s"'<>]+$/i.test(d.logoUrl) ? d.logoUrl : null;
  return {
    corDestaque: cor(d.corDestaque, cor(corLegada, P.corDestaque)),
    corFundo: cor(d.corFundo, P.corFundo),
    corConteudo: cor(d.corConteudo, P.corConteudo),
    corTexto: cor(d.corTexto, P.corTexto),
    corTitulo: cor(d.corTitulo, P.corTitulo),
    fonte,
    tamanhoFonte: num(d.tamanhoFonte, LIMITES.tamanhoFonte, P.tamanhoFonte),
    largura: num(d.largura, LIMITES.largura, P.largura),
    cantos: num(d.cantos, LIMITES.cantos, P.cantos),
    espacamento: num(d.espacamento, LIMITES.espacamento, P.espacamento),
    // Logo escolhido mas sem URL válida volta para a marca escrita: cabeçalho
    // com uma imagem quebrada é pior que o nome da empresa.
    cabecalho: cab === "logo" && !logo ? "marca" : cab,
    corCabecalho: cor(d.corCabecalho, P.corCabecalho),
    corTextoCabecalho: cor(d.corTextoCabecalho, P.corTextoCabecalho),
    textoCabecalho: texto(d.textoCabecalho, 60),
    logoUrl: logo,
    alturaLogo: num(d.alturaLogo, LIMITES.alturaLogo, P.alturaLogo),
    alinhamentoCabecalho: d.alinhamentoCabecalho === "centro" ? "centro" : "esquerda",
    faixaDestaque: typeof d.faixaDestaque === "boolean" ? d.faixaDestaque : P.faixaDestaque,
    corRodape: cor(d.corRodape, P.corRodape),
    textoRodape: texto(d.textoRodape, 500),
    mostrarEndereco: typeof d.mostrarEndereco === "boolean" ? d.mostrarEndereco : P.mostrarEndereco,
  };
}

export function cssDaFonte(k: FonteKey): string {
  return (FONTES.find((f) => f.key === k) ?? FONTES[0]).css;
}

/** Temas prontos: ponto de partida, não prisão — tudo segue editável depois. */
export const TEMAS: { key: string; label: string; design: Partial<DesignEmail> }[] = [
  { key: "lito", label: "Lito (padrão)", design: {} },
  {
    key: "aviacao",
    label: "Aviação",
    design: {
      corDestaque: "#0369a1", corFundo: "#e0f2fe", corCabecalho: "#0c4a6e",
      corTitulo: "#0c4a6e", corTexto: "#334155", cantos: 12, fonte: "helvetica",
    },
  },
  {
    key: "minimalista",
    label: "Minimalista",
    design: {
      corDestaque: "#111827", corFundo: "#ffffff", corConteudo: "#ffffff",
      cabecalho: "nenhum", faixaDestaque: false, cantos: 0, corTexto: "#374151",
      corTitulo: "#111827", corRodape: "#ffffff", fonte: "arial", tamanhoFonte: 16,
    },
  },
  {
    key: "elegante",
    label: "Elegante",
    design: {
      corDestaque: "#b45309", corFundo: "#f5f5f4", corCabecalho: "#1c1917",
      corTitulo: "#1c1917", corTexto: "#44403c", fonte: "georgia", cantos: 4,
      alinhamentoCabecalho: "centro", tamanhoFonte: 16,
    },
  },
  {
    key: "vibrante",
    label: "Vibrante",
    design: {
      corDestaque: "#db2777", corFundo: "#fdf2f8", corCabecalho: "#831843",
      corTitulo: "#831843", cantos: 24, fonte: "trebuchet", alinhamentoCabecalho: "centro",
    },
  },
  {
    key: "natureza",
    label: "Verde",
    design: {
      corDestaque: "#059669", corFundo: "#ecfdf5", corCabecalho: "#064e3b",
      corTitulo: "#064e3b", cantos: 14, fonte: "verdana", tamanhoFonte: 14,
    },
  },
];
