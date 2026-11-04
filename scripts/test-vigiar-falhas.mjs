// npm run test:vigiar — o fetch que registra as falhas silenciosas do banco.
//
// O que importa provar: (1) a resposta original volta INTACTA — o registro não
// pode mudar o que a tela recebe; (2) só "o banco não respondeu" é registrado,
// não erro de consulta inválida; (3) o teto de um registro por minuto vale; (4)
// o próprio registro nunca é registrado (laço).
import { criarFetchVigiado, recursoDaUrl } from "../src/lib/supabase/vigiar-falhas.ts";

let falhas = 0;
const ok = (nome, cond) => {
  if (!cond) falhas++;
  console.log(`${cond ? "ok  " : "FALHA"} ${nome}`);
};
const espera = () => new Promise((r) => setTimeout(r, 20));

const chamadas = [];
let proxima = null;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input.url;
  chamadas.push({ url, init });
  if (url.includes("registrar_falha_consulta")) return new Response(null, { status: 204 });
  return proxima();
};
const resposta = (status, corpo) => () =>
  new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });
const B = "https://x.supabase.co/rest/v1/";
const H = { apikey: "pk", Authorization: "Bearer jwt" };
const registros = () => chamadas.filter((c) => c.url.includes("registrar_falha_consulta"));

console.log("\nrecursoDaUrl\n");
ok("tabela sem filtros", recursoDaUrl(`${B}conversations?select=*&id=eq.1`) === "conversations");
ok("rpc", recursoDaUrl(`${B}rpc/caixa_admin`) === "rpc/caixa_admin");
ok("fora do REST -> null", recursoDaUrl("https://x.supabase.co/auth/v1/user") === null);

console.log("\nregistro\n");
const f = criarFetchVigiado({ location: () => "loc-1" });

proxima = resposta(500, { code: "57014", message: "canceling statement due to statement timeout" });
const r1 = await f(`${B}conversations?select=id`, { headers: H });
await espera();
ok("tempo esgotado devolve a MESMA resposta (500)", r1.status === 500);
ok("o corpo original ainda é legível", (await r1.json()).code === "57014");
ok("57014 registra uma vez", registros().length === 1);
const corpo = JSON.parse(registros()[0].init.body);
ok("registra o recurso, não a URL com filtros", corpo.p_recurso === "conversations");
ok("leva apikey e sessão", registros()[0].init.headers.apikey === "pk" && registros()[0].init.headers.Authorization === "Bearer jwt");
ok("leva a empresa informada", corpo.p_location === "loc-1");

await f(`${B}conversations?select=id`, { headers: H });
await espera();
ok("mesmo recurso no mesmo minuto não registra de novo", registros().length === 1);

proxima = resposta(503, { code: "PGRST001" });
await f(`${B}rpc/caixa_admin`, { method: "POST", headers: H });
await espera();
ok("falha de conexão (PGRST001) registra", registros().length === 2);

proxima = resposta(400, { code: "42703", message: "column does not exist" });
await f(`${B}messages?select=nada`, { headers: H });
await espera();
ok("erro 4xx (consulta inválida) não registra", registros().length === 2);

proxima = resposta(500, { code: "23505" });
await f(`${B}tasks`, { headers: H });
await espera();
ok("5xx com outro código não registra", registros().length === 2);

proxima = resposta(200, []);
const r2 = await f(`${B}contacts`, { headers: H });
await espera();
ok("sucesso passa direto", r2.status === 200 && registros().length === 2);

proxima = resposta(500, { code: "57014" });
const antesDoLaco = registros().length;
await f(`${B}rpc/registrar_falha_consulta`, { method: "POST", headers: H });
await espera();
// +1 é a PRÓPRIA chamada ao registro; um segundo registro seria o laço.
ok("o próprio registro nunca é registrado (laço)", registros().length === antesDoLaco + 1);

proxima = () => new Response("não é json", { status: 502 });
const r3 = await f(`${B}deals`, { headers: H });
await espera();
ok("corpo não-JSON não quebra nem registra", r3.status === 502 && registros().length === antesDoLaco + 1);

console.log(`\n${falhas === 0 ? "todas ok" : `${falhas} falha(s)`}`);
process.exit(falhas ? 1 : 0);
