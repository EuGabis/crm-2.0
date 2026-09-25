// Tipos de campo do formulário: gravação de data/hora, múltipla escolha e destino.
import { valorGravado, campoPersonalizado, opcoesDoTexto } from "../src/lib/forms/campos.ts";

let ok = 0, falhas = 0;
const eq = (n, a, b) => {
  if (JSON.stringify(a) === JSON.stringify(b)) { ok++; console.log("  ✓", n); }
  else { falhas++; console.log("  x", n, "→", JSON.stringify(a), "≠", JSON.stringify(b)); }
};

eq("data ISO vira dd/mm/aaaa (sem cair no dia anterior)", valorGravado("date", "2026-09-25"), "25/09/2026");
eq("data e hora", valorGravado("datetime", "2026-09-25T14:30"), "25/09/2026 14:30");
eq("hora com zero à esquerda", valorGravado("time", "9:05"), "09:05");
eq("múltipla escolha junta as marcadas", valorGravado("multi", ["Manhã", " Noite ", ""]), "Manhã, Noite");
eq("múltipla escolha vazia = vazio (conta como não respondido)", valorGravado("multi", []), "");
eq("texto é aparado", valorGravado("text", "  oi  "), "oi");
eq("data fora do formato passa como veio", valorGravado("date", "amanhã"), "amanhã");

eq("custom usa o rótulo", campoPersonalizado({ mapsTo: "custom", label: "Curso de Interesse", key: "c1" }), "Curso de Interesse");
eq("custom:<nome> antigo continua valendo", campoPersonalizado({ mapsTo: "custom:Curso", label: "x", key: "c1" }), "Curso");
eq("coluna do contato não é campo personalizado", campoPersonalizado({ mapsTo: "company", label: "x", key: "c1" }), null);
eq("rótulo vazio cai na chave", campoPersonalizado({ mapsTo: "custom", label: "  ", key: "c1" }), "c1");

eq("opções: uma por linha, sem vazias nem repetidas", opcoesDoTexto("Manhã\n\n tarde \nManhã\nTarde\nNoite"), ["Manhã", "tarde", "Noite"]);

console.log(`\n${ok} assercoes ok, ${falhas} falha(s)\n`);
process.exit(falhas ? 1 : 0);
