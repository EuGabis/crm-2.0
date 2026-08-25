"use client";

import { useMemo } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ArrowRight } from "lucide-react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { shortBRL, WidgetCard } from "./widget-card";
import { TOOLTIP_STYLE } from "./opportunity-widgets";
import { useDashboardRange } from "./date-range";
import { formatBRL } from "@/lib/data/repos/opportunities";
import {
  useGuruIntegration,
  usePaymentEventsPage,
  usePaymentSalesReport,
  usePaymentSubscriptions,
} from "@/lib/data/repos/db/payments";
import { classifyGuruStatus, guruStatusLabel } from "@/lib/data/guru";

/**
 * Widgets de Pagamentos no painel. Só aparecem para quem enxerga o módulo
 * (`requires: "pagamentos"` no catálogo) — a checagem é a mesma do menu, e a
 * RLS das tabelas da Guru continua sendo a fronteira de verdade.
 */

function NotConnected({ title }: { title: string }) {
  return (
    <WidgetCard title={title}>
      <p className="py-6 text-center text-xs text-slate-400">
        Guru não conectada — os dados aparecem aqui assim que a integração sincronizar.
      </p>
    </WidgetCard>
  );
}

const STATUS_CLASS: Record<string, string> = {
  aprovado: "bg-emerald-100 text-emerald-700",
  pendente: "bg-amber-100 text-amber-700",
  atrasado: "bg-amber-100 text-amber-700",
  reembolsado: "bg-slate-100 text-slate-600",
  chargeback: "bg-rose-100 text-rose-700",
  recusado: "bg-rose-100 text-rose-700",
  cancelado: "bg-slate-100 text-slate-600",
  expirado: "bg-slate-100 text-slate-600",
};

export function RecentSalesWidget() {
  const { guru, loaded } = useGuruIntegration();
  const { range } = useDashboardRange();

  // Segue o filtro de período do painel — o mesmo filtro que os widgets de
  // oportunidade usam. Filtrado no BANCO: são milhares de vendas e a página
  // traz 8.
  const filter = useMemo(
    () => ({
      dateField: "guru_created_at",
      from: format(range.from, "yyyy-MM-dd"),
      to: format(range.to, "yyyy-MM-dd"),
      status: [] as string[],
      product: "",
      search: "",
    }),
    [range.from, range.to]
  );
  const { rows, total, loading } = usePaymentEventsPage(0, false, 8, filter);

  if (loaded && !guru.connected) return <NotConnected title="Vendas recentes (Guru)" />;

  return (
    <WidgetCard
      title="Vendas recentes (Guru)"
      footer={
        <Link
          href="/pagamentos"
          className="mt-2 inline-flex items-center gap-1 border-t pt-2 text-xs font-semibold text-indigo-600 hover:underline"
        >
          Ver todas as vendas <ArrowRight className="size-3" />
        </Link>
      }
    >
      {loading && rows.length === 0 ? (
        <p className="py-6 text-center text-xs text-slate-400">Carregando…</p>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-xs text-slate-400">
          Nenhuma venda no período selecionado.
        </p>
      ) : (
        <>
          <table className="w-full text-left text-xs">
            <tbody>
              {rows.map((e) => {
                const cat = classifyGuruStatus(e.status);
                return (
                  <tr key={e.id} className="border-b last:border-0">
                    <td className="py-1.5 pr-2">
                      <span className="block max-w-[160px] truncate font-medium text-slate-700">
                        {e.contactName ?? e.contactEmail ?? "—"}
                      </span>
                      <span className="block max-w-[160px] truncate text-[10px] text-slate-400">
                        {e.productName ?? "—"}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-[10px] text-slate-500">
                      {e.guruCreatedAt
                        ? format(new Date(e.guruCreatedAt), "dd MMM", { locale: ptBR })
                        : "—"}
                    </td>
                    <td className="px-2 py-1.5">
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                          STATUS_CLASS[cat] ?? "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {guruStatusLabel(e.status)}
                      </span>
                    </td>
                    <td className="py-1.5 pl-2 text-right text-xs font-semibold text-slate-800">
                      {e.amount !== null ? formatBRL(e.amount) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-[10px] text-slate-400">
            8 mais recentes de {total.toLocaleString("pt-BR")} no período.
          </p>
        </>
      )}
    </WidgetCard>
  );
}

export function RevenueByMonthWidget() {
  const { guru, loaded } = useGuruIntegration();
  const { rows } = usePaymentSalesReport();

  // Últimos 6 meses SEMPRE — a agregação é mensal, então recortar pelo período
  // do painel (que pode ser "hoje") daria uma barra só e enganaria.
  const data = useMemo(() => {
    const byMonth = new Map<string, number>();
    for (const r of rows) {
      if (classifyGuruStatus(r.status) !== "aprovado") continue;
      const key = String(r.month).slice(0, 7);
      byMonth.set(key, (byMonth.get(key) ?? 0) + r.revenue);
    }
    return [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-6)
      .map(([month, revenue]) => ({
        month: format(new Date(`${month}-01T00:00:00`), "MMM/yy", { locale: ptBR }),
        revenue,
      }));
  }, [rows]);

  if (loaded && !guru.connected) return <NotConnected title="Receita por mês (Guru)" />;

  const total = data.reduce((s, d) => s + d.revenue, 0);

  return (
    <WidgetCard
      title="Receita por mês (Guru)"
      footer={
        <p className="mt-2 border-t pt-2 text-center text-xs text-slate-500">
          Últimos 6 meses <span className="font-bold text-slate-800">{formatBRL(total)}</span>
        </p>
      }
    >
      {data.length === 0 ? (
        <p className="py-6 text-center text-xs text-slate-400">
          Nenhuma venda aprovada sincronizada ainda.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={170}>
          <BarChart data={data} margin={{ left: 4, right: 8 }}>
            <XAxis dataKey="month" fontSize={10} />
            {/* `shortBRL` e não dividir por mil: com receita abaixo de R$ 1.000
                o eixo virava "R$0K" em TODOS os traços — o mesmo defeito que o
                widget de Valor de Oportunidade já teve. */}
            <YAxis fontSize={10} tickFormatter={shortBRL} />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(v) => [formatBRL(Number(v)), "Receita aprovada"]}
            />
            <Bar dataKey="revenue" fill="#6366f1" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </WidgetCard>
  );
}

export function SubscriptionsWidget() {
  const { guru, loaded } = useGuruIntegration();
  const subscriptions = usePaymentSubscriptions();

  const counts = useMemo(() => {
    const acc = { ativa: 0, atrasado: 0, cancelado: 0 };
    for (const s of subscriptions) {
      const cat = classifyGuruStatus(s.status);
      if (cat === "aprovado") acc.ativa++;
      else if (cat === "atrasado") acc.atrasado++;
      else if (cat === "cancelado" || cat === "expirado") acc.cancelado++;
    }
    return acc;
  }, [subscriptions]);

  if (loaded && !guru.connected) return <NotConnected title="Assinaturas (Guru)" />;

  return (
    <WidgetCard
      title="Assinaturas (Guru)"
      footer={
        <Link
          href="/pagamentos"
          className="mt-2 inline-flex items-center gap-1 border-t pt-2 text-xs font-semibold text-indigo-600 hover:underline"
        >
          Ver assinaturas <ArrowRight className="size-3" />
        </Link>
      }
    >
      {/* Estado ATUAL de cada assinante — não segue o filtro de período, e o
          rótulo diz isso. */}
      <div className="grid grid-cols-3 gap-2 py-2 text-center">
        <div className="rounded-lg bg-emerald-50 py-3">
          <p className="text-lg font-bold text-emerald-700">{counts.ativa}</p>
          <p className="text-[11px] text-emerald-600">Ativas</p>
        </div>
        <div className="rounded-lg bg-amber-50 py-3">
          <p className="text-lg font-bold text-amber-700">{counts.atrasado}</p>
          <p className="text-[11px] text-amber-600">Atrasadas</p>
        </div>
        <div className="rounded-lg bg-slate-50 py-3">
          <p className="text-lg font-bold text-slate-700">{counts.cancelado}</p>
          <p className="text-[11px] text-slate-500">Canceladas</p>
        </div>
      </div>
      <p className="text-[10px] text-slate-400">Estado atual — não segue o filtro de período.</p>
    </WidgetCard>
  );
}
