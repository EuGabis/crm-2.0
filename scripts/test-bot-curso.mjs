#!/usr/bin/env node
/** Testes de `src/lib/bot/curso.ts` — etiqueta e curso a partir da opção do bot. Rodar: `npm run test:bot` */
const { ehPerguntaDeCurso, etiquetaDoCurso, cursoDaOpcao, comEtiqueta } = await import("../src/lib/bot/curso.ts");
let ok = 0; const falhas = [];
const eq = (n, r, e) => JSON.stringify(r) === JSON.stringify(e) ? ok++ : falhas.push(`${n}\n  esperado ${JSON.stringify(e)}\n  obtido   ${JSON.stringify(r)}`);
const cat = ["Aluno MMA", "INTERESSADO MMA", "INTERESSADO COMISSÁRIO", "INTERESSADO PP", "INTERESSADO PC",
  "INTERESSADO PÓS ENGENHEIROS", "INTERESSADO MASTERCLASS COMISSARIO", "INTERESSADO MASTERCLASS FRENO", "PAGO"];
eq("[real] Comissário → INTERESSADO COMISSÁRIO", etiquetaDoCurso(cat, { title: "Comissário" }), "INTERESSADO COMISSÁRIO");
eq("Pós de Engenheiros → por palavras", etiquetaDoCurso(cat, { title: "Pós de Engenheiros" }), "INTERESSADO PÓS ENGENHEIROS");
eq("Piloto não casa (PP/PC)", etiquetaDoCurso(cat, { title: "Piloto" }), null);
eq("Masterclass ambígua = nenhuma", etiquetaDoCurso(cat, { title: "Masterclass" }), null);
eq("tag explícita na grafia do catálogo", etiquetaDoCurso(cat, { title: "Piloto", tag: "interessado pp" }), "INTERESSADO PP");
eq("valor tem prioridade", etiquetaDoCurso(cat, { title: "MMA", value: "Comissário" }), "INTERESSADO COMISSÁRIO");
eq("não pega etiqueta sem o prefixo", etiquetaDoCurso(cat, { title: "Pago" }), null);
const cursos = ["Célula", "Comissário de Bordo Teórico"];
eq("curso não chutado", cursoDaOpcao(cursos, { title: "Comissário" }), "Comissário");
eq("curso oficial na grafia da lista", cursoDaOpcao(cursos, { title: "celula" }), "Célula");
eq("curso explícito", cursoDaOpcao(cursos, { title: "X", curso: "Célula" }), "Célula");
eq("pergunta do curso por var", ehPerguntaDeCurso({ type: "ask", var: "curso", options: [{}] }), true);
eq("texto livre não conta", ehPerguntaDeCurso({ type: "ask", var: "curso" }), false);
eq("marca explícita desliga", ehPerguntaDeCurso({ type: "ask", var: "curso", options: [{}], marcaCurso: false }), false);
eq("marca explícita liga", ehPerguntaDeCurso({ type: "ask", var: "x", options: [{}], marcaCurso: true }), true);
eq("não repete etiqueta", comEtiqueta(["interessado comissário"], "INTERESSADO COMISSÁRIO"), null);
eq("acrescenta", comEtiqueta(["PAGO"], "INTERESSADO PP"), ["PAGO", "INTERESSADO PP"]);
eq("tags nulas", comEtiqueta(null, "A"), ["A"]);
if (falhas.length) { console.error(`✗ ${falhas.length} falha(s)\n` + falhas.join("\n")); process.exit(1); }
console.log(`✓ curso do bot: ${ok} asserções`);
