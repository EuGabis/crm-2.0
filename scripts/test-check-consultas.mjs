// npm run test:check-consultas — a guarda precisa disparar nos casos que já
// custaram caro e calar nos que estão certos; senão vira ruído e é ignorada.
import { analisar } from "./check-consultas.mjs";

let falhas = 0;
const caso = (nome, codigo, regraEsperada) => {
  const r = analisar(codigo, "x.ts").map((a) => a.regra);
  const ok = regraEsperada ? r.includes(regraEsperada) : r.length === 0;
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHA"} ${nome}${ok ? "" : ` (veio: ${r.join(",") || "nada"})`}`);
};

console.log("\nsem paginação\n");
caso("[real] assinaturas sem range", `await supabase.from("payment_subscriptions").select("*").eq("location_id", l).order("x");\n`, "sem-paginacao");
caso("com range passa", `await supabase.from("messages").select("*").range(0, 999);\n`, null);
caso("com limit passa", `await supabase.from("messages").select("*").limit(50);\n`, null);
caso("por id passa", `await supabase.from("contacts").select("*").eq("id", x).maybeSingle();\n`, null);
caso("tabela pequena passa", `await supabase.from("pipelines").select("*");\n`, null);
caso("insert não conta", `await supabase.from("messages").insert({});\n`, null);
caso("variável paginada depois passa", `let q = supabase.from("bot_desfechos").select("a");\nconst { data } = await q.order("id").range(0, 999);\n`, null);
caso("exceção com motivo passa", `// consulta-ok: um comprador só\nawait supabase.from("payment_events").select("*");\n`, null);
caso("exceção SEM motivo não vale", `// consulta-ok:\nawait supabase.from("payment_events").select("*");\n`, "sem-paginacao");

console.log("\ncontagem sem erro\n");
caso("[real] limite diário sem error", `const { count } = await db.from("messages").select("id", { count: "exact", head: true });\n`, "count-sem-erro");
caso("com error passa", `const { count, error } = await db.from("messages").select("id", { count: "exact", head: true });\n`, null);
caso("com data junto passa", `const { data, count } = await q.range(0, 9);\n`, null);

console.log(`\n${falhas === 0 ? "todas ok" : `${falhas} falha(s)`}`);
process.exit(falhas ? 1 : 0);
