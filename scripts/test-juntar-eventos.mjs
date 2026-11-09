import { juntarRedistribuicoes } from "../src/lib/inbox/juntar-eventos.ts";
let f = 0; const eq = (n, a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) { f++; console.log("FALHA", n, a); } };
const ev = (body, at) => ({ type: "event", body, at });
const r = juntarRedistribuicoes([
  { type: "text", body: "oi", at: "2026-11-09T10:00:00Z" },
  ev("Devolvida à fila do setor · pelo sistema · devolvida: cliente esperava 156 min sem resposta", "2026-11-09T13:16:00Z"),
  ev("Atribuída a Rogerio Martins · pelo sistema · redistribuída após 156 min de espera", "2026-11-09T13:16:01Z"),
]);
eq("par vira uma", r.length, 2);
eq("texto", r[1].body, "Redistribuída para Rogerio Martins · cliente esperava 156 min sem resposta");
eq("longe não junta", juntarRedistribuicoes([ev("Devolvida à fila do setor · x", "2026-11-09T13:00:00Z"), ev("Atribuída a A · y", "2026-11-09T13:10:00Z")]).length, 2);
eq("devolvida sozinha fica", juntarRedistribuicoes([ev("Devolvida à fila do setor · lead quente passou", "2026-11-09T13:00:00Z")]).length, 1);
console.log(f ? `${f} falha(s)` : "ok"); process.exit(f ? 1 : 0);
