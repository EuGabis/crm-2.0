import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  listAccessibleCustomers,
  refreshAccessToken,
  search,
} from "@/lib/google-ads/client";

/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = "force-dynamic";

/**
 * Escolha da conta do Google Ads (2026-11-09). O OAuth só grava o token; aqui a
 * pessoa vê TODAS as contas que o login enxerga — inclusive as que ficam embaixo
 * de uma MCC — e escolhe. A conta escolhida vai junto do `login_customer_id`
 * (a MCC por onde ela é alcançada), sem o qual o Google recusa a leitura.
 */

export type ContaAds = {
  id: string;
  nome: string;
  moeda: string;
  gerente: boolean; // MCC: não tem campanhas próprias
  via: string | null; // login_customer_id (a MCC raiz), nulo = acesso direto
};

async function contexto() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { erro: Response.json({ error: "Não autenticado" }, { status: 401 }) };
  // Linha da empresa pela RLS (membership); o token só pela service role.
  const { data: conn } = await supabase
    .from("google_ads_connections").select("location_id").maybeSingle();
  if (!conn) return { erro: Response.json({ error: "Conecte o Google Ads primeiro." }, { status: 404 }) };
  const admin = createAdminClient();
  const { data: sec } = await admin
    .from("google_ads_connections").select("refresh_token")
    .eq("location_id", conn.location_id).maybeSingle();
  if (!sec?.refresh_token) return { erro: Response.json({ error: "Token ausente — reconecte." }, { status: 404 }) };
  return { locationId: conn.location_id as string, refreshToken: sec.refresh_token as string, admin };
}

export async function GET() {
  const c = await contexto();
  if ("erro" in c) return c.erro;
  try {
    const token = await refreshAccessToken(c.refreshToken);
    const raizes = await listAccessibleCustomers(token);
    const contas = new Map<string, ContaAds>();
    const erros: string[] = [];
    for (const raiz of raizes) {
      try {
        const rows = await search(
          raiz, raiz, token,
          `SELECT customer_client.id, customer_client.descriptive_name,
                  customer_client.currency_code, customer_client.manager,
                  customer_client.status
             FROM customer_client
            WHERE customer_client.status = 'ENABLED'`,
        );
        for (const r of rows) {
          const cc = r.customerClient ?? {};
          const id = String(cc.id ?? "");
          if (!id) continue;
          const conta: ContaAds = {
            id,
            nome: cc.descriptiveName || `Conta ${id}`,
            moeda: cc.currencyCode || "BRL",
            gerente: !!cc.manager,
            // A própria raiz é acessada direto; as de baixo, pela raiz.
            via: id === raiz ? null : raiz,
          };
          // Acesso direto ganha de acesso via MCC.
          if (!contas.has(id) || conta.via === null) contas.set(id, conta);
        }
      } catch (e) {
        erros.push(`${raiz}: ${e instanceof Error ? e.message : "falha"}`);
      }
    }
    const lista = [...contas.values()].sort(
      (a, b) => Number(a.gerente) - Number(b.gerente) || a.nome.localeCompare(b.nome),
    );
    return Response.json({ contas: lista, erros, raizes });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "falha" }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const c = await contexto();
  if ("erro" in c) return c.erro;
  const body: any = await request.json().catch(() => ({}));
  const id = String(body?.id ?? "").replace(/\D/g, "");
  const via = body?.via ? String(body.via).replace(/\D/g, "") : null;
  if (!id) return Response.json({ error: "Conta inválida" }, { status: 400 });
  try {
    // Confere que a conta é legível ANTES de gravar: o erro sai aqui, na tela,
    // e não depois no relatório.
    const token = await refreshAccessToken(c.refreshToken);
    const rows = await search(
      id, via, token,
      "SELECT customer.descriptive_name, customer.currency_code, customer.manager FROM customer LIMIT 1",
    );
    const cu = rows[0]?.customer ?? {};
    if (cu.manager) {
      return Response.json(
        { error: "Essa é uma conta de administrador (MCC) e não tem campanhas. Escolha uma conta de anúncios." },
        { status: 400 },
      );
    }
    const { error } = await c.admin.from("google_ads_connections").update({
      customer_id: id,
      login_customer_id: via,
      currency_code: cu.currencyCode || "BRL",
      active: true,
    }).eq("location_id", c.locationId);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ ok: true, nome: cu.descriptiveName ?? "" });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "falha" }, { status: 502 });
  }
}
