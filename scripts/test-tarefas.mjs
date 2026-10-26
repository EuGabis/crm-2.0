// npm run test:tarefas — situação do prazo das tarefas (dia em São Paulo).
import assert from "node:assert/strict";
import { situacaoDoPrazo, diasDeAtraso, diaDoPrazo } from "../src/lib/tasks/prazo.ts";

let n = 0;
const ok = (c, msg) => { assert.ok(c, msg); n++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); n++; };

const hoje = "2026-10-23";
const p = (dueAt, status = "pending") => situacaoDoPrazo({ status, dueAt }, hoje);

eq(p("2026-10-23T12:00:00-03:00"), "hoje", "prazo de hoje");
eq(p("2026-10-22T12:00:00-03:00"), "atrasada", "ontem = atrasada");
eq(p("2026-10-24T12:00:00-03:00"), "amanha", "amanhã");
eq(p("2026-10-30T12:00:00-03:00"), "semana", "daqui 7 dias = semana");
eq(p("2026-10-31T12:00:00-03:00"), "depois", "daqui 8 dias = depois");
eq(p(null), "sem-prazo", "sem prazo");
eq(p("lixo"), "sem-prazo", "data inválida não quebra");
eq(p("2026-10-01T12:00:00-03:00", "done"), "concluida", "concluída ignora atraso");
// [real] 21h de Brasília = 00h UTC do dia seguinte: continua sendo HOJE.
eq(diaDoPrazo("2026-10-24T00:30:00Z"), "2026-10-23", "fuso de São Paulo");
eq(p("2026-10-24T00:30:00Z"), "hoje", "21h30 BRT não vira amanhã");
eq(diasDeAtraso("2026-10-20T12:00:00-03:00", hoje), 3, "3 dias de atraso");
eq(diasDeAtraso("2026-10-23T12:00:00-03:00", hoje), 0, "hoje não é atraso");
eq(diasDeAtraso("2026-10-25T12:00:00-03:00", hoje), 0, "futuro não é atraso");
eq(diasDeAtraso(null, hoje), 0, "sem prazo");
ok(true, "fim");
console.log(`tarefas: ${n} asserções ok`);
