import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import {
  exchangeCode,
  redirectUri,
  saveConnection,
  verifyState,
} from "@/lib/integrations/media-oauth";

/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = "force-dynamic";

const CLEAR_COOKIES = [
  "media_oauth_state=; Path=/api/media/oauth; Max-Age=0",
  "media_pkce=; Path=/api/media/oauth; Max-Age=0",
];

function back(params: string) {
  const base = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
  const headers = new Headers({ Location: `${base}/midia?${params}` });
  for (const c of CLEAR_COOKIES) headers.append("Set-Cookie", c);
  return new Response(null, { status: 302, headers });
}

/** Recebe o code, troca por tokens e guarda a conexão. Volta para /midia. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");
  if (oauthError) return back(`error=${encodeURIComponent(oauthError)}`);

  const jar = await cookies();
  const cookieState = jar.get("media_oauth_state")?.value ?? null;
  const provider = verifyState(state);
  if (!provider || !cookieState || cookieState !== state) return back("error=state_invalido");
  if (!code) return back("error=sem_code");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return back("error=nao_autenticado");

  const { data: membership } = await supabase
    .from("location_members")
    .select("location_id, role")
    .eq("user_id", user.id)
    .maybeSingle();
  const locationId = (membership as any)?.location_id;
  if (!locationId) return back("error=sem_empresa");
  if ((membership as any)?.role !== "admin") return back("error=sem_permissao");

  try {
    const tokens = await exchangeCode(
      provider,
      code,
      provider === "canva" ? jar.get("media_pkce")?.value : undefined
    );
    const label = await accountLabel(provider, tokens.accessToken, user.email ?? "");
    const { error } = await saveConnection(locationId, provider, tokens, label, user.id);
    if (error) return back(`error=${encodeURIComponent(error.message)}`);
    return back(`connected=${provider}`);
  } catch (e) {
    return back(`error=${encodeURIComponent(e instanceof Error ? e.message : "falha")}`);
  }
}

/**
 * Rótulo da conta conectada, só para a tela dizer QUAL conta é. Falha aqui não
 * pode derrubar a conexão inteira — cai no e-mail de quem conectou.
 */
async function accountLabel(
  provider: "google_drive" | "canva",
  accessToken: string,
  fallback: string
): Promise<string> {
  try {
    if (provider === "google_drive") {
      const res = await fetch(
        "https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName)",
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!res.ok) return fallback;
      const json = await res.json();
      return json?.user?.emailAddress || json?.user?.displayName || fallback;
    }
    const res = await fetch("https://api.canva.com/rest/v1/users/me/profile", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return fallback;
    const json = await res.json();
    return json?.profile?.display_name || fallback;
  } catch {
    return fallback;
  }
}

// `redirectUri` é importado para manter uma fonte só do endereço de callback
// (o mesmo valor tem que estar cadastrado no Google e no Canva).
void redirectUri;
