// npm run test:email-design — design, anexos e template das campanhas de e-mail.
import assert from "node:assert/strict";
import { normalizarDesign, DESIGN_PADRAO, corValida } from "../src/lib/email/design.ts";
import { anexosDe, blocoDeAnexosHtml, blocoDeAnexosTexto, formatarTamanho, nomeSeguro } from "../src/lib/email/anexos.ts";
import { renderCampaignEmail } from "../src/lib/email/marketing-template.ts";

let n = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };
const ok = (c, m) => { assert.ok(c, m); n++; };

// design
eq(normalizarDesign(undefined), DESIGN_PADRAO, "sem design = padrão");
eq(normalizarDesign({}, "#ff0000").corDestaque, "#ff0000", "accent_color legado vale");
eq(normalizarDesign({ corDestaque: "#00ff00" }, "#ff0000").corDestaque, "#00ff00", "design ganha do legado");
eq(normalizarDesign({ corFundo: "red;background:url(x)" }).corFundo, DESIGN_PADRAO.corFundo, "CSS injetado vira padrão");
eq(normalizarDesign({ corTexto: "#ABC" }).corTexto, "#abc", "hex curto aceito");
eq(normalizarDesign({ largura: 9999 }).largura, 720, "largura presa no teto");
eq(normalizarDesign({ tamanhoFonte: "abc" }).tamanhoFonte, 15, "número inválido = padrão");
eq(normalizarDesign({ fonte: "comic" }).fonte, "sistema", "fonte desconhecida = padrão");
eq(normalizarDesign({ cabecalho: "logo", logoUrl: null }).cabecalho, "marca", "logo sem URL volta para o nome");
eq(normalizarDesign({ cabecalho: "logo", logoUrl: "javascript:alert(1)" }).logoUrl, null, "logo só https");
eq(normalizarDesign({ cabecalho: "logo", logoUrl: "https://x.com/a.png" }).cabecalho, "logo", "logo válido");
ok(!corValida("#12345"), "hex de 5 dígitos é inválido");

// anexos
eq(anexosDe(null), [], "coluna ausente = []");
eq(anexosDe([{ name: "a.pdf", url: "https://x/a.pdf", size: 1, type: "" }, { lixo: 1 }]).length, 1, "lixo descartado");
eq(formatarTamanho(1536), "2 KB", "KB");
eq(formatarTamanho(2.5 * 1024 * 1024), "2,5 MB", "MB com vírgula");
eq(nomeSeguro("Proposta Comercial – Março.pdf"), "Proposta-Comercial-Marco.pdf", "nome seguro mantém extensão");
const bloco = blocoDeAnexosHtml([{ name: 'x"<b>.pdf', url: "https://a/b.pdf", size: 2048, type: "" }], "#123456");
ok(bloco.includes("x&quot;&lt;b&gt;.pdf") && !bloco.includes("<b>.pdf"), "nome escapado");
ok(bloco.includes("https://a/b.pdf"), "link presente");
eq(blocoDeAnexosHtml([], "#000"), "", "sem anexo, sem bloco");
ok(blocoDeAnexosTexto([{ name: "a.pdf", url: "https://a", size: 0, type: "" }]).includes("a.pdf: https://a"), "texto");

// template
const base = { subject: "Oi", bodyHtml: "<p>Olá <a href=\"https://x\">link</a></p>", unsubscribeUrl: "https://u" };
const padrao = renderCampaignEmail(base).html;
ok(padrao.includes("#6366f1") && padrao.includes("#131826"), "sem design = visual de antes");
ok(padrao.includes("https://u"), "descadastro sempre presente");
const custom = renderCampaignEmail({
  ...base,
  design: { corDestaque: "#ff0000", corFundo: "#000000", cabecalho: "nenhum", largura: 680, textoRodape: "Assinatura <x>", mostrarEndereco: false },
  anexos: [{ name: "f.pdf", url: "https://f", size: 10, type: "" }],
}).html;
ok(custom.includes("max-width:680px") && custom.includes("background-color:#000000"), "largura e fundo");
ok(!custom.includes("#131826"), "sem cabeçalho");
ok(custom.includes('style="color:#ff0000'), "link com cor de destaque");
ok(custom.includes("Assinatura &lt;x&gt;"), "rodapé escapado");
ok(custom.includes("https://f") && custom.includes("https://u"), "anexo e descadastro");
const comBotao = renderCampaignEmail({ ...base, bodyHtml: '<p data-botao=""><a href="https://b" style="background-color:#111">Ir</a></p>' }).html;
ok(!comBotao.includes('<a style="color:'), "botão com estilo próprio não ganha 2º style");
const img = renderCampaignEmail({ ...base, bodyHtml: '<img src="https://i">' }).html;
ok(img.includes("max-width:100%"), "imagem sem estilo ganha max-width");
console.log(`email-design: ${n} asserções ok`);
