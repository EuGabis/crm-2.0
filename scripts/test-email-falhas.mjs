#!/usr/bin/env node
/** Tradução do motivo de falha de e-mail de campanha. Rodar: `npm run test:email-falhas` */
const { motivoFalhaEmail, motivoParaTela, falhaPassageira, falhaDeCota, FALHA_ANTIGA } =
  await import("../src/lib/marketing/falhas.ts");

let ok = 0;
const falhas = [];
const t = (nome, cond, det = "") => (cond ? ok++ : falhas.push(`${nome} ${det}`));

const inv = motivoFalhaEmail("validation_error", "Invalid `to` field. The email address needs to follow the `email@example.com` format.");
t("endereço inválido", inv.startsWith("Endereço de e-mail inválido"), inv);
t("mantém o original", inv.includes("email@example.com"), inv);
t("remetente", motivoFalhaEmail("invalid_from_address", "x").startsWith("Remetente"));
t("domínio não verificado", motivoFalhaEmail("validation_error", "The news.x.com domain is not verified").startsWith("Remetente"));
t("cota mensal", motivoFalhaEmail("monthly_quota_exceeded", "").includes("MENSAL"));
t("chave", motivoFalhaEmail("invalid_api_key", "API key is invalid").includes("RESEND_API_KEY"));
t("desconhecido não fica vazio", motivoFalhaEmail(null, "").length > 0);

t("429 passageiro", falhaPassageira("rate_limit_exceeded", 429));
t("500 passageiro", falhaPassageira("internal_server_error", 500));
t("rede passageira", falhaPassageira(null, null));
t("validação NÃO é passageira", !falhaPassageira("validation_error", 422));
t("remetente NÃO é passageiro", !falhaPassageira("invalid_from_address", 403));
t("cota", falhaDeCota("daily_quota_exceeded") && !falhaDeCota("validation_error"));

t("antigo explicado", motivoParaTela(FALHA_ANTIGA).startsWith("Motivo não registrado"));
t("vazio = null", motivoParaTela(null) === null);
t("novo passa como está", motivoParaTela("X (y)") === "X (y)");

if (falhas.length) {
  console.error(`\n  ✗ ${falhas.length} falha(s):\n    ` + falhas.join("\n    "));
  process.exit(1);
}
console.log(`\n  ✓ ${ok} asserções passaram\n`);
