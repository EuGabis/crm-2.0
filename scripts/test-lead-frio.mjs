/**
 * A temperatura do lead sai da ARITMÉTICA, não do texto.
 *
 * ⚠️ A tentação era `resultado === "frio"`, e ela quebra por dois caminhos que
 * não dão erro nenhum — só pintam a caixa de entrada errado:
 *
 *  1. "frio"/"quente" saem de `hotValue`/`coldValue` do nó `score`, que são
 *     CONFIGURÁVEIS no editor de bot. Renomear "frio" para "morno" apagaria o
 *     selo da tela sem ninguém relacionar as duas coisas.
 *  2. O fluxo da SECRETARIA grava o ASSUNTO em `resultado` ("docs", "outros"),
 *     e comparar texto ali classificaria assunto como temperatura.
 *
 * `pontos`/`limiar` são o par que só existe quando houve nota — a secretaria
 * grava os dois nulos de propósito (202609031955: "NULL diz não pontuou; um
 * zero diria pontuou zero, que é outra coisa").
 *
 * Roda direto no Node 24 (`npm run test:frio`), sem runner de teste.
 */
import { temperaturaDe } from "../src/lib/data/repos/db/bot-desfechos.ts";

let ok = 0;
let falhas = 0;
function eq(rotulo, obtido, esperado) {
  if (obtido === esperado) ok++;
  else {
    falhas++;
    console.error(
      `  x ${rotulo}\n      obtido:   ${JSON.stringify(obtido)}\n      esperado: ${JSON.stringify(esperado)}`,
    );
  }
}

console.log("\ntemperaturaDe() - frio sai da conta, nao do texto\n");

/* O caso do fluxo comercial: limiar 9, como o `score` da Triagem Comercial. */
eq("8 de 9 -> frio", temperaturaDe({ pontos: 8, limiar: 9 }), "frio");
eq("0 de 9 -> frio", temperaturaDe({ pontos: 0, limiar: 9 }), "frio");
eq("9 de 9 (no limiar) -> quente", temperaturaDe({ pontos: 9, limiar: 9 }), "quente");
eq("20 de 9 -> quente", temperaturaDe({ pontos: 20, limiar: 9 }), "quente");

/* ⚠️ O fluxo da SECRETARIA nao pontua: os dois nulos = sem temperatura.
   Tratar como quente inventaria uma nota que ninguem deu; como frio, pior. */
eq("sem nota (secretaria) -> null", temperaturaDe({ pontos: null, limiar: null }), null);
eq("so pontos, sem limiar -> null", temperaturaDe({ pontos: 5, limiar: null }), null);
eq("so limiar, sem pontos -> null", temperaturaDe({ pontos: null, limiar: 9 }), null);

/* Conversa sem desfecho nenhum (nao passou pelo bot, ou passou antes da
   202609031955). O `.get()` do mapa devolve undefined. */
eq("sem desfecho -> null", temperaturaDe(undefined), null);

/* ⚠️ ZERO nao e ausencia. Um lead que pontuou 0 contra limiar 9 e FRIO de
   verdade — se `pontos: 0` caisse no ramo do nulo, o pior lead da base ficaria
   sem selo, que e exatamente o contrario do que o selo existe para fazer. */
eq("pontos 0 com limiar 9 -> frio (zero nao e nulo)", temperaturaDe({ pontos: 0, limiar: 9 }), "frio");
eq("limiar 0 -> quente (qualquer nota atinge)", temperaturaDe({ pontos: 0, limiar: 0 }), "quente");

/* PostgREST devolve numero como string em coluna numerica. O repo ja converte,
   mas a funcao nao pode depender disso. */
eq("valores como STRING funcionam", temperaturaDe({ pontos: "8", limiar: "9" }), "frio");
eq("string quente", temperaturaDe({ pontos: "12", limiar: "9" }), "quente");

/* Lixo nao pode virar classificacao. */
eq("pontos invalido -> null", temperaturaDe({ pontos: "abc", limiar: 9 }), null);
eq("limiar invalido -> null", temperaturaDe({ pontos: 8, limiar: "x" }), null);

/* O texto de `resultado` NAO participa: e o cerne do teste. */
eq(
  "resultado diz 'quente' mas a conta diz frio -> FRIO",
  temperaturaDe({ pontos: 3, limiar: 9, resultado: "quente" }),
  "frio",
);
eq(
  "resultado renomeado para 'morno' nao atrapalha",
  temperaturaDe({ pontos: 2, limiar: 9, resultado: "morno" }),
  "frio",
);
eq(
  "resultado da secretaria ('outros') nao vira temperatura",
  temperaturaDe({ pontos: null, limiar: null, resultado: "outros" }),
  null,
);

console.log(`\n${ok} assercoes ok, ${falhas} falha(s)\n`);
process.exit(falhas ? 1 : 0);
