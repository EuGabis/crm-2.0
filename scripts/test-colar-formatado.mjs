// Colar texto formatado (Word/Docs/página) → formatação do WhatsApp (*negrito*, _itálico_, etc).
import { htmlParaWhatsapp, temFormatacaoRelevante } from "../src/lib/whatsapp/colar-formatado.ts";

let ok = 0, falhas = 0;
const eq = (nome, a, b) => {
  if (a === b) { ok++; console.log("  ✓", nome); }
  else { falhas++; console.log("  x", nome, "→", JSON.stringify(a), "≠", JSON.stringify(b)); }
};

// --- temFormatacaoRelevante: quando vale a pena interceptar o paste ---
eq("parágrafo simples sem formatação → não intercepta", temFormatacaoRelevante("<p>Olá, tudo bem?</p>"), false);
eq("com <strong> → intercepta", temFormatacaoRelevante("<p><strong>Oi</strong></p>"), true);
eq("com estilo font-weight:700 (Google Docs) → intercepta", temFormatacaoRelevante('<span style="font-weight:700">Oi</span>'), true);
eq("com lista → intercepta", temFormatacaoRelevante("<ul><li>a</li></ul>"), true);

// --- htmlParaWhatsapp: o caso do print (lista de preço) ---
eq(
  "negrito por tag + quebra de linha por <br>",
  htmlParaWhatsapp("<b>Básico + Célula</b> — 10x de R$ 598,70<br>https://checkout.litoacademy.com.br/x"),
  "*Básico + Célula* — 10x de R$ 598,70\nhttps://checkout.litoacademy.com.br/x",
);

eq(
  "Google Docs: negrito por style (não por tag)",
  htmlParaWhatsapp('<span style="font-weight:700;color:#000">Sobre o investimento:</span>'),
  "*Sobre o investimento:*",
);

eq(
  "itálico por tag",
  htmlParaWhatsapp("<p>Isso é <em>muito</em> importante</p>"),
  "Isso é _muito_ importante",
);

eq(
  "tachado",
  htmlParaWhatsapp("<p>De <s>R$ 800</s> por R$ 640</p>"),
  "De ~R$ 800~ por R$ 640",
);

eq(
  "monoespaçado (cupom)",
  htmlParaWhatsapp("<p>CUPOM: <code>BLACK38</code></p>"),
  "CUPOM: ```BLACK38```",
);

eq(
  "lista vira linhas com traço",
  htmlParaWhatsapp("<ul><li>Básico + Célula</li><li>Básico + GMP</li></ul>"),
  "- Básico + Célula\n- Básico + GMP",
);

eq(
  "parágrafos viram linhas, sem duplicar quebra",
  htmlParaWhatsapp("<p>Primeiro</p><p>Segundo</p>"),
  "Primeiro\nSegundo",
);

eq(
  "espaço DENTRO da tag sai para fora do marcador (senão o WhatsApp não formata)",
  htmlParaWhatsapp("<p>Olá<b> Básico </b>fim</p>"),
  "Olá *Básico* fim",
);

eq(
  "negrito vazio não vira '**' solto",
  htmlParaWhatsapp("<p>Texto <b></b> normal</p>"),
  "Texto  normal",
);

eq(
  "entidades decodificadas",
  htmlParaWhatsapp("<p>10x&nbsp;de&nbsp;R$&amp;nbsp;598</p>"),
  "10x de R$&nbsp;598",
);

eq(
  "três quebras de linha viram UMA linha em branco, não três",
  htmlParaWhatsapp("<p>A</p><br><br><br><p>B</p>"),
  "A\n\nB",
);

eq(
  "negrito e itálico combinados (aninhados)",
  htmlParaWhatsapp("<p><strong>Título <em>forte</em></strong></p>"),
  "*Título _forte_*",
);

eq(
  "fragmento do Word: só o StartFragment/EndFragment entra",
  htmlParaWhatsapp(
    "<html><body>lixo da página<!--StartFragment--><b>Oferta</b><!--EndFragment-->rodapé</body></html>",
  ),
  "*Oferta*",
);

eq(
  "script/style não viram texto",
  htmlParaWhatsapp("<style>.x{color:red}</style><p>Preço: R$ 10</p><script>alert(1)</script>"),
  "Preço: R$ 10",
);

console.log(`\n${ok} assercoes ok, ${falhas} falha(s)\n`);
process.exit(falhas ? 1 : 0);
