/**
 * Motivo da falha de envio de e-mail de campanha, em português e com a conduta.
 *
 * ⚠️ Existe porque o motor gravava SEMPRE "Falha no envio em lote" e jogava fora
 * o erro do Resend: endereço inválido, cota do mês estourada e remetente não
 * verificado chegavam à tela com o mesmo texto — e as condutas são opostas
 * (corrigir o contato · esperar/ampliar o plano · configurar o domínio).
 *
 * Função pura, sem SDK: roda em teste e no navegador.
 */

/** Texto que o motor antigo gravava — o motivo real se perdeu. */
export const FALHA_ANTIGA = "Falha no envio em lote";

/** Erro do REQUEST inteiro que é passageiro: o lote volta para a fila. */
export function falhaPassageira(nome: string | null | undefined, status: number | null | undefined): boolean {
  if (nome === "rate_limit_exceeded" || nome === "concurrent_idempotent_requests") return true;
  if (nome === "internal_server_error" || nome === "application_error") return true;
  if (status === 429) return true;
  if (typeof status === "number" && status >= 500) return true;
  // Sem nome e sem status = a requisição nem chegou (rede, DNS, timeout).
  return !nome && !status;
}

/** Cota do plano: não é defeito do destinatário, e reenviar hoje não resolve. */
export function falhaDeCota(nome: string | null | undefined): boolean {
  return nome === "daily_quota_exceeded" || nome === "monthly_quota_exceeded";
}

/**
 * Traduz o erro. `mensagem` é a do Resend, que vai junto entre parênteses:
 * a tradução diz o que fazer, o original prova o que aconteceu.
 */
export function motivoFalhaEmail(nome: string | null | undefined, mensagem: string | null | undefined): string {
  const msg = (mensagem ?? "").trim();
  const m = msg.toLowerCase();
  let pt: string;
  if (nome === "invalid_from_address" || /domain is not verified|from address|verify a domain/.test(m)) {
    pt = "Remetente não autorizado: o domínio do remetente não está verificado no Resend";
  } else if (nome === "daily_quota_exceeded") {
    pt = "Cota DIÁRIA de envios do Resend atingida — o envio volta amanhã ou com plano maior";
  } else if (nome === "monthly_quota_exceeded") {
    pt = "Cota MENSAL de envios do Resend atingida — amplie o plano no Resend";
  } else if (nome === "invalid_api_key" || nome === "missing_api_key" || nome === "restricted_api_key") {
    pt = "Chave do Resend inválida ou sem permissão de envio (RESEND_API_KEY na Vercel)";
  } else if (/\bto\b|recipient|email address|invalid.*email|email.*invalid/.test(m)) {
    pt = "Endereço de e-mail inválido — corrija o e-mail no cadastro do contato";
  } else if (nome === "rate_limit_exceeded") {
    pt = "Limite de envios por segundo do Resend";
  } else if (nome === "validation_error" || nome === "invalid_parameter" || nome === "missing_required_field") {
    pt = "O Resend recusou a mensagem";
  } else {
    pt = "Falha no envio";
  }
  return msg ? `${pt} (${msg})` : pt;
}

/** O que a TELA mostra para o `error` gravado. */
export function motivoParaTela(erro: string | null | undefined): string | null {
  if (!erro) return null;
  if (erro === FALHA_ANTIGA) {
    return "Motivo não registrado — envio feito antes de o CRM guardar o motivo";
  }
  return erro;
}
