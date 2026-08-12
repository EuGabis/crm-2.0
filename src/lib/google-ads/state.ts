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
  const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/api/google-ads/oauth/callback`;
}
