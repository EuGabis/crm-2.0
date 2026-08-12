"use client";

import { useMemo, useState } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { SubNav } from "@/components/layout/subnav";
import { GoogleAdsReport } from "@/components/reports/google-ads-report";
import { KpiCard } from "@/components/shared/kpi-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useUsers, useContacts, contactName } from "@/lib/data/repos/contacts";
import { formatBRL, useOpportunities } from "@/lib/data/repos/opportunities";
import { cn } from "@/lib/utils";

const TABS = [
  { label: "Google Ads" },
  { label: "Anúncios Meta" },
  { label: "Relatórios personalizados" },
  { label: "Atribuição" },
  { label: "Ligações" },
  { label: "Agentes" },
  { label: "Compromissos" },
];

const SERIES = Array.from({ length: 14 }, (_, i) => ({
  dia: `${16 + i > 31 ? 16 + i - 31 : 16 + i}/06`,
  impressoes: 8000 + ((i * 1237) % 6000),
  cliques: 900 + ((i * 311) % 800),
  conversoes: 300 + ((i * 97) % 400),
  meta_imp: 6200 + ((i * 991) % 4200),
  meta_cli: 700 + ((i * 271) % 600),
  meta_leads: 90 + ((i * 53) % 120),
}));

const META_CAMPAIGNS = [
  { name: "[Frio] Vídeo — Dor do follow-up", status: "Ativa", clicks: 5214, cost: "R$ 1.180,00", leads: 684, cpl: "R$ 1,73" },
  { name: "[Morno] Depoimentos — Prova social", status: "Ativa", clicks: 3120, cost: "R$ 820,00", leads: 512, cpl: "R$ 1,60" },
  { name: "[Quente] Oferta 70% OFF", status: "Ativa", clicks: 2409, cost: "R$ 690,00", leads: 438, cpl: "R$ 1,58" },
  { name: "[Retargeting] Carrinho abandonado", status: "Pausada", clicks: 1559, cost: "R$ 430,00", leads: 208, cpl: "R$ 2,07" },
];

const CUSTOM_REPORTS = [
  { name: "Visão geral de funil", freq: "Semanal", by: "Gustavo Ribeiro", created: "12 jun 2026" },
  { name: "Desempenho SDR — mensal", freq: "Mensal", by: "Lucas Gomes", created: "1 jul 2026" },
  { name: "Estatísticas de oportunidades", freq: "Não agendado", by: "Biblioteca de modelos", created: "20 mai 2026" },
];

const CALLS = [
  { direction: "Recebida", duration: "4m 12s", user: "Camila Braga", date: "6 ago 2026 09:14" },
  { direction: "Realizada", duration: "7m 40s", user: "Halyson Inácio", date: "6 ago 2026 10:02" },
  { direction: "Realizada", duration: "2m 05s", user: "Emille Lima", date: "5 ago 2026 16:48" },
  { direction: "Recebida", duration: "11m 21s", user: "Gustavo Ribeiro", date: "5 ago 2026 14:30" },
  { direction: "Realizada", duration: "3m 55s", user: "Rhayan Castellar", date: "4 ago 2026 11:12" },
];

const AGENT_STATS = [
  { convs: 148, avg: "3m 20s", won: 18, revenue: 2646 },
  { convs: 122, avg: "4m 05s", won: 14, revenue: 2058 },
  { convs: 98, avg: "2m 48s", won: 11, revenue: 1617 },
  { convs: 87, avg: "5m 12s", won: 9, revenue: 1323 },
  { convs: 64, avg: "3m 51s", won: 6, revenue: 882 },
  { convs: 51, avg: "4m 33s", won: 4, revenue: 588 },
];

const APPOINTMENT_ROWS = [
  { title: "Demo Lito CRM", date: "3 ago 2026 10:00", status: "Realizado" },
  { title: "Onboarding — Linx", date: "4 ago 2026 09:30", status: "Realizado" },
  { title: "Call de fechamento", date: "5 ago 2026 11:00", status: "No-show" },
  { title: "Demo Lito CRM", date: "5 ago 2026 16:00", status: "Realizado" },
  { title: "Follow-up", date: "6 ago 2026 14:00", status: "Agendado" },
];

function MetricArea({ title, dataKey, total }: { title: string; dataKey: string; total: string }) {
  return (
    <div className="rounded-xl border bg-white p-4">
      <p className="text-xs font-medium text-slate-500">{title}</p>
      <p className="text-xl font-bold text-slate-900">{total}</p>
      <div className="mt-2 h-16">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={SERIES}>
            <defs>
              <linearGradient id={`g-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="dia" hide />
            <Tooltip />
            <Area type="monotone" dataKey={dataKey} stroke="#6366f1" fill={`url(#g-${dataKey})`} strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function SampleBanner({ platform }: { platform: string }) {
  return (
    <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-700">
      Você está visualizando dados de amostra. Conecte sua conta do {platform} para ver os dados
      reais.
    </div>
  );
}

function StatusBadge({ value }: { value: string }) {
  const good = ["Ativa", "Realizado", "Respondida"].includes(value);
  const bad = value === "No-show";
  return (
    <Badge
      variant="secondary"
      className={cn(good && "bg-emerald-100 text-emerald-700", bad && "bg-red-100 text-red-600")}
    >
      {value}
    </Badge>
  );
}

export default function RelatoriosPage() {
  const [tab, setTab] = useState("Google Ads");
  const users = useUsers();
  const contacts = useContacts();
  const opportunities = useOpportunities();

  const attribution = useMemo(() => {
    const bySource = new Map<string, { leads: number; revenue: number; won: number }>();
    for (const o of opportunities) {
      const cur = bySource.get(o.source) ?? { leads: 0, revenue: 0, won: 0 };
      cur.leads += 1;
      if (o.status === "won") {
        cur.won += 1;
        cur.revenue += o.value;
      }
      bySource.set(o.source, cur);
    }
    const totalRevenue = [...bySource.values()].reduce((s, v) => s + v.revenue, 0) || 1;
    return [...bySource.entries()].map(([source, v]) => ({ source, ...v, totalRevenue }));
  }, [opportunities]);

  return (
    <div>
      <SubNav tabs={TABS} active={tab} onChange={setTab} />
      <div className="p-6">
        {tab === "Google Ads" && <GoogleAdsReport />}

        {tab === "Anúncios Meta" && (
          <>
            <SampleBanner platform="Meta Ads" />
            <div className="mb-4 grid gap-3 md:grid-cols-3">
              <MetricArea title="Impressões" dataKey="meta_imp" total="98.410" />
              <MetricArea title="Cliques" dataKey="meta_cli" total="12.302" />
              <MetricArea title="Leads" dataKey="meta_leads" total="1.842" />
            </div>
            <div className="mb-4 grid gap-3 md:grid-cols-4">
              <KpiCard label="Investimento" value="R$ 3.120,00" />
              <KpiCard label="CPM" value="R$ 12,40" />
              <KpiCard label="CPL" value="R$ 1,69" />
              <KpiCard label="ROAS" value="4,2x" />
            </div>
            <div className="overflow-x-auto rounded-xl border bg-white">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b text-[11px] text-slate-400">
                    {["Campanha", "Status", "Cliques", "Investimento", "Leads", "CPL"].map((h) => (
                      <th key={h} className="whitespace-nowrap px-4 py-2.5 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {META_CAMPAIGNS.map((c) => (
                    <tr key={c.name} className="border-b last:border-0">
                      <td className="px-4 py-2.5 font-medium text-slate-800">{c.name}</td>
                      <td className="px-4 py-2.5"><StatusBadge value={c.status} /></td>
                      <td className="px-4 py-2.5">{c.clicks.toLocaleString("pt-BR")}</td>
                      <td className="px-4 py-2.5">{c.cost}</td>
                      <td className="px-4 py-2.5">{c.leads}</td>
                      <td className="px-4 py-2.5">{c.cpl}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {tab === "Relatórios personalizados" && (
          <>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h1 className="text-lg font-bold text-slate-900">Relatórios personalizados</h1>
                <p className="text-xs text-slate-500">Monte relatórios e agende o envio por e-mail</p>
              </div>
              <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => toast.info("Editor de relatórios chega com o backend")}>
                <Plus className="size-3.5" /> Novo relatório
              </Button>
            </div>
            <div className="rounded-xl border bg-white">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b text-[11px] text-slate-400">
                    {["Nome do relatório", "Frequência", "Criado por", "Criado em"].map((h) => (
                      <th key={h} className="px-4 py-2.5 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {CUSTOM_REPORTS.map((r) => (
                    <tr key={r.name} className="border-b last:border-0">
                      <td className="px-4 py-2.5 font-medium text-slate-800">{r.name}</td>
                      <td className="px-4 py-2.5">
                        <Badge variant="secondary" className={cn(r.freq !== "Não agendado" && "bg-indigo-100 text-indigo-700")}>
                          {r.freq}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 text-slate-500">{r.by}</td>
                      <td className="px-4 py-2.5 text-slate-500">{r.created}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {tab === "Atribuição" && (
          <>
            <h1 className="mb-1 text-lg font-bold text-slate-900">Relatório de atribuição</h1>
            <p className="mb-4 text-xs text-slate-500">
              De onde vêm seus leads e qual fonte gera mais receita (dados reais do CRM)
            </p>
            <div className="rounded-xl border bg-white">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b text-[11px] text-slate-400">
                    {["Fonte", "Leads", "Ganhas", "Receita", "% da receita"].map((h) => (
                      <th key={h} className="px-4 py-2.5 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {attribution.map((a) => (
                    <tr key={a.source} className="border-b last:border-0">
                      <td className="px-4 py-2.5 font-medium text-slate-800">{a.source}</td>
                      <td className="px-4 py-2.5">{a.leads}</td>
                      <td className="px-4 py-2.5 text-emerald-600">{a.won}</td>
                      <td className="px-4 py-2.5">{formatBRL(a.revenue)}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-24 rounded-full bg-slate-100">
                            <div
                              className="h-2 rounded-full bg-indigo-500"
                              style={{ width: `${Math.round((a.revenue / a.totalRevenue) * 100)}%` }}
                            />
                          </div>
                          {Math.round((a.revenue / a.totalRevenue) * 100)}%
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {tab === "Ligações" && (
          <>
            <div className="mb-4 grid gap-3 md:grid-cols-3">
              <KpiCard label="Chamadas hoje" value="14" delta={16.7} />
              <KpiCard label="Duração média" value="4m 51s" />
              <KpiCard label="Taxa de atendimento" value="82%" delta={3.2} />
            </div>
            <div className="rounded-xl border bg-white">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b text-[11px] text-slate-400">
                    {["Contato", "Direção", "Duração", "Atendente", "Data"].map((h) => (
                      <th key={h} className="px-4 py-2.5 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {CALLS.map((c, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="px-4 py-2.5 font-medium text-slate-800">
                        {contacts[i] ? contactName(contacts[i]) : "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge variant="secondary" className={cn(c.direction === "Recebida" && "bg-indigo-100 text-indigo-700")}>
                          {c.direction}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5">{c.duration}</td>
                      <td className="px-4 py-2.5 text-slate-500">{c.user}</td>
                      <td className="px-4 py-2.5 text-slate-500">{c.date}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {tab === "Agentes" && (
          <>
            <h1 className="mb-1 text-lg font-bold text-slate-900">Desempenho por agente</h1>
            <p className="mb-4 text-xs text-slate-500">Produtividade da equipe no período</p>
            <div className="rounded-xl border bg-white">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b text-[11px] text-slate-400">
                    {["Usuário", "Conversas atendidas", "Tempo médio de resposta", "Oportunidades ganhas", "Receita"].map((h) => (
                      <th key={h} className="px-4 py-2.5 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {users.map((u, i) => {
                    const s = AGENT_STATS[i % AGENT_STATS.length];
                    return (
                      <tr key={u.id} className="border-b last:border-0">
                        <td className="px-4 py-2.5 font-medium text-slate-800">{u.name}</td>
                        <td className="px-4 py-2.5">{s.convs}</td>
                        <td className="px-4 py-2.5">{s.avg}</td>
                        <td className="px-4 py-2.5 text-emerald-600">{s.won}</td>
                        <td className="px-4 py-2.5">{formatBRL(s.revenue)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {tab === "Compromissos" && (
          <>
            <div className="mb-4 grid gap-3 md:grid-cols-3">
              <KpiCard label="Agendados no mês" value="46" delta={9.5} />
              <KpiCard label="Comparecimento" value="78%" delta={2.4} />
              <KpiCard label="No-show" value="12%" delta={-1.8} />
            </div>
            <div className="rounded-xl border bg-white">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b text-[11px] text-slate-400">
                    {["Contato", "Título", "Data", "Status"].map((h) => (
                      <th key={h} className="px-4 py-2.5 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {APPOINTMENT_ROWS.map((a, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="px-4 py-2.5 font-medium text-slate-800">
                        {contacts[i + 5] ? contactName(contacts[i + 5]) : "—"}
                      </td>
                      <td className="px-4 py-2.5">{a.title}</td>
                      <td className="px-4 py-2.5 text-slate-500">{a.date}</td>
                      <td className="px-4 py-2.5"><StatusBadge value={a.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
