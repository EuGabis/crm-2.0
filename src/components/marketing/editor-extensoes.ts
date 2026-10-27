import { Node, mergeAttributes } from "@tiptap/react";
import Image from "@tiptap/extension-image";
import { corValida } from "@/lib/email/design";

/*
 * Extensões do editor de campanha. Todas renderizam ESTILO INLINE: o HTML vai
 * direto para o e-mail, e cliente de e-mail ignora classe CSS.
 */

export type LarguraImagem = "pequena" | "media" | "inteira";
export type Alinhamento = "left" | "center" | "right";

const LARGURA_CSS: Record<LarguraImagem, string> = { pequena: "33%", media: "60%", inteira: "100%" };

function margemDe(al: Alinhamento): string {
  return al === "center" ? "8px auto" : al === "right" ? "8px 0 8px auto" : "8px 0";
}

/** Imagem com tamanho e alinhamento escolhidos no editor. */
export const ImagemEmail = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      largura: {
        default: "inteira",
        parseHTML: (el) => (el.getAttribute("data-largura") as LarguraImagem) || "inteira",
        renderHTML: () => ({}),
      },
      alinhamento: {
        default: "center",
        parseHTML: (el) => (el.getAttribute("data-alinhamento") as Alinhamento) || "center",
        renderHTML: () => ({}),
      },
    };
  },
  renderHTML({ HTMLAttributes, node }) {
    const largura = (LARGURA_CSS[node.attrs.largura as LarguraImagem] ?? "100%") as string;
    const al = (node.attrs.alinhamento as Alinhamento) ?? "center";
    return [
      "img",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-largura": node.attrs.largura,
        "data-alinhamento": al,
        style: `display:block;width:${largura};max-width:100%;height:auto;border:0;margin:${margemDe(al)};border-radius:8px;`,
      }),
    ];
  },
});

export interface AtributosBotao {
  href: string;
  texto: string;
  cor: string;
  corTexto: string;
  alinhamento: Alinhamento;
  raio: number;
  largo: boolean;
}

/** Só http(s), mailto e tel: `javascript:` num botão de e-mail seria XSS na prévia. */
export function hrefSeguro(v: unknown): string {
  const s = typeof v === "string" ? v.trim() : "";
  return /^(https?:\/\/|mailto:|tel:)/i.test(s) ? s : "#";
}

/**
 * Botão de chamada (CTA). Um nó atômico — o texto não é editável no corpo,
 * só pelo diálogo — porque um <a> com fundo, padding e borda sobrevive no
 * Gmail/Outlook como bloco; um link comum estilizado à mão não.
 */
export const BotaoEmail = Node.create({
  name: "botaoEmail",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      href: { default: "https://" },
      texto: { default: "Saiba mais" },
      cor: { default: "#6366f1" },
      corTexto: { default: "#ffffff" },
      alinhamento: { default: "center" },
      raio: { default: 8 },
      largo: { default: false },
    };
  },

  parseHTML() {
    return [
      {
        tag: "p[data-botao]",
        getAttrs: (el) => {
          const p = el as HTMLElement;
          const a = p.querySelector("a");
          return {
            href: a?.getAttribute("href") ?? "https://",
            texto: a?.textContent ?? "Saiba mais",
            cor: p.getAttribute("data-cor") ?? "#6366f1",
            corTexto: p.getAttribute("data-cor-texto") ?? "#ffffff",
            alinhamento: p.getAttribute("data-alinhamento") ?? "center",
            raio: Number(p.getAttribute("data-raio") ?? 8),
            largo: p.getAttribute("data-largo") === "1",
          };
        },
      },
    ];
  },

  renderHTML({ node }) {
    const a = node.attrs as AtributosBotao;
    const cor = corValida(a.cor) ? a.cor : "#6366f1";
    const corTexto = corValida(a.corTexto) ? a.corTexto : "#ffffff";
    const al: Alinhamento = a.alinhamento === "left" || a.alinhamento === "right" ? a.alinhamento : "center";
    const raio = Math.min(40, Math.max(0, Number(a.raio) || 0));
    return [
      "p",
      {
        "data-botao": "",
        "data-cor": cor,
        "data-cor-texto": corTexto,
        "data-alinhamento": al,
        "data-raio": String(raio),
        "data-largo": a.largo ? "1" : "0",
        style: `text-align:${al};margin:20px 0;`,
      },
      [
        "a",
        {
          href: hrefSeguro(a.href),
          target: "_blank",
          rel: "noopener noreferrer",
          style:
            `display:${a.largo ? "block" : "inline-block"};background-color:${cor};color:${corTexto};` +
            `padding:13px 28px;border-radius:${raio}px;font-weight:700;font-size:15px;` +
            `text-decoration:none;text-align:center;`,
        },
        a.texto || "Saiba mais",
      ],
    ];
  },
});
