/**
 * O relatorio por CURSO: o numero de cada linha e a lista que ela abre tem de
 * sair do MESMO predicado.
 *
 * 🔴 O risco que estes casos travam nao da erro nenhum. A tabela conta com
 * `agruparPorCurso` e a lista filtra com `leadsDoCurso`; se as duas divergirem,
 * a linha diz "88" e abre uma lista de 86 — sem nada quebrar, so minando a
 * confianca no relatorio inteiro. E a mesma licao de `noRecorte` (16/09).
 *
 * Roda direto no Node 24 (`npm run test:cursos`), sem runner de teste.
 */
import {
  SEM_CURSO,
  SEM_RESPONSAVEL,
  agruparPorCurso,
  filtrarPorResponsavel,
  leadsDoCurso,
  totaisDeCurso,
} from "../src/lib/reports/cursos.ts";

let ok = 0;
let falhas = 0;
function eq(rotulo, obtido, esperado) {
  const bate = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (bate) ok++;
  else {
    falhas++;
    console.error(
      `  FALHOU  ${rotulo}\n    obtido:   ${JSON.stringify(obtido)}\n    esperado: ${JSON.stringify(esperado)}`
    );
    return;
  }
  console.log(`  ok  ${rotulo}`);
}

const lead = (curso, atendente, extra = {}) => ({
  curso,
  atendente,
  resultado: extra.resultado ?? null,
  finalizada: extra.finalizada ?? false,
  ganha: extra.ganha ?? false,
});

/*
 * Os nomes sao os do print do pedido — cursos reais desta operacao, inclusive os
 * dois que comecam igual ("Mecanico de Aeronaves Basico + Celula" e
 * "... + Celula + Avionica + GMP"), que e onde um casamento por prefixo
 * quebraria.
 */
const MMA = "Mecanico de Aeronaves Basico + Celula";
const MMA_LONGO = "Mecanico de Aeronaves Basico + Celula + Avionica + GMP";
const PP = "Piloto Privado Teorico";

const base = [
  lead(MMA, "alberto", { resultado: "quente" }),
  lead(MMA, "alberto", { resultado: "frio" }),
  lead(MMA, "paulo", { resultado: "quente", ganha: true, finalizada: true }),
  lead(PP, "paulo", { resultado: "quente" }),
  lead(MMA_LONGO, "rogerio", {}),
  lead(null, "alberto", { resultado: "frio" }),
  lead(null, null, {}),
];

console.log("\nagruparPorCurso() - a linha e a lista dizem a mesma coisa\n");

{
  const linhas = agruparPorCurso(base);

  eq(
    "ordem: maior primeiro, sem curso no FIM",
    linhas.map((l) => l.curso),
    [MMA, MMA_LONGO, PP, SEM_CURSO]
  );

  /*
   * 🔴 A assercao que importa: para CADA linha, o numero contado e o tamanho da
   * lista que o clique abre. Se um dia alguem mudar um dos dois lados, e aqui
   * que aparece.
   */
  for (const l of linhas) {
    eq(`"${l.curso}": numero == tamanho da lista`, l.recebeu, leadsDoCurso(base, l.curso).length);
  }

  eq("MMA: 2 quentes, 1 frio, 1 ganho, 1 finalizada", {
    recebeu: linhas[0].recebeu,
    qualificados: linhas[0].qualificados,
    frios: linhas[0].frios,
    ganhas: linhas[0].ganhas,
    finalizadas: linhas[0].finalizadas,
  }, { recebeu: 3, qualificados: 2, frios: 1, ganhas: 1, finalizadas: 1 });

  /*
   * ⚠️ Nome que comeca igual e OUTRO curso. O casamento e por igualdade exata —
   * com `startsWith` ou `includes`, "Mecanico ... + Celula" engoliria
   * "Mecanico ... + Celula + Avionica + GMP" e a linha somaria dois cursos
   * diferentes num numero so.
   */
  eq("prefixo NAO engole o curso mais longo", leadsDoCurso(base, MMA).length, 3);
  eq("o curso longo tem a propria linha", leadsDoCurso(base, MMA_LONGO).length, 1);

  eq("sem curso: os 2 leads sem marcacao", leadsDoCurso(base, SEM_CURSO).length, 2);

  // Quem esta com cada lead do curso — e a coluna "atendentes" da tabela.
  eq("MMA por atendente", linhas[0].porAtendente, { alberto: 2, paulo: 1 });

  eq("lista vazia nao inventa linha", agruparPorCurso([]), []);

  /*
   * ⚠️ Sem NENHUM curso marcado, existe UMA linha (a dos sem marcacao) — e nao
   * zero. Uma tabela vazia diria "nenhum lead", quando a verdade e "nenhum lead
   * MARCADO": a conduta que sai das duas leituras e oposta.
   */
  eq(
    "so leads sem curso: uma linha, a de sem marcacao",
    agruparPorCurso([lead(null, "alberto"), lead(null, null)]).map((l) => l.curso),
    [SEM_CURSO]
  );
}

console.log("\nfiltrarPorResponsavel()\n");

{
  eq('"" = todos (nao filtra)', filtrarPorResponsavel(base, "").length, base.length);
  eq("por pessoa", filtrarPorResponsavel(base, "alberto").length, 3);

  /*
   * 🔴 "Sem responsavel" precisa de um valor PROPRIO. Com string vazia para os
   * dois, escolher "sem responsavel" seria indistinguivel de nao filtrar — e o
   * lead que ninguem assumiu e justamente o que se quer poder isolar.
   */
  eq("sem responsavel isola o que ninguem assumiu", filtrarPorResponsavel(base, SEM_RESPONSAVEL).length, 1);
  eq("sem responsavel != todos", filtrarPorResponsavel(base, SEM_RESPONSAVEL).length !== base.length, true);

  eq("pessoa inexistente devolve vazio", filtrarPorResponsavel(base, "ninguem").length, 0);

  // O filtro e ANTES do agrupamento: a tabela do Paulo mostra so os cursos dele.
  eq(
    "filtrado por paulo, a tabela tem so os cursos dele",
    agruparPorCurso(filtrarPorResponsavel(base, "paulo")).map((l) => l.curso),
    [MMA, PP]
  );
}

console.log("\ntotaisDeCurso() - a frase do cabecalho\n");

{
  eq("totais do recorte inteiro", totaisDeCurso(base), {
    total: 7,
    comCurso: 5,
    semMarcacao: 2,
    cursosDistintos: 3,
  });

  /*
   * ⚠️ `comCurso + semMarcacao == total`, SEMPRE — e sob qualquer filtro. E o
   * que mantem a frase "X de Y leads com curso marcado" verdadeira; se os dois
   * fossem contados por caminhos diferentes, a soma deixaria de fechar e
   * ninguem perceberia.
   */
  for (const filtro of ["", "alberto", "paulo", SEM_RESPONSAVEL]) {
    const t = totaisDeCurso(filtrarPorResponsavel(base, filtro));
    eq(`soma fecha com filtro "${filtro || "todos"}"`, t.comCurso + t.semMarcacao, t.total);
  }

  eq("recorte vazio", totaisDeCurso([]), {
    total: 0,
    comCurso: 0,
    semMarcacao: 0,
    cursosDistintos: 0,
  });
}

console.log(`\n${ok} assercoes ok, ${falhas} falha(s)\n`);
process.exit(falhas ? 1 : 0);
