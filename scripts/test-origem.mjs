import { extrairCodigo, gerarCodigo, plataformaDoClique, origemDaMeta, TAM_CODIGO } from "../src/lib/origem/origem.ts";
let ok = 0, falhas = 0;
const eq = (n, a, b) => { if (JSON.stringify(a) === JSON.stringify(b)) ok++; else { falhas++; console.log("  x", n, "\n    obtido:  ", a, "\n    esperado:", b); } };

const c = gerarCodigo();
eq("codigo tem 6", c.length, TAM_CODIGO);
eq("codigo gerado e reconhecido", extrairCodigo(`Olá! Quero saber dos cursos (cód. ${c})`), c);
eq("variacao 'cod AB2CD3'", extrairCodigo("oi cod AB2CD3"), "AB2CD3");
eq("variacao 'ref: ab2cd3' minuscula", extrairCodigo("ref: ab2cd3"), "AB2CD3");
eq("palavra solta NAO vira codigo", extrairCodigo("Quero morar no BRASIL"), null);
eq("caractere fora do alfabeto (0) nao casa", extrairCodigo("cód. AB0CD3"), null);
eq("texto vazio", extrairCodigo(null), null);

eq("gclid -> google", plataformaDoClique({ gclid: "x" }), "google");
eq("wbraid -> google", plataformaDoClique({ wbraid: "x" }), "google");
eq("fbclid -> meta", plataformaDoClique({ fbclid: "x" }), "meta");
eq("utm google", plataformaDoClique({ utm_source: "Google" }), "google");
eq("utm instagram", plataformaDoClique({ utm_source: "instagram" }), "meta");
eq("sem nada -> site", plataformaDoClique({}), "site");
eq("gclid vence utm de outra", plataformaDoClique({ gclid: "x", utm_source: "facebook" }), "google");

eq("referral vazio -> null", origemDaMeta({}), null);
eq("referral com anuncio", origemDaMeta({ source_id: "123", source_type: "ad", headline: "Curso" })?.meta_source_id, "123");

console.log(`${ok} assercoes ok, ${falhas} falha(s)`);
if (falhas) process.exit(1);
