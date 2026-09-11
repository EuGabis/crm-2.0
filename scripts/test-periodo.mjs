/**
 * Datas de relatório (`src/lib/periodo.ts`).
 *
 * ⚠️ Existe porque erro de UM DIA é silencioso: não dá exceção, não quebra o
 * build, e o relatório simplesmente mostra o dia vizinho. Este repositório já
 * pagou por isso — a própria rota de leads carrega o comentário de que
 * `toISOString()` devolve o dia em UTC e, às 21h de Brasília, o servidor já está
 * no dia seguinte.
 *
 * Roda direto no Node 24 (`npm run test:periodo`), sem runner de teste.
 */
import {
  ajustarPeriodo,
  deData,
  diasEntre,
  ehDiaValido,
  fimDoMes,
  hojeSP,
  inicioDoMes,
  longo,
  paraData,
  presetDoPeriodo,
  resolvePreset,
  rotuloDoBotao,
  rotuloDoPeriodo,
  somaDias,
} from "../src/lib/periodo.ts";

let ok = 0;
let falhas = 0;
function eq(rotulo, obtido, esperado) {
  if (JSON.stringify(obtido) === JSON.stringify(esperado)) ok++;
  else {
    falhas++;
    console.error(
      `  ✗ ${rotulo}\n      obtido:   ${JSON.stringify(obtido)}\n      esperado: ${JSON.stringify(esperado)}`
    );
  }
}

console.log("── Ida e volta (a armadilha do dia a menos) ──");
{
  // 🔴 O caso que motiva o módulo: `new Date("2026-09-09")` é meia-noite UTC,
  // que no Brasil é 08/09 às 21h — e voltar para texto daria "2026-09-08".
  eq("texto → Date → texto não perde o dia", deData(paraData("2026-09-09")), "2026-09-09");
  eq("primeiro dia do mês", deData(paraData("2026-09-01")), "2026-09-01");
  eq("último dia do ano", deData(paraData("2026-12-31")), "2026-12-31");
  // Prova que o problema seria REAL com toISOString num fuso negativo: o teste
  // roda no fuso da máquina, então a asserção é sobre a nossa conversão, que
  // não depende dele.
  eq("meio-dia, não meia-noite", paraData("2026-09-09").getHours(), 12);
}

console.log("── hojeSP: o dia é o de São Paulo, não o do processo ──");
{
  // 23h30 de 11/09 em Brasília = 02h30 de 12/09 em UTC. O dia é 11.
  eq("virada da noite", hojeSP(new Date("2026-09-12T02:30:00Z")), "2026-09-11");
  // 00h30 de 12/09 em Brasília = 03h30 UTC. O dia é 12.
  eq("logo depois da meia-noite", hojeSP(new Date("2026-09-12T03:30:00Z")), "2026-09-12");
}

console.log("── somaDias e diasEntre ──");
{
  eq("dia seguinte", somaDias("2026-09-11", 1), "2026-09-12");
  eq("vira o mês", somaDias("2026-08-31", 1), "2026-09-01");
  eq("vira o mês para trás", somaDias("2026-09-01", -1), "2026-08-31");
  eq("vira o ano", somaDias("2026-12-31", 1), "2027-01-01");
  eq("fevereiro comum", somaDias("2026-02-28", 1), "2026-03-01");
  eq("fevereiro bissexto", somaDias("2028-02-28", 1), "2028-02-29");
  // ⚠️ Um dia só é UM dia, não zero: é o que faz "Hoje" não ser um período vazio.
  eq("mesmo dia = 1", diasEntre("2026-09-11", "2026-09-11"), 1);
  eq("dois dias", diasEntre("2026-09-10", "2026-09-11"), 2);
  eq("30 dias", diasEntre("2026-08-13", "2026-09-11"), 30);
  eq("atravessa o ano", diasEntre("2026-12-30", "2027-01-02"), 4);
}

console.log("── Mês ──");
{
  eq("início do mês", inicioDoMes("2026-09-11"), "2026-09-01");
  eq("fim de mês de 30", fimDoMes("2026-09-11"), "2026-09-30");
  eq("fim de mês de 31", fimDoMes("2026-08-01"), "2026-08-31");
  eq("fim de fevereiro comum", fimDoMes("2026-02-10"), "2026-02-28");
  eq("fim de fevereiro bissexto", fimDoMes("2028-02-10"), "2028-02-29");
}

console.log("── Atalhos ──");
{
  const hoje = "2026-09-11";
  eq("hoje", resolvePreset("hoje", hoje), { de: "2026-09-11", ate: "2026-09-11" });
  eq("ontem", resolvePreset("ontem", hoje), { de: "2026-09-10", ate: "2026-09-10" });
  // ⚠️ "Últimos 7 dias" INCLUI hoje: são 7 dias no total, não hoje + 7.
  eq("7 dias inclui hoje", resolvePreset("7d", hoje), { de: "2026-09-05", ate: "2026-09-11" });
  eq("7 dias são 7", diasEntre(resolvePreset("7d", hoje).de, hoje), 7);
  eq("30 dias são 30", diasEntre(resolvePreset("30d", hoje).de, hoje), 30);
  eq("este mês", resolvePreset("mes", hoje), { de: "2026-09-01", ate: "2026-09-11" });
  // ⚠️ Mês passado é o mês INTEIRO, não "até o dia de hoje do mês passado".
  eq("mês passado", resolvePreset("mes-passado", hoje), { de: "2026-08-01", ate: "2026-08-31" });
  // A virada de ano é onde a conta de "mês passado" costuma errar.
  eq("mês passado em janeiro", resolvePreset("mes-passado", "2027-01-05"), {
    de: "2026-12-01",
    ate: "2026-12-31",
  });
  // Fevereiro: o fim do mês tem de sair do calendário, não de um 30 chutado.
  eq("mês passado sendo fevereiro", resolvePreset("mes-passado", "2026-03-15"), {
    de: "2026-02-01",
    ate: "2026-02-28",
  });
}

console.log("── Rótulos ──");
{
  const hoje = "2026-09-11";
  eq("período de um dia", rotuloDoPeriodo({ de: hoje, ate: hoje }), "em 11/09/2026");
  eq(
    "período com intervalo",
    rotuloDoPeriodo({ de: "2026-09-01", ate: "2026-09-11" }),
    "de 01/09 a 11/09/2026"
  );
  eq("longo", longo("2026-09-01"), "01/09/2026");
  // O botão diz o NOME do atalho quando o período casa com um deles...
  eq("botão com atalho", rotuloDoBotao({ de: "2026-09-05", ate: hoje }, hoje), "Últimos 7 dias");
  eq("botão hoje", rotuloDoBotao({ de: hoje, ate: hoje }, hoje), "Hoje");
  // ...e as DATAS quando não casa.
  eq(
    "botão personalizado",
    rotuloDoBotao({ de: "2026-08-03", ate: "2026-08-07" }, hoje),
    "03/08/2026 – 07/08/2026"
  );
  eq(
    "botão de um dia específico",
    rotuloDoBotao({ de: "2026-08-03", ate: "2026-08-03" }, hoje),
    "03/08/2026"
  );
  eq("preset derivado", presetDoPeriodo({ de: "2026-09-01", ate: hoje }, hoje), "mes");
  eq(
    "sem atalho correspondente",
    presetDoPeriodo({ de: "2026-08-03", ate: "2026-08-07" }, hoje),
    "personalizado"
  );
  /*
   * 🔴 O motivo de o atalho ser DERIVADO e não guardado: "Hoje" escolhido ontem
   * não pode continuar escrito "Hoje". Aqui o mesmo período, lido no dia
   * seguinte, deixa de ser um atalho.
   */
  eq(
    "'Hoje' de ontem vira data, não 'Hoje'",
    rotuloDoBotao({ de: "2026-09-10", ate: "2026-09-10" }, "2026-09-11"),
    "Ontem"
  );
  eq(
    "'Hoje' de dois dias atrás vira data",
    rotuloDoBotao({ de: "2026-09-09", ate: "2026-09-09" }, "2026-09-11"),
    "09/09/2026"
  );
}

console.log("── ajustarPeriodo (URL torta e teto) ──");
{
  const hoje = "2026-09-11";
  eq(
    "intervalo normal passa intacto",
    ajustarPeriodo({ de: "2026-09-01", ate: "2026-09-05" }, 180, hoje),
    { de: "2026-09-01", ate: "2026-09-05" }
  );
  // Invertido é intenção legível: o usuário quis aquele intervalo.
  eq("invertido é endireitado", ajustarPeriodo({ de: "2026-09-05", ate: "2026-09-01" }, 180, hoje), {
    de: "2026-09-01",
    ate: "2026-09-05",
  });
  // ⚠️ Futuro não existe no dado: dia à frente só produziria coluna zerada, que
  // se lê como queda de volume.
  eq("futuro é cortado em hoje", ajustarPeriodo({ de: "2026-09-01", ate: "2026-12-01" }, 180, hoje), {
    de: "2026-09-01",
    ate: "2026-09-11",
  });
  eq(
    "período inteiro no futuro colapsa em hoje",
    ajustarPeriodo({ de: "2026-10-01", ate: "2026-10-05" }, 180, hoje),
    { de: "2026-09-11", ate: "2026-09-11" }
  );
  // ⚠️ O teto puxa o INÍCIO, nunca o fim: o fim é o que a pessoa quis ver.
  const cortado = ajustarPeriodo({ de: "2020-01-01", ate: "2026-09-11" }, 180, hoje);
  eq("teto preserva o fim", cortado.ate, "2026-09-11");
  eq("teto dá exatamente o máximo", diasEntre(cortado.de, cortado.ate), 180);
  eq("no limite não corta", diasEntre(ajustarPeriodo({ de: somaDias(hoje, -179), ate: hoje }, 180, hoje).de, hoje), 180);
}

console.log("── ehDiaValido ──");
{
  eq("data real", ehDiaValido("2026-09-11"), true);
  eq("29 de fevereiro bissexto", ehDiaValido("2028-02-29"), true);
  // ⚠️ Casa com o FORMATO e não existe: sem a checagem de existência, o
  // `new Date` "corrige" 30/02 para 02/03 e o relatório responderia outro dia.
  eq("30 de fevereiro", ehDiaValido("2026-02-30"), false);
  eq("mês 13", ehDiaValido("2026-13-01"), false);
  eq("dia 40", ehDiaValido("2026-09-40"), false);
  eq("formato errado", ehDiaValido("11/09/2026"), false);
  eq("vazio", ehDiaValido(""), false);
  eq("nulo", ehDiaValido(null), false);
}

console.log(`\n${ok} asserção(ões) ok · ${falhas} falha(s)`);
process.exit(falhas > 0 ? 1 : 0);
