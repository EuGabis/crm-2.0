// Horário real da mensagem da Meta: é dele que sai a janela de 24h.
import { foraDaJanela, horarioDaMensagem as h } from "../src/lib/whatsapp/horario.ts";
let ok = 0, falhas = 0;
const eq = (n, a, b) => { if (a === b) { ok++; console.log("  ✓", n); } else { falhas++; console.log("  x", n, "→", a, "≠", b); } };
const agora = Date.parse("2026-10-05T17:55:00Z");
eq("[real] escrita há 2 dias, reenviada agora → horário da Meta", h(String((agora - 2 * 86400000) / 1000), agora).toISOString(), new Date(agora - 2 * 86400000).toISOString());
eq("timestamp numérico também vale", h((agora - 60000) / 1000, agora).getTime(), agora - 60000);
eq("ausente → agora", h(undefined, agora).getTime(), agora);
eq("lixo → agora", h("abc", agora).getTime(), agora);
eq("zero → agora", h("0", agora).getTime(), agora);
eq("10 min no futuro → agora (relógio torto)", h(String((agora + 600000) / 1000), agora).getTime(), agora);
eq("2 min no futuro → aceita (folga)", h(String((agora + 120000) / 1000), agora).getTime(), agora + 120000);
eq("escrita há 25h → fora da janela", foraDaJanela(new Date(agora - 25 * 3600000), agora), true);
eq("escrita há 23h → dentro", foraDaJanela(new Date(agora - 23 * 3600000), agora), false);
eq("escrita agora → dentro", foraDaJanela(new Date(agora), agora), false);
console.log(`\n${ok} ok · ${falhas} falha(s)`);
if (falhas) process.exit(1);
