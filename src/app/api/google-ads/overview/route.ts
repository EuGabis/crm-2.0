import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { refreshAccessToken, search } from "@/lib/google-ads/client";

/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = "force-dynamic";

const MICROS = 1_000_000;

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
// GAQL usa datas 'YYYY-MM-DD'; sanitiza para evitar injeção no BETWEEN.
function safeDate(v: string | null, fallback: string): string {
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : fallback;
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Não autenticado" }, { status: 401 });

  // status (colunas não-secretas) via RLS
  const { data: conn } = await supabase
    .from("google_ads_connections")
    .select("location_id, customer_id, login_customer_id, currency_code, active")
    .maybeSingle();
  if (!conn || !conn.active) return Response.json({ connected: false });

  // refresh_token só via service-role (coluna revogada para o cliente), chaveado
  // por location_id (única — customer_id não tem unicidade garantida)
  const admin = createAdminClient();
  const { data: secretRow } = await admin
    .from("google_ads_connections")
    .select("refresh_token")
    .eq("location_id", conn.location_id)
    .maybeSingle();
  if (!secretRow?.refresh_token) return Response.json({ connected: false });

  const url = new URL(request.url);
  const from = safeDate(url.searchParams.get("from"), isoDaysAgo(30));
  const to = safeDate(url.searchParams.get("to"), todayIso());

  try {
    const accessToken = await refreshAccessToken(secretRow.refresh_token);
    const login = conn.login_customer_id ?? null;

    const seriesRows = await search(
      conn.customer_id,
      login,
      accessToken,
      `SELECT segments.date, metrics.clicks, metrics.conversions, metrics.cost_micros
       FROM customer WHERE segments.date BETWEEN '${from}' AND '${to}' ORDER BY segments.date`,
    );
    const series = seriesRows.map((r: any) => ({
      date: r.segments?.date,
      clicks: Number(r.metrics?.clicks ?? 0),
      conversions: Number(r.metrics?.conversions ?? 0),
      cost: Number(r.metrics?.costMicros ?? 0) / MICROS,
    }));
    const kpisAgg = series.reduce(
      (a, s) => ({ clicks: a.clicks + s.clicks, conversions: a.conversions + s.conversions, cost: a.cost + s.cost }),
      { clicks: 0, conversions: 0, cost: 0 },
    );
    const kpis = {
      ...kpisAgg,
      costPerConv: kpisAgg.conversions > 0 ? kpisAgg.cost / kpisAgg.conversions : 0,
    };

    const campRows = await search(
      conn.customer_id,
      login,
      accessToken,
      `SELECT campaign.name, campaign.status, metrics.clicks, metrics.conversions, metrics.cost_micros
       FROM campaign WHERE segments.date BETWEEN '${from}' AND '${to}' ORDER BY metrics.cost_micros DESC`,
    );
    const campaigns = campRows.map((r: any) => {
      const cost = Number(r.metrics?.costMicros ?? 0) / MICROS;
      const conversions = Number(r.metrics?.conversions ?? 0);
      return {
        name: r.campaign?.name ?? "",
        status: r.campaign?.status ?? "",
        clicks: Number(r.metrics?.clicks ?? 0),
        conversions,
        cost,
        costPerConv: conversions > 0 ? cost / conversions : 0,
      };
    });

    return Response.json({ connected: true, currency: conn.currency_code || "BRL", kpis, series, campaigns });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Falha na Google Ads API" },
      { status: 502 },
    );
  }
}
