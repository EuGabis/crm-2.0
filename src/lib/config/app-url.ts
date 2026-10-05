/**
 * Endereço público do CRM, para links que saem do app (e-mail, embed, OAuth).
 *
 * ⚠️ Em 2026-10-05 o domínio mudou para www.litocrm.app e o antigo
 * (lito-crm.vercel.app) passou a responder 404 DEPLOYMENT_NOT_FOUND. Como
 * `NEXT_PUBLIC_APP_URL` continuou com o valor antigo na Vercel, o link de
 * redefinição de senha caía nesse 404. Um domínio aposentado na variável é
 * IGNORADO aqui — link quebrado em e-mail não tem conserto depois de enviado.
 */
export const APP_URL_PADRAO = "https://www.litocrm.app";

const APOSENTADOS = ["lito-crm.vercel.app"];

export function appBaseUrl(): string {
  const env = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  if (!env || APOSENTADOS.some((d) => env.includes(d))) return APP_URL_PADRAO;
  return env;
}

/**
 * Para rotas chamadas pelo NAVEGADOR de quem está usando o CRM: o domínio pelo
 * qual a pessoa chegou é, por definição, um que funciona. Chamada de máquina
 * (cron) ou localhost cai no endereço configurado.
 */
export function originDaRequisicao(request: Request): string {
  try {
    const { origin, hostname } = new URL(request.url);
    if (hostname === "localhost" || hostname === "127.0.0.1") return origin;
    if (APOSENTADOS.includes(hostname)) return appBaseUrl();
    return origin;
  } catch {
    return appBaseUrl();
  }
}
