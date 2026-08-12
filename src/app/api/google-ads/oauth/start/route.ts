import { createClient } from "@/lib/supabase/server";
import { redirectUri, signState } from "@/lib/google-ads/state";

export const dynamic = "force-dynamic";

/** Monta a URL de consentimento do Google e redireciona o usuário. Autenticada. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Não autenticado" }, { status: 401 });

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) return Response.json({ error: "OAuth do Google não configurado" }, { status: 503 });

  const state = signState();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: "https://www.googleapis.com/auth/adwords",
    access_type: "offline",
    prompt: "consent",
    state,
  });

  // Vincula o state ao navegador que iniciou o fluxo (defesa extra além da assinatura HMAC).
  const isHttps = (process.env.NEXT_PUBLIC_APP_URL || "").startsWith("https");
  const cookie = [
    `ga_oauth_state=${state}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/api/google-ads/oauth",
    "Max-Age=600",
    isHttps ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");

  return new Response(null, {
    status: 302,
    headers: {
      Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
      "Set-Cookie": cookie,
    },
  });
}
