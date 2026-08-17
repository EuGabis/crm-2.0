import crypto from "crypto";
import { createClient } from "@/lib/supabase/server";
import {
  providerConfig,
  redirectUri,
  signState,
  type MediaProvider,
} from "@/lib/integrations/media-oauth";

export const dynamic = "force-dynamic";

/**
 * Manda o usuário para o consentimento do Google Drive ou do Canva.
 * Autenticada; só admin conecta (a RLS da 0045 recusaria a gravação de
 * qualquer forma, mas melhor barrar antes de mandar a pessoa para fora).
 */
export async function GET(request: Request) {
  const provider = new URL(request.url).searchParams.get("provider") as MediaProvider | null;
  // O Google Drive deixou de passar por aqui: virou Google Picker no navegador
  // (escopo `drive.file`), porque listar o Drive inteiro exigiria
  // `drive.readonly` — escopo RESTRITO, que só funciona depois da verificação
  // de segurança do Google. Ver 0046 e components/media/drive-picker.tsx.
  if (provider === "google_drive") {
    return Response.json(
      {
        error:
          "O Google Drive não usa mais este fluxo: os arquivos são escolhidos pelo Google Picker, na aba Google Drive.",
      },
      { status: 410 }
    );
  }
  if (provider !== "canva") {
    return Response.json({ error: "provider inválido" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Não autenticado" }, { status: 401 });

  const { data: membership } = await supabase
    .from("location_members")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();
  if (membership?.role !== "admin") {
    return Response.json(
      { error: "Apenas administradores conectam integrações de mídia" },
      { status: 403 }
    );
  }

  const cfg = providerConfig(provider);
  if (!cfg.clientId || !cfg.clientSecret) {
    return Response.json(
      {
        error:
          provider === "canva"
            ? "Canva não configurado no servidor (CANVA_CLIENT_ID/SECRET)"
            : "OAuth do Google não configurado no servidor",
      },
      { status: 503 }
    );
  }

  const state = signState(provider);
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: cfg.scope,
    state,
  });

  const cookies: string[] = [];
  const isHttps = (process.env.NEXT_PUBLIC_APP_URL || "").startsWith("https");
  const cookieBase = ["HttpOnly", "SameSite=Lax", "Path=/api/media/oauth", "Max-Age=600"];
  if (isHttps) cookieBase.push("Secure");

  // Daqui só passa o Canva, que exige PKCE (S256). O verifier vai num cookie
  // httpOnly — no localStorage qualquer script da página leria o segredo.
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  params.set("code_challenge", challenge);
  params.set("code_challenge_method", "S256");
  cookies.push([`media_pkce=${verifier}`, ...cookieBase].join("; "));

  cookies.push([`media_oauth_state=${state}`, ...cookieBase].join("; "));

  const headers = new Headers({ Location: `${cfg.authUrl}?${params}` });
  for (const c of cookies) headers.append("Set-Cookie", c);
  return new Response(null, { status: 302, headers });
}
