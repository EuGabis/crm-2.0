#!/usr/bin/env node
/**
 * Testes de `src/lib/bot/score.ts` — o peso de cada resposta no nó `score`.
 *
 * O caso [real] é o do lead João Lucas (13/10/2026): "Em 2 ou 3 meses" (6) +
 * "Parcelado no cartão" (8) = 14, e o bot somou 8 e mandou a mensagem de frio,
 * porque o editor gravou o peso pelo TÍTULO e o motor procurava pelo VALOR.
 *
 * Rodar: `npm run test:bot`
 */
const { pesoDaResposta, chaveDoPeso } = await import("../src/lib/bot/score.ts");

let ok = 0;
const falhas = [];
const eq = (nome, real, esperado) =>
  JSON.stringify(real) === JSON.stringify(esperado)
    ? ok++
    : falhas.push(`${nome}\n      esperado: ${JSON.stringify(esperado)}\n      obtido:   ${JSON.stringify(real)}`);

const inicio = [
  { title: "Quero começar agora", value: "Quero começar agora" },
  { title: "Em 2 ou 3 meses", value: "Nos próximos 2 ou 3 meses" },
  { title: "Só pesquisando", value: "Só estou pesquisando por enquanto" },
];
const investimento = [
  { title: "À vista", value: "À vista" },
  { title: "Parcelado no cartão", value: "Parcelado no cartão" },
  { title: "Preciso de ajuda", value: "Preciso de ajuda pra encontrar uma condição que caiba no meu bolso" },
];

// Como estava salvo no banco em 13/10: pesos pelo TÍTULO.
const porTitulo = {
  inicio: { "quero comecar agora": 10, "em 2 ou 3 meses": 6, "so pesquisando": 0 },
  investimento: { "a vista": 10, "parcelado no cartao": 8, "preciso de ajuda": 4 },
};
const somaJoao =
  pesoDaResposta(porTitulo.inicio, inicio, "Nos próximos 2 ou 3 meses") +
  pesoDaResposta(porTitulo.investimento, investimento, "Parcelado no cartão");
eq("[real] João Lucas: 6 + 8 = 14 com os pesos salvos pelo título", somaJoao, 14);
eq("[real] e isso é quente (>= 10)", somaJoao >= 10, true);

// Pesos pelo VALOR (o que a migração e o editor corrigido gravam).
const porValor = { "nos proximos 2 ou 3 meses": 6, "quero comecar agora": 10 };
eq("pelo valor", pesoDaResposta(porValor, inicio, "Nos próximos 2 ou 3 meses"), 6);
eq("valor tem prioridade sobre título", pesoDaResposta({ ...porValor, "em 2 ou 3 meses": 99 }, inicio, "Nos próximos 2 ou 3 meses"), 6);
eq("acento e caixa não importam", pesoDaResposta({ "a vista": 10 }, investimento, "À VISTA"), 10);
eq("opção longa pelo título", pesoDaResposta(porTitulo.investimento, investimento, "Preciso de ajuda pra encontrar uma condição que caiba no meu bolso"), 4);
eq("resposta desconhecida vale 0", pesoDaResposta(porTitulo.inicio, inicio, "talvez"), 0);
eq("sem opções, só a tabela", pesoDaResposta({ agora: 10 }, undefined, "Agora"), 10);
eq("resposta vazia vale 0", pesoDaResposta(porTitulo.inicio, inicio, undefined), 0);
eq("peso zero de verdade continua zero", pesoDaResposta(porTitulo.inicio, inicio, "Só estou pesquisando por enquanto"), 0);
eq("chave do peso é o valor", chaveDoPeso(inicio[1]), "nos proximos 2 ou 3 meses");
eq("sem valor, a chave é o título", chaveDoPeso({ title: "Agora" }), "agora");

if (falhas.length) {
  for (const f of falhas) console.error(`  ✗ ${f}`);
  console.error(`\n  ${ok} passaram, ${falhas.length} FALHARAM\n`);
  process.exit(1);
}
console.log(`  ✓ ${ok} asserções do score passaram\n`);
