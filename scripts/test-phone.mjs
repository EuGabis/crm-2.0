#!/usr/bin/env node
/**
 * Testes de `src/lib/whatsapp/phone.ts` — normalização do número para a Cloud API.
 *
 * ⚠️ **Um erro aqui manda a mensagem para outra pessoa, ou para ninguém.** Foi o
 * que aconteceu em 02/09/2026: a regra antiga prefixava `55` em qualquer número
 * de 10–11 dígitos cujos dois primeiros fossem um DDD válido, e vários códigos de
 * país colidem com DDD brasileiro. 219 contatos recebiam mensagem endereçada a um
 * número inexistente, e a Meta respondia #131026 Message Undeliverable.
 *
 * Os casos marcados [real] são números que ESTAVAM no banco falhando.
 *
 * Metade dos casos vigia o lado oposto — não estragar o número brasileiro, que é
 * a maioria absoluta da base. Uma regra estrita demais aqui é pior que o bug:
 * pararia de entregar para 41 mil contatos em vez de 219.
 *
 * Rodar: `npm run test:phone`
 */

const { toWhatsAppNumber } = await import("../src/lib/whatsapp/phone.ts");

let ok = 0;
const falhas = [];

function eq(nome, entrada, esperado) {
  const real = toWhatsAppNumber(entrada);
  if (real === esperado) ok++;
  else
    falhas.push(
      `${nome}\n      entrada:  ${JSON.stringify(entrada)}` +
        `\n      esperado: ${JSON.stringify(esperado)}\n      obtido:   ${JSON.stringify(real)}`,
    );
}

/* ================================================================== *
 * O bug: código de país que parece DDD
 * ================================================================== */
console.log("\n  Estrangeiro sem '+' — o defeito de 02/09");

// "61" é o DDD do Distrito Federal E o código da Austrália.
eq("[real] Austrália +61 412 914 627", "61412914627", "61412914627");
// "15" é Sorocaba; "1" é EUA/Canadá seguido de 514 (Montreal).
eq("[real] Canadá +1 514 963 5422", "15149635422", "15149635422");
// "16" é Ribeirão Preto; aqui é +1 647 (Toronto).
eq("[real] Canadá +1 647 289 5906", "16472895906", "16472895906");
// 12 dígitos: já não entrava na regra antiga, e continua intacto.
eq("[real] Reino Unido +44 7379 647903", "447379647903", "447379647903");
// "21" é Rio; "2" é código de vários países africanos.
eq("11 dígitos começando em DDD, assinante não-9", "21412345678", "21412345678");

/* ================================================================== *
 * O lado que NÃO pode quebrar: número brasileiro
 * ================================================================== */
console.log("  Brasileiro — o que não pode parar de funcionar");

eq("celular BA sem país", "77999331370", "5577999331370");
eq("celular SP sem país", "11987654321", "5511987654321");
eq("celular formatado", "(11) 98765-4321", "5511987654321");
eq("celular com espaços e hífen", "11 98765 4321", "5511987654321");
eq("fixo SP (8 dígitos, começa com 3)", "1133334444", "551133334444");
eq("fixo começando com 2", "2122223333", "552122223333");
eq("fixo começando com 5", "1155556666", "551155556666");
eq("já com o 55 (13 dígitos)", "5511999998888", "5511999998888");
eq("já com o 55 (12 dígitos, fixo)", "551133334444", "551133334444");
eq("com o 55 e formatado", "+55 (11) 99999-8888", "5511999998888");

/* ================================================================== *
 * O "+" resolve tudo — é a saída recomendada
 * ================================================================== */
console.log("  Com '+' — país explícito, sem adivinhação");

eq("+1 Canadá", "+1 514 963 5422", "15149635422");
eq("+61 Austrália", "+61 412 914 627", "61412914627");
eq("+351 Portugal", "+351 912 345 678", "351912345678");
eq("+44 Reino Unido", "+44 7379 647903", "447379647903");
// ⚠️ Com "+", nem um número que PARECE brasileiro leva 55 na frente: o país
// está declarado, e sobrescrever isso seria ignorar o que a pessoa informou.
eq("+55 explícito", "+5577999331370", "5577999331370");

/* ================================================================== *
 * Bordas
 * ================================================================== */
console.log("  Bordas");

eq("vazio", "", "");
eq("só espaços", "   ", "");
eq("nulo", null, "");
eq("indefinido", undefined, "");
eq("só pontuação", "()- ", "");
// DDD inexistente (20, 23, 25, 26, 29, 30… não existem no Brasil): não inventa
// país, devolve como veio.
eq("DDD 20 não existe", "20987654321", "20987654321");
eq("DDD 99 existe (MA)", "99987654321", "5599987654321");
// Curto demais para ser qualquer coisa: passa direto, e quem recusa é a Meta.
eq("curto", "12345", "12345");

/* ------------------------------------------------------------------ *
 * ⚠️ O caso ambíguo, escrito como teste para não ser "corrigido" sem pensar
 * ------------------------------------------------------------------ */
console.log("  O ambíguo (documentado, não é defeito)");

/*
 * 10 dígitos que são, ao mesmo tempo, fixo brasileiro plausível ("(95) 4937-3665",
 * Roraima) e internacional plausível ("+1 954 937 3665", Flórida). Pelos dígitos
 * não há como decidir. A escolha é tratar como brasileiro, porque é o caso muito
 * mais comum nesta base — e quem precisa do outro salva com "+".
 */
eq("[real] 10 dígitos ambíguo → assume BR", "9549373665", "559549373665");
eq("o mesmo número com '+' → respeita o país", "+19549373665", "19549373665");

/* ------------------------------------------------------------------ */
console.log("");
if (falhas.length) {
  for (const f of falhas) console.error(`  ✗ ${f}`);
  console.error(`\n  ${ok} passaram, ${falhas.length} FALHARAM\n`);
  process.exit(1);
}
console.log(`  ✓ ${ok} asserções passaram\n`);
