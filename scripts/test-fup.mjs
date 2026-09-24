// FUP de perdido quente: a regra de tempo e a contagem de variáveis do template.
import { elegivelParaFup, variaveisDoCorpo } from "../src/lib/leads/fup-perdido-quente.ts";

let ok = 0, falhas = 0;
const eq = (nome, a, b) => {
  if (JSON.stringify(a) === JSON.stringify(b)) { ok++; console.log("  ✓", nome); }
  else { falhas++; console.log("  x", nome, "→", a, "≠", b); }
};
const H = 3600 * 1000;
const agora = Date.parse("2026-09-24T15:00:00Z");
const ha = (h) => new Date(agora - h * H).toISOString();

eq("vendedor falou há 48h, cliente calado → FUP", elegivelParaFup({ ultimaEntrada: ha(60), ultimaSaidaHumana: ha(48), jaEnviado: false, agora }), true);
eq("47h59 → ainda não", elegivelParaFup({ ultimaEntrada: ha(60), ultimaSaidaHumana: ha(47.99), jaEnviado: false, agora }), false);
eq("cliente respondeu depois do vendedor → não (a bola é nossa)", elegivelParaFup({ ultimaEntrada: ha(49), ultimaSaidaHumana: ha(50), jaEnviado: false, agora }), false);
eq("empate exato entrada = saída → não", elegivelParaFup({ ultimaEntrada: ha(50), ultimaSaidaHumana: ha(50), jaEnviado: false, agora }), false);
eq("vendedor nunca falou → não (só o bot)", elegivelParaFup({ ultimaEntrada: ha(80), ultimaSaidaHumana: null, jaEnviado: false, agora }), false);
eq("FUP já enviado → nunca de novo (único)", elegivelParaFup({ ultimaEntrada: ha(80), ultimaSaidaHumana: ha(72), jaEnviado: true, agora }), false);
eq("sem mensagem do cliente, vendedor abriu há 3 dias → FUP", elegivelParaFup({ ultimaEntrada: null, ultimaSaidaHumana: ha(72), jaEnviado: false, agora }), true);
eq("data corrompida → não", elegivelParaFup({ ultimaEntrada: null, ultimaSaidaHumana: "lixo", jaEnviado: false, agora }), false);

eq("corpo com {{1}} → 1 variável", variaveisDoCorpo([{ type: "BODY", text: "Olá {{1}}! Sei que..." }]), 1);
eq("corpo com {{1}} e {{2}} → 2", variaveisDoCorpo([{ type: "HEADER" }, { type: "BODY", text: "{{1}} e {{ 2 }}" }]), 2);
eq("corpo sem variável → 0", variaveisDoCorpo([{ type: "BODY", text: "Olá!" }]), 0);
eq("sem componentes → 0", variaveisDoCorpo([]), 0);

console.log(`\n${ok} assercoes ok, ${falhas} falha(s)\n`);
process.exit(falhas ? 1 : 0);
