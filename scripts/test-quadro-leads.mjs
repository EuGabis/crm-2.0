/**
 * O numero do quadro "Por atendente" e a lista que ele abre sao o MESMO
 * predicado.
 *
 * 🔴 O risco que estes casos travam nao da erro nenhum: a rota soma as colunas
 * no servidor e o dialogo filtra os leads no navegador. Escritos em dois
 * lugares, divergem na primeira mudanca — e o quadro passa a dizer "95
 * qualificados" abrindo uma lista de 93, sem nada quebrar.
 *
 * Roda direto no Node 24 (`npm run test:quadro`), sem runner de teste.
 */
import { noRecorte, contarRecortes } from "../src/lib/reports/quadro-leads.ts";

let ok = 0;
let falhas = 0;
function eq(rotulo, obtido, esperado) {
  const bate = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (bate) ok++;
  else {
    falhas++;
    console.error(`  FALHOU  ${rotulo}\n    obtido:   ${JSON.stringify(obtido)}\n    esperado: ${JSON.stringify(esperado)}`);
    return;
  }
  console.log(`  ok  ${rotulo}`);
}

const lead = (resultado, finalizada = false, ganha = false) => ({ resultado, finalizada, ganha });

console.log("\nnoRecorte() - o que cada coluna conta\n");

{
  eq("quente entra em qualificados", noRecorte(lead("quente"), "qualificados"), true);
  eq("frio NAO entra em qualificados", noRecorte(lead("frio"), "qualificados"), false);
  eq("frio entra em frios", noRecorte(lead("frio"), "frios"), true);

  /*
   * ⚠️ O caso que mais importa: quem ABANDONOU a triagem nao tem nota, e nao e
   * nem quente nem frio. Somar os sem-nota em "frios" inventaria uma reprovacao
   * que o bot nunca deu — e as condutas sao opostas (frio recebe conteudo, quem
   * desistiu precisa ser retomado).
   */
  eq("sem nota NAO e frio", noRecorte(lead(null), "frios"), false);
  eq("sem nota NAO e qualificado", noRecorte(lead(null), "qualificados"), false);

  // O desfecho da SECRETARIA e um assunto ("docs"), nao uma temperatura.
  eq("desfecho de assunto nao e frio", noRecorte(lead("docs"), "frios"), false);
  eq("desfecho de assunto nao e qualificado", noRecorte(lead("docs"), "qualificados"), false);

  // "Recebeu" e o universo: todo lead entra, tenha nota ou nao.
  eq("recebeu conta o sem nota", noRecorte(lead(null), "recebeu"), true);
  eq("recebeu conta o quente", noRecorte(lead("quente"), "recebeu"), true);

  eq("finalizada olha a conversa", noRecorte(lead("frio", true), "finalizadas"), true);
  eq("nao finalizada fica de fora", noRecorte(lead("quente", false), "finalizadas"), false);
  eq("ganha olha a oportunidade", noRecorte(lead("quente", false, true), "ganhas"), true);
  eq("nao ganha fica de fora", noRecorte(lead("quente", true, false), "ganhas"), false);
}

console.log("\ncontarRecortes() - a soma bate com o filtro\n");

{
  const leads = [
    lead("quente", true, true),
    lead("quente", false, false),
    lead("frio", true, false),
    lead(null, false, false),
    lead(null, true, false),
    lead("docs", false, false),
  ];

  eq("as cinco colunas", contarRecortes(leads), {
    recebeu: 6,
    qualificados: 2,
    frios: 1,
    finalizadas: 3,
    ganhas: 1,
  });

  /*
   * A REGRESSAO escrita como teste: para cada coluna, o numero contado tem de
   * ser exatamente o tamanho da lista filtrada. E isso que garante que clicar
   * em "2 qualificados" abra 2 leads.
   */
  for (const r of ["recebeu", "qualificados", "frios", "finalizadas", "ganhas"]) {
    eq(
      `o numero de "${r}" e o tamanho da lista que ele abre`,
      contarRecortes(leads)[r],
      leads.filter((l) => noRecorte(l, r)).length,
    );
  }

  // ⚠️ Qualificados + frios NAO soma o total: os sem nota e os de assunto ficam
  // de fora de propósito, e e por isso que "frios" e uma coluna propria em vez
  // de ser calculada como "recebeu - qualificados".
  const c = contarRecortes(leads);
  eq("quentes + frios nao fecham o total", c.qualificados + c.frios === c.recebeu, false);

  eq("lista vazia", contarRecortes([]), {
    recebeu: 0,
    qualificados: 0,
    frios: 0,
    finalizadas: 0,
    ganhas: 0,
  });
}

console.log(`\n${ok} assercoes ok, ${falhas} falha(s)\n`);
process.exit(falhas ? 1 : 0);
