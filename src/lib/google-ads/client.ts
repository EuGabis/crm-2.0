/**
 * Cliente da Google Ads API + troca/refresh de token OAuth. SERVER-ONLY:
 * usa GOOGLE_ADS_DEVELOPER_TOKEN / GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET,
 * que nunca podem ir ao cliente. Somente leitura (escopo adwords).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

// A Google Ads API aposenta versões ~1x/ano. Manter num release ativo (ver
// https://developers.google.com/google-ads/api/docs/release-notes). v18 saiu do ar.
const API_VERSION = process.env.GOOGLE_ADS_API_VERSION || "v21";
const ADS_BASE = `https://googleads.googleapis.com/${API_VERSION}`;
const TOKEN_URL = "https://oauth2.googleapis.com/token";

function oauthCreds() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("OAuth do Google não configurado no servidor");
  return { clientId, clientSecret };
}

function devToken(): string {
  const t = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!t) throw new Error("GOOGLE_ADS_DEVELOPER_TOKEN ausente no servidor");
  return t;
}

export async function exchangeCode(
  code: string,
  redirectUri: string,
): Promise<{ refreshToken: string; accessToken: string }> {
  const { clientId, clientSecret } = oauthCreds();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error_description || json?.error || `OAuth ${res.status}`);
  if (!json.refresh_token) {
    throw new Error("O Google não retornou refresh_token (revogue o acesso e reconecte com prompt=consent)");
  }
  return { refreshToken: json.refresh_token, accessToken: json.access_token };
}

export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const { clientId, clientSecret } = oauthCreds();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    throw new Error(json?.error_description || json?.error || `Falha ao renovar token (${res.status})`);
  }
  return json.access_token;
}

function adsHeaders(accessToken: string, loginCustomerId: string | null): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "developer-token": devToken(),
    "Content-Type": "application/json",
  };
  if (loginCustomerId) h["login-customer-id"] = loginCustomerId;
  return h;
}

/** Extrai a mensagem ESPECÍFICA do erro do Google Ads (errorCode + detalhe), não só o topo genérico. */
function gaError(json: any, status: number): string {
  const err = Array.isArray(json) ? json[0]?.error : json?.error;
  const detail = err?.details?.find((d: any) => Array.isArray(d?.errors))?.errors?.[0];
  const code = detail?.errorCode ? Object.values(detail.errorCode)[0] : undefined;
  const msg = detail?.message || err?.message || `Google Ads ${status}`;
  return code ? `${msg} [${code}]` : msg;
}

export async function listAccessibleCustomers(accessToken: string): Promise<string[]> {
  const res = await fetch(`${ADS_BASE}/customers:listAccessibleCustomers`, {
    method: "GET",
    headers: adsHeaders(accessToken, null),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(gaError(json, res.status));
  // resourceNames: ["customers/1234567890", ...] → ["1234567890", ...]
  return (json.resourceNames ?? []).map((r: string) => r.split("/")[1]).filter(Boolean);
}

export async function search(
  customerId: string,
  loginCustomerId: string | null,
  accessToken: string,
  gaql: string,
): Promise<any[]> {
  const res = await fetch(`${ADS_BASE}/customers/${customerId}/googleAds:searchStream`, {
    method: "POST",
    headers: adsHeaders(accessToken, loginCustomerId),
    body: JSON.stringify({ query: gaql }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(gaError(json, res.status));
  }
  // searchStream devolve um array de batches, cada um com { results: [...] }
  const batches: any[] = Array.isArray(json) ? json : [json];
  return batches.flatMap((b) => b.results ?? []);
}

export async function getCustomerInfo(
  customerId: string,
  loginCustomerId: string | null,
  accessToken: string,
): Promise<{ name: string; currencyCode: string }> {
  const rows = await search(
    customerId,
    loginCustomerId,
    accessToken,
    "SELECT customer.descriptive_name, customer.currency_code FROM customer LIMIT 1",
  );
  const c = rows[0]?.customer ?? {};
  return { name: c.descriptiveName ?? "", currencyCode: c.currencyCode ?? "BRL" };
}
