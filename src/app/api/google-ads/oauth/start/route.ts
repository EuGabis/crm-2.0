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

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: "https://www.googleapis.com/auth/adwords",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: signState(),
  });
  return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, 302);
}
