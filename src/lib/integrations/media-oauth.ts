import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * OAuth das integrações de mídia (Google Drive e Canva) e leitura dos tokens.
 *
 * O `state` é assinado com HMAC (anti-CSRF) e o cookie httpOnly amarra o fluxo
 * ao navegador que começou — mesmo desenho do OAuth do Google Ads.
 *
 * Os tokens ficam em `media_connections`, que é ADMIN-ONLY (0045); quem lê aqui
 * é sempre a SERVICE ROLE, e nada de token é devolvido ao navegador.
 */

export type MediaProvider = "google_drive" | "canva";

const MAX_AGE_MS = 10 * 60 * 1000;

function secret(): string {
  // Reaproveita um segredo que já existe no servidor. AUTOMATION_SECRET é
  // server-only e obrigatório em produção; não vale criar env nova só para isso.
  const s = process.env.AUTOMATION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) throw new Error("AUTOMATION_SECRET ausente no servidor");
  return s;
}

export function signState(provider: MediaProvider): string {
  const payload = `${provider}.${crypto.randomBytes(8).toString("hex")}.${Date.now()}`;
  const sig = crypto.createHmac("sha256", secret()).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

export function verifyState(state: string | null): MediaProvider | null {
  if (!state) return null;
  const i = state.lastIndexOf(".");
  if (i < 0) return null;
  const payload = state.slice(0, i);
  const sig = state.slice(i + 1);
  const expected = crypto.createHmac("sha256", secret()).update(payload).digest("hex");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const [provider, , ts] = payload.split(".");
  if (!Number.isFinite(Number(ts)) || Date.now() - Number(ts) > MAX_AGE_MS) return null;
  return provider === "google_drive" || provider === "canva" ? provider : null;
}

export function redirectUri(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/api/media/oauth/callback`;
}

export interface MediaTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
}

/** Guarda/atualiza a conexão (service role — a tabela é admin-only). */
export async function saveConnection(
  locationId: string,
  provider: MediaProvider,
  tokens: MediaTokens,
  accountLabel: string,
  userId: string | null
) {
  const db = createAdminClient();
  return db.from("media_connections").upsert(
    {
      location_id: locationId,
      provider,
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expires_at: tokens.expiresAt,
      account_label: accountLabel,
      connected_by: userId,
    },
    { onConflict: "location_id,provider" }
  );
}

/**
 * Access token válido da conexão. Renova pelo refresh token quando expirou —
 * sem isso a integração pararia de funcionar em uma hora e o usuário teria que
 * reconectar à mão todo dia.
 */
export async function getAccessToken(
  locationId: string,
  provider: MediaProvider
): Promise<string | null> {
  const db = createAdminClient();
  const { data } = await db
    .from("media_connections")
    .select("access_token, refresh_token, expires_at")
    .eq("location_id", locationId)
    .eq("provider", provider)
    .maybeSingle();
  if (!data?.access_token) return null;

  const expiresAt = data.expires_at ? new Date(data.expires_at).getTime() : 0;
  // Margem de 60s: token que expira "agora" já chega inválido na outra ponta.
  if (!expiresAt || expiresAt - 60_000 > Date.now()) return data.access_token;
  if (!data.refresh_token) return data.access_token;

  const refreshed = await refresh(provider, data.refresh_token);
  if (!refreshed) return data.access_token;

  await db
    .from("media_connections")
    .update({
      access_token: refreshed.accessToken,
      expires_at: refreshed.expiresAt,
      // O Canva rotaciona o refresh token a cada uso; o Google mantém o mesmo.
      refresh_token: refreshed.refreshToken ?? data.refresh_token,
    })
    .eq("location_id", locationId)
    .eq("provider", provider);
  return refreshed.accessToken;
}

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const CANVA_TOKEN_URL = "https://api.canva.com/rest/v1/oauth/token";

function expiresAtFrom(expiresIn: unknown): string | null {
  const seconds = Number(expiresIn);
  return Number.isFinite(seconds) ? new Date(Date.now() + seconds * 1000).toISOString() : null;
}

export function providerConfig(provider: MediaProvider) {
  if (provider === "google_drive") {
    return {
      clientId: process.env.GOOGLE_OAUTH_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "",
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: GOOGLE_TOKEN_URL,
      // Somente leitura: o CRM lista e abre, nunca altera o Drive de ninguém.
      scope: "https://www.googleapis.com/auth/drive.readonly openid email",
    };
  }
  return {
    clientId: process.env.CANVA_CLIENT_ID ?? "",
    clientSecret: process.env.CANVA_CLIENT_SECRET ?? "",
    authUrl: "https://www.canva.com/api/oauth/authorize",
    tokenUrl: CANVA_TOKEN_URL,
    scope: "design:meta:read asset:read profile:read",
  };
}

/** Troca o `code` por tokens. Basic auth no Canva, corpo no Google. */
export async function exchangeCode(
  provider: MediaProvider,
  code: string,
  codeVerifier?: string
): Promise<MediaTokens> {
  const cfg = providerConfig(provider);
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(),
  });
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (provider === "canva") {
    if (codeVerifier) body.set("code_verifier", codeVerifier);
    headers.Authorization = `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64")}`;
  } else {
    body.set("client_id", cfg.clientId);
    body.set("client_secret", cfg.clientSecret);
  }

  const res = await fetch(cfg.tokenUrl, { method: "POST", headers, body });
  if (!res.ok) throw new Error(`token ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresAt: expiresAtFrom(json.expires_in),
  };
}

async function refresh(
  provider: MediaProvider,
  refreshToken: string
): Promise<MediaTokens | null> {
  const cfg = providerConfig(provider);
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken });
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (provider === "canva") {
    headers.Authorization = `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64")}`;
  } else {
    body.set("client_id", cfg.clientId);
    body.set("client_secret", cfg.clientSecret);
  }
  const res = await fetch(cfg.tokenUrl, { method: "POST", headers, body });
  if (!res.ok) return null;
  const json = await res.json();
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresAt: expiresAtFrom(json.expires_in),
  };
}
