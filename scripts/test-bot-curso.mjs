#!/usr/bin/env node
/** Testes de `src/lib/bot/curso.ts` — etiquetas e curso a partir da opção do bot. Rodar: `npm run test:bot` */
const { ehPerguntaDeCurso, etiquetasDoCurso, cursoDaOpcao, comEtiquetas } = await import("../src/lib/bot/curso.ts");
let ok = 0;
const falhas = [];
const eq = (n, r, e) =>
  JSON.stringify(r) === JSON.stringify(e)
    ? ok++
    : falhas.push(`${n}\n  esperado ${JSON.stringify(e)}\n  obtido   ${JSON.stringify(r)}`);

const cat = ["Aluno MMA", "Aluno Eng", "INTERESSADO MMA", "INTERESSADO COMISSÁRIO", "INTERESSADO PP", "INTERESSADO PC",
  "INTERESSADO PÓS ENGENHEIROS", "INTERESSADO MASTERCLASS COMISSARIO", "INTERESSADO MASTERCLASS FRENO", "PAGO"];

// A lista do Gabriel (14/10): MMA = Mecânico, PP e PC = Piloto, Pós Eng, Comissário.
eq("[real] Mecânico → MMA", etiquetasDoCurso(cat, { title: "Mecânico" }), ["INTERESSADO MMA"]);
eq("Mecânicos (plural) → MMA", etiquetasDoCurso(cat, { title: "Mecânicos" }), ["INTERESSADO MMA"]);
eq("Piloto → PP e PC", etiquetasDoCurso(cat, { title: "Piloto" }), ["INTERESSADO PP", "INTERESSADO PC"]);
eq("[real] Comissário", etiquetasDoCurso(cat, { title: "Comissário" }), ["INTERESSADO COMISSÁRIO"]);
eq("Pós de Engenheiros", etiquetasDoCurso(cat, { title: "Pós de Engenheiros" }), ["INTERESSADO PÓS ENGENHEIROS"]);
eq("Pós Eng", etiquetasDoCurso(cat, { title: "Pós Eng" }), ["INTERESSADO PÓS ENGENHEIROS"]);
eq("Masterclass ambígua = nenhuma", etiquetasDoCurso(cat, { title: "Masterclass" }), []);
eq("Masterclass Freno casa por palavras", etiquetasDoCurso(cat, { title: "Masterclass Freno" }), ["INTERESSADO MASTERCLASS FRENO"]);
eq("tag explícita na grafia do catálogo", etiquetasDoCurso(cat, { title: "Piloto", tag: "interessado pp" }), ["INTERESSADO PP"]);
eq("sinônimo sem etiqueta no catálogo some", etiquetasDoCurso(["INTERESSADO PP"], { title: "Piloto" }), ["INTERESSADO PP"]);
eq("não pega etiqueta sem o prefixo", etiquetasDoCurso(cat, { title: "Pago" }), []);

const cursos = ["Célula", "Comissário de Bordo Teórico"];
eq("curso não chutado", cursoDaOpcao(cursos, { title: "Comissário" }), "Comissário");
eq("curso oficial na grafia da lista", cursoDaOpcao(cursos, { title: "celula" }), "Célula");
eq("curso explícito", cursoDaOpcao(cursos, { title: "X", curso: "Célula" }), "Célula");

eq("pergunta do curso por var", ehPerguntaDeCurso({ type: "ask", var: "curso", options: [{}] }), true);
eq("texto livre não conta", ehPerguntaDeCurso({ type: "ask", var: "curso" }), false);
eq("marca explícita desliga", ehPerguntaDeCurso({ type: "ask", var: "curso", options: [{}], marcaCurso: false }), false);
eq("marca explícita liga", ehPerguntaDeCurso({ type: "ask", var: "x", options: [{}], marcaCurso: true }), true);

eq("não repete etiqueta", comEtiquetas(["interessado comissário"], ["INTERESSADO COMISSÁRIO"]), null);
eq("acrescenta só a que falta", comEtiquetas(["INTERESSADO PP"], ["INTERESSADO PP", "INTERESSADO PC"]), ["INTERESSADO PP", "INTERESSADO PC"]);
eq("tags nulas", comEtiquetas(null, ["A"]), ["A"]);

if (falhas.length) {
  console.error(`✗ ${falhas.length} falha(s)\n` + falhas.join("\n"));
  process.exit(1);
}
console.log(`✓ curso do bot: ${ok} asserções`);
