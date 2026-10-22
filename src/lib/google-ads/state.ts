import { appBaseUrl } from "@/lib/config/app-url";
import crypto from "crypto";

/** Assina/valida o `state` do OAuth (anti-CSRF). HMAC com o client secret do OAuth. */
function secret(): string {
  const s = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!s) throw new Error("GOOGLE_OAUTH_CLIENT_SECRET ausente no servidor");
  return s;
}

const MAX_AGE_MS = 10 * 60 * 1000;

export function signState(): string {
  const payload = `${crypto.randomBytes(8).toString("hex")}.${Date.now()}`;
  const sig = crypto.createHmac("sha256", secret()).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

export function verifyState(state: string | null): boolean {
  if (!state) return false;
  const i = state.lastIndexOf(".");
  if (i < 0) return false;
  const payload = state.slice(0, i);
  const sig = state.slice(i + 1);
  const expected = crypto.createHmac("sha256", secret()).update(payload).digest("hex");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  const ts = Number(payload.split(".")[1]);
  return Number.isFinite(ts) && Date.now() - ts < MAX_AGE_MS;
}

export function redirectUri(): string {
  // `appBaseUrl` ignora o domínio aposentado (lito-crm.vercel.app): com a env
  // antiga, o Google recusava com redirect_uri_mismatch (2026-10-22).
  const base = appBaseUrl();
  return `${base.replace(/\/$/, "")}/api/google-ads/oauth/callback`;
}
