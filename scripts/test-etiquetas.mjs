/**
 * O que é ETIQUETA e o que é carimbo de importação.
 *
 * ⚠️ `contacts.tags` guarda as duas coisas misturadas: a categoria que a equipe
 * marca e o carimbo de procedência que o CSV do CRM antigo trouxe
 * (`lito-avioes-e-musicas_export...`, presente em quase toda a base). Como a
 * linha da conversa mostra no máximo duas etiquetas, o carimbo tomava as duas e
 * a etiqueta marcada caía no "+2" — o print do relato de 2026-09-09.
 *
 * Quem decide é o CATÁLOGO (lista de permissão), não um padrão de nome: um
 * `startsWith("lito-avioes")` esconderia este carimbo e nenhum outro, e a
 * próxima importação traria outro nome.
 *
 * Roda direto no Node 24 (`npm run test:etiquetas`), sem runner de teste.
 */
import { etiquetasVisiveis, noCatalogo } from "../src/lib/data/repos/db/tags.ts";

let ok = 0;
let falhas = 0;
function eq(rotulo, obtido, esperado) {
  const a = JSON.stringify(obtido);
  const b = JSON.stringify(esperado);
  if (a === b) ok++;
  else {
    falhas++;
    console.error(`  x ${rotulo}\n      obtido:   ${a}\n      esperado: ${b}`);
  }
}

/* O catálogo real, recortado: curadas + o que a absorção da 202609091600 trouxe. */
const CAT = [
  { name: "INTERESSADO PP" },
  { name: "Aluno MMA" },
  { name: "QUENTE" },
  { name: "formulário mma" },
];

console.log("\netiquetasVisiveis() - o catalogo decide o que aparece\n");

/* [real] O caso do print: duas do carimbo e a etiqueta de verdade escondida. */
eq(
  "[real] carimbo da importacao nao aparece",
  etiquetasVisiveis(
    ["lito-avioes-e-musicas_export", "lito-avioes-e-musicas_export_2024", "INTERESSADO PP"],
    CAT,
    true
  ),
  ["INTERESSADO PP"]
);
eq(
  "[real] contato SO com carimbo -> nenhuma etiqueta",
  etiquetasVisiveis(["lito-avioes-e-musicas_export"], CAT, true),
  []
);
eq(
  "[real] etiqueta de formulario continua aparecendo",
  etiquetasVisiveis(["formulário mma", "lito-avioes-e-musicas_export"], CAT, true),
  ["formulário mma"]
);

/* ⚠️ O indice do catalogo e unico por lower(name): as duas grafias sao a MESMA
   etiqueta. Comparar texto cru esconderia a do contato como se fosse lixo. */
eq(
  "grafia diferente casa e sai canonica",
  etiquetasVisiveis(["interessado pp"], CAT, true),
  ["INTERESSADO PP"]
);
eq(
  "duas grafias da mesma etiqueta viram UMA linha",
  etiquetasVisiveis(["QUENTE", "quente", "Quente"], CAT, true),
  ["QUENTE"]
);
eq(
  "espaco sobrando nao quebra o casamento",
  etiquetasVisiveis(["  Aluno MMA "], CAT, true),
  ["Aluno MMA"]
);

/* A ordem e a do CONTATO, nao a do catalogo: e a ordem em que foi marcada. */
eq(
  "preserva a ordem do contato",
  etiquetasVisiveis(["QUENTE", "Aluno MMA"], CAT, true),
  ["QUENTE", "Aluno MMA"]
);

/* ⚠️ Catalogo NAO carregado devolve vazio: mostrar o carimbo por meio segundo
   ate a consulta voltar e a piscada que o pedido reclama. */
eq(
  "catalogo nao carregado -> vazio (sem piscada)",
  etiquetasVisiveis(["INTERESSADO PP"], [], false),
  []
);
eq(
  "catalogo nao carregado, mesmo com itens -> vazio",
  etiquetasVisiveis(["INTERESSADO PP"], CAT, false),
  []
);

/* ⚠️ Catalogo carregado e VAZIO devolve TUDO: ai nao ha como distinguir (empresa
   sem etiqueta, ou migracao nao aplicada), e esconder dado real seria pior. */
eq(
  "catalogo vazio -> devolve tudo (nao esconde dado real)",
  etiquetasVisiveis(["qualquer coisa", "outra"], [], true),
  ["qualquer coisa", "outra"]
);

/* Bordas que chegam do banco: coluna nula, array vazio, string vazia. */
eq("tags null -> vazio", etiquetasVisiveis(null, CAT, true), []);
eq("tags undefined -> vazio", etiquetasVisiveis(undefined, CAT, true), []);
eq("array vazio -> vazio", etiquetasVisiveis([], CAT, true), []);
eq(
  "string vazia no array e descartada",
  etiquetasVisiveis(["", "   ", "QUENTE"], CAT, true),
  ["QUENTE"]
);
eq(
  "string vazia com catalogo vazio tambem e descartada",
  etiquetasVisiveis(["", "x"], [], true),
  ["x"]
);

console.log("\nnoCatalogo()\n");
eq("etiqueta curada esta no catalogo", noCatalogo("INTERESSADO PP", CAT), true);
eq("grafia diferente tambem esta", noCatalogo("interessado pp", CAT), true);
eq("carimbo da importacao NAO esta", noCatalogo("lito-avioes-e-musicas_export", CAT), false);
eq("catalogo vazio -> nada esta", noCatalogo("QUENTE", []), false);

console.log(`\n${ok} assercoes ok, ${falhas} falha(s)\n`);
process.exit(falhas ? 1 : 0);
