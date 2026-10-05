// Reenvio das mensagens do bot que falharam: ordem, janela e não atropelar a conversa.
import { planoDeReenvio as p } from "../src/lib/whatsapp/reenvio-bot.ts";
let ok = 0, falhas = 0;
const eq = (n, a, b) => { const A = JSON.stringify(a), B = JSON.stringify(b); if (A === B) { ok++; console.log("  ✓", n); } else { falhas++; console.log("  x", n, "→", A, "≠", B); } };
const agora = Date.parse("2026-10-05T18:00:00Z");
const t = (min) => new Date(agora - min * 60000).toISOString();
let n = 0;
const m = (o) => ({ id: `m${++n}`, direction: "out", status: "sent", type: "text", automated: true, internal: false, body: "x", ...o });
const ids = (pl) => pl.reenviar.map((r) => r.body);

eq("cliente escreveu, bot falhou → reenvia",
  ids(p([m({ direction: "in", at: t(60), body: "oi" }), m({ status: "failed", at: t(59), body: "Qual seu nome?" })], agora)), ["Qual seu nome?"]);
eq("várias falhas em ordem → todas, na ordem",
  ids(p([m({ direction: "in", at: t(60) }), m({ status: "failed", at: t(59), body: "Olá!" }), m({ status: "failed", at: t(58), body: "Qual seu nome?" })], agora)), ["Olá!", "Qual seu nome?"]);
eq("mesma pergunta repetida → vai uma vez",
  ids(p([m({ direction: "in", at: t(60) }), m({ status: "failed", at: t(59), body: "Qual seu nome?" }), m({ direction: "in", at: t(50) }), m({ status: "failed", at: t(49), body: "Qual seu nome?" })], agora)), ["Qual seu nome?"]);
eq("atendente falou com sucesso depois → não reenvia (conversa seguiu)",
  p([m({ direction: "in", at: t(60) }), m({ status: "failed", at: t(59) }), m({ automated: false, status: "delivered", at: t(30), body: "Oi, sou a Jenifer" })], agora).pulo, "conversa seguiu depois da falha");
eq("falha depois de um sucesso → só a que veio depois",
  ids(p([m({ direction: "in", at: t(60) }), m({ status: "failed", at: t(59), body: "A" }), m({ status: "read", at: t(40), body: "B" }), m({ direction: "in", at: t(20) }), m({ status: "failed", at: t(19), body: "C" })], agora)), ["C"]);
eq("cliente escreveu há 25h → janela fechada",
  p([m({ direction: "in", at: t(25 * 60) }), m({ status: "failed", at: t(25 * 60 - 1) })], agora).pulo, "janela fechada");
eq("23h40 → dentro da margem de 30 min, já não arrisca",
  p([m({ direction: "in", at: t(23 * 60 + 40) }), m({ status: "failed", at: t(23 * 60 + 39) })], agora).pulo, "janela fechada");
eq("mensagem de atendente que falhou → não é do bot, não reenvia",
  p([m({ direction: "in", at: t(60) }), m({ automated: false, status: "failed", at: t(59) })], agora).pulo, "nada para reenviar");
eq("evento e nota interna não contam como envio",
  ids(p([m({ direction: "in", at: t(60) }), m({ status: "failed", at: t(59), body: "Q" }), m({ type: "event", status: "sent", at: t(58) }), m({ internal: true, status: "sent", at: t(57) })], agora)), ["Q"]);
eq("sem mensagem do cliente → janela fechada",
  p([m({ status: "failed", at: t(10) })], agora).pulo, "janela fechada");
eq("falha com texto vazio → ignora",
  p([m({ direction: "in", at: t(60) }), m({ status: "failed", at: t(59), body: "  " })], agora).pulo, "nada para reenviar");
eq("reenvio já tentado e recusado → não tenta de novo (o laço infinito)",
  p([m({ direction: "in", at: t(60) }), m({ status: "failed", at: t(59), body: "Q", error_detail: "Reenvio falhou: #131047" })], agora).pulo, "nada para reenviar");
eq("falha original (sem marca) → ainda reenvia",
  ids(p([m({ direction: "in", at: t(60) }), m({ status: "failed", at: t(59), body: "Q", error_detail: "Error validating access token · #190" })], agora)), ["Q"]);
console.log(`\n${ok} ok · ${falhas} falha(s)`);
if (falhas) process.exit(1);
