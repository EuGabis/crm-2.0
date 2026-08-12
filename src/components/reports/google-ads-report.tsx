"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/shared/kpi-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import {
  googleAdsActions,
  useGoogleAdsConnection,
  type OverviewData,
} from "@/lib/data/repos/db/google-ads";
import { Megaphone } from "lucide-react";

const PERIODS: { label: string; days: number }[] = [
  { label: "7 dias", days: 7 },
  { label: "30 dias", days: 30 },
  { label: "90 dias", days: 90 },
];

function isoDaysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
function fmtMoney(v: number, currency: string) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: currency || "BRL" }).format(v);
}
function fmtNum(v: number) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(v);
}

export function GoogleAdsReport() {
  const { connection, ready } = useGoogleAdsConnection();
  const [days, setDays] = useState(30);
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(false);

  // toast de retorno do OAuth (?connected=1 / ?error=)
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get("connected") === "1") toast.success("Google Ads conectado");
    const err = p.get("error");
    if (err) toast.error(`Falha ao conectar: ${decodeURIComponent(err)}`);
  }, []);

  const fetchOverview = useCallback(async () => {
    setLoading(true);
    const res = await googleAdsActions.overview(isoDaysAgo(days), todayIso());
    setLoading(false);
    if (res.connected && res.data) setData(res.data);
    else if (res.error) toast.error(res.error);
  }, [days]);

  useEffect(() => {
    if (connection) void fetchOverview();
  }, [connection, fetchOverview]);

  if (!ready) return <p className="text-xs text-slate-400">Carregando…</p>;

  if (!connection) {
    return (
      <EmptyState
        icon={Megaphone}
        title="Conecte sua conta do Google Ads"
        description="Veja Cliques, Conversões, Custo e suas campanhas direto no CRM (somente leitura)."
        cta={
          <Button
            size="sm"
            className="h-8 text-xs"
            onClick={() => {
              window.location.href = googleAdsActions.startConnectPath();
            }}
          >
            Conectar Google Ads
          </Button>
        }
      />
    );
  }

  const currency = data?.currency ?? connection.currencyCode ?? "BRL";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-500">
          Conta: {connection.connectedEmail || connection.customerId}
        </p>
        <div className="flex items-center gap-1.5">
          {PERIODS.map((p) => (
            <button
              key={p.days}
              onClick={() => setDays(p.days)}
              className={
                p.days === days
                  ? "rounded-md bg-indigo-100 px-2.5 py-1 text-[11px] font-semibold text-indigo-700"
                  : "rounded-md px-2.5 py-1 text-[11px] text-slate-500 hover:bg-slate-100"
              }
            >
              {p.label}
            </button>
          ))}
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={async () => {
              if (await googleAdsActions.disconnect()) toast.success("Google Ads desconectado");
            }}
          >
            Desconectar
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <KpiCard label="Cliques" value={data ? fmtNum(data.kpis.clicks) : "—"} />
        <KpiCard label="Conversões" value={data ? fmtNum(data.kpis.conversions) : "—"} />
        <KpiCard label="Custo / conv." value={data ? fmtMoney(data.kpis.costPerConv, currency) : "—"} />
        <KpiCard label="Custo" value={data ? fmtMoney(data.kpis.cost, currency) : "—"} />
      </div>

      <div className="rounded-xl border bg-white p-4">
        <p className="mb-2 text-xs font-semibold text-slate-700">Cliques × Conversões</p>
        <div className="h-64">
          {data && data.series.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.series} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Line type="monotone" dataKey="clicks" name="Cliques" stroke="#6366f1" dot={false} />
                <Line type="monotone" dataKey="conversions" name="Conversões" stroke="#ef4444" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-slate-400">
              {loading ? "Carregando…" : "Sem dados no período"}
            </div>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b text-[11px] text-slate-400">
              {["Campanha", "Status", "Cliques", "Conversões", "Custo", "Custo/conv."].map((h) => (
                <th key={h} className="whitespace-nowrap px-4 py-2.5 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(data?.campaigns ?? []).map((c, i) => (
              <tr key={i} className="border-b last:border-0">
                <td className="px-4 py-2.5 font-medium text-slate-800">{c.name}</td>
                <td className="px-4 py-2.5">
                  <Badge variant="secondary" className={c.status === "ENABLED" ? "bg-emerald-100 text-emerald-700" : ""}>
                    {c.status}
                  </Badge>
                </td>
                <td className="px-4 py-2.5 text-slate-500">{fmtNum(c.clicks)}</td>
                <td className="px-4 py-2.5 text-slate-500">{fmtNum(c.conversions)}</td>
                <td className="px-4 py-2.5 text-slate-500">{fmtMoney(c.cost, currency)}</td>
                <td className="px-4 py-2.5 text-slate-500">{fmtMoney(c.costPerConv, currency)}</td>
              </tr>
            ))}
            {data && data.campaigns.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                  Nenhuma campanha no período
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
