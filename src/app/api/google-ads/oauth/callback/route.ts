import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { exchangeCode, getCustomerInfo, listAccessibleCustomers } from "@/lib/google-ads/client";
import { redirectUri, verifyState } from "@/lib/google-ads/state";

/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = "force-dynamic";

function back(base: string, params: string) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${base.replace(/\/$/, "")}/relatorios?${params}`,
      "Set-Cookie": "ga_oauth_state=; Path=/api/google-ads/oauth; Max-Age=0",
    },
  });
}

/** Recebe o code do Google, troca por tokens, pega a 1ª conta e salva a conexão. */
export async function GET(request: Request) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
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
    const { refreshToken, accessToken } = await exchangeCode(code, redirectUri());
    const customers = await listAccessibleCustomers(accessToken);
    if (customers.length === 0) return back(appUrl, "error=nenhuma_conta");
    const customerId = customers[0]; // decisão: primeira conta acessível
    const info = await getCustomerInfo(customerId, null, accessToken);

    const admin = createAdminClient();
    const { error } = await admin.from("google_ads_connections").upsert(
      {
        location_id: locationId,
        customer_id: customerId,
        login_customer_id: null,
        refresh_token: refreshToken,
        connected_email: user.email ?? "",
        currency_code: info.currencyCode || "BRL",
        connected_at: new Date().toISOString(),
        active: true,
      },
      { onConflict: "location_id" },
    );
    if (error) return back(appUrl, `error=${encodeURIComponent(error.message)}`);
    return back(appUrl, "connected=1");
  } catch (e) {
    return back(appUrl, `error=${encodeURIComponent(e instanceof Error ? e.message : "falha")}`);
  }
}
