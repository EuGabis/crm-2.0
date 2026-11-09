import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { exchangeCode } from "@/lib/google-ads/client";
import { redirectUri, verifyState } from "@/lib/google-ads/state";
import { originDaRequisicao } from "@/lib/config/app-url";

/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = "force-dynamic";

function back(base: string, params: string) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${base.replace(/\/$/, "")}/relatorios?tab=Google%20Ads&${params}`,
      "Set-Cookie": "ga_oauth_state=; Path=/api/google-ads/oauth; Max-Age=0",
    },
  });
}

/** Recebe o code do Google, troca por tokens, pega a 1ª conta e salva a conexão. */
export async function GET(request: Request) {
  // Volta pelo domínio por onde a pessoa chegou: NEXT_PUBLIC_APP_URL ainda
  // aponta para o domínio aposentado (404), e era para lá que o callback
  // mandava — o erro do Google nunca aparecia na tela.
  const appUrl = originDaRequisicao(request);
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) return back(appUrl, `error=${encodeURIComponent(oauthError)}`);

  const cookieState = (await cookies()).get("ga_oauth_state")?.value ?? null;
  if (!verifyState(state) || !cookieState || cookieState !== state) {
    return back(appUrl, "error=state_invalido");
  }
  if (!code) return back(appUrl, "error=sem_code");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return back(appUrl, "error=nao_autenticado");

  // location da sessão (mesma consulta usada nos repos: membership)
  const { data: membership } = await supabase
    .from("location_members")
    .select("location_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  const locationId = (membership as any)?.location_id;
  if (!locationId) return back(appUrl, "error=sem_empresa");

  try {
    const { refreshToken } = await exchangeCode(code, redirectUri());
    /*
     * A conta NÃO é escolhida aqui (antes: `customers[0]`, que costuma ser a MCC,
     * sem campanhas; e `login_customer_id` ficava sempre nulo, o que faz o Google
     * recusar conta que fica embaixo de uma MCC). Grava só o token, inativo, e a
     * tela lista as contas para a pessoa escolher (`/api/google-ads/contas`).
     */
    const admin = createAdminClient();
    const { error } = await admin.from("google_ads_connections").upsert(
      {
        location_id: locationId,
        customer_id: "",
        login_customer_id: null,
        refresh_token: refreshToken,
        connected_email: user.email ?? "",
        currency_code: "BRL",
        connected_at: new Date().toISOString(),
        active: false,
      },
      { onConflict: "location_id" },
    );
    if (error) return back(appUrl, `error=${encodeURIComponent(error.message)}`);
    return back(appUrl, "escolher=1");
  } catch (e) {
    return back(appUrl, `error=${encodeURIComponent(e instanceof Error ? e.message : "falha")}`);
  }
}
