// Saúde do sistema: limiares e leitura dos crons/HTTP. Regra errada aqui não dá
// erro — só pinta de verde o que está quebrado.
import { avaliarCron, avaliarHttp, classificarFalhaWhatsapp as cl, intervaloDoCron, piorStatus, porLimite } from "../src/lib/saude/avaliar.ts";

let ok = 0, falhas = 0;
const eq = (nome, a, b) => {
  if (JSON.stringify(a) === JSON.stringify(b)) { ok++; console.log("  ✓", nome); }
  else { falhas++; console.log("  x", nome, "→", JSON.stringify(a), "≠", JSON.stringify(b)); }
};
const agora = Date.parse("2026-10-05T15:00:00Z");
const ha = (min) => new Date(agora - min * 60000).toISOString();
const cron = (o) => avaliarCron({ nome: "x", agenda: "* * * * *", ativo: true, ultimo_inicio: ha(1), ultimo_status: "succeeded", ...o }, agora).status;

eq("a cada minuto", intervaloDoCron("* * * * *"), 1);
eq("*/5", intervaloDoCron("*/5 * * * *"), 5);
eq("de hora em hora", intervaloDoCron("0 * * * *"), 60);
eq("diário", intervaloDoCron("0 9 * * *"), 1440);
eq("formato desconhecido → null (não acusa)", intervaloDoCron("0 9 * * 1-5"), null);

eq("cron rodou há 1 min → ok", cron({}), "ok");
eq("cron de minuto parado há 10 min → falha", cron({ ultimo_inicio: ha(10) }), "falha");
eq("cron de minuto há 4 min → ok (folga mínima de 5)", cron({ ultimo_inicio: ha(4) }), "ok");
eq("cron horário há 2h → ok (folga de 3 intervalos)", cron({ agenda: "0 * * * *", ultimo_inicio: ha(120) }), "ok");
eq("cron horário há 4h → falha", cron({ agenda: "0 * * * *", ultimo_inicio: ha(240) }), "falha");
eq("última execução failed → falha", cron({ ultimo_status: "failed" }), "falha");
eq("pausado → atenção", cron({ ativo: false }), "atencao");
eq("nunca rodou → atenção", cron({ ultimo_inicio: null }), "atencao");
eq("agenda desconhecida e velha → ok (não sabe acusar)", cron({ agenda: "0 9 * * 1-5", ultimo_inicio: ha(5000) }), "ok");

eq("só 200 → ok", avaliarHttp({ "200": 11 }).status, "ok");
eq("200 + sem resposta (timeout do pg_net) → ok", avaliarHttp({ "200": 11, "sem resposta": 4 }).status, "ok");
eq("nenhuma chamada → falha", avaliarHttp({}).status, "falha");
eq("só 404 → falha", avaliarHttp({ "404": 15 }).status, "falha");
eq("404 explica domínio", /domínio/.test(avaliarHttp({ "404": 3 }).detalhe), true);
eq("401 explica segredo", /segredo/.test(avaliarHttp({ "200": 5, "401": 3 }).detalhe), true);
eq("mistura 200 + 500 → atenção", avaliarHttp({ "200": 10, "500": 1 }).status, "atencao");

eq("pior: falha vence", piorStatus(["ok", "atencao", "falha", "info"]), "falha");
eq("pior: info não esconde ok", piorStatus(["info", "ok"]), "ok");
eq("pior: lista vazia → ok", piorStatus([]), "ok");
eq("limite: abaixo", porLimite(0, 1, 10), "ok");
eq("limite: no limiar de atenção", porLimite(1, 1, 10), "atencao");
eq("limite: no limiar de falha", porLimite(10, 1, 10), "falha");

eq("[real] #131047 janela 24h → regra", cl("Message failed to send because more than 24 hours have passed since the customer last replied to this number. · Re-engagement message · Re-engagement message · #131047").tipo, "regra");
eq("#131049 limite de marketing → regra", cl("This message was not delivered to maintain healthy ecosystem engagement. · #131049").tipo, "regra");
eq("#131026 não entregável → regra", cl("Message Undeliverable · #131026").tipo, "regra");
eq("#131042 cobrança DA CONTA → sistema", cl("Business eligibility payment issue · #131042").tipo, "sistema");
eq("#190 token → sistema", cl("Error validating access token · #190").tipo, "sistema");
eq("sem código → sistema (não esconder o desconhecido)", cl("falha estranha").tipo, "sistema");
eq("vazio → sistema", cl(null).tipo, "sistema");

console.log(`\n${ok} ok · ${falhas} falha(s)`);
if (falhas) process.exit(1);
