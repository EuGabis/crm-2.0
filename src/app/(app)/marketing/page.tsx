"use client";

import { useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { SubNav } from "@/components/layout/subnav";
import { CampaignsTab } from "@/components/marketing/campaigns-tab";
import { TrechosTab } from "@/components/marketing/trechos-tab";
import { CountdownsTab } from "@/components/marketing/countdowns-tab";
import { BrandBoardsTab } from "@/components/marketing/brand-boards-tab";
import { KpiCard } from "@/components/shared/kpi-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/data/repos/opportunities";
import { cn } from "@/lib/utils";

const TABS = [
  { label: "E-mails" },
  { label: "Trechos" },
  { label: "Contadores regressivos" },
  { label: "Brand Boards" },
  { label: "Gerenciador de anúncios" },
];

// Gerenciador de anúncios ainda é mock (depende de integração com Meta/Google Ads).
const AD_CAMPAIGNS = [
  { name: "[Frio] Vídeo — Dor do follow-up", status: "Ativo", budget: 150, results: 214, cpl: 11.2 },
  { name: "[Frio] Carrossel — 5 sinais", status: "Ativo", budget: 100, results: 122, cpl: 15.8 },
  { name: "[Remarketing] Depoimentos", status: "Ativo", budget: 80, results: 96, cpl: 9.4 },
  { name: "[Teste] Oferta 70% OFF", status: "Pausado", results: 41, budget: 60, cpl: 21.3 },
];

const GOOD_STATUSES = ["Ativo", "Pago"];

function StatusBadge({ value }: { value: string }) {
  return (
    <Badge variant="secondary" className={cn(GOOD_STATUSES.includes(value) && "bg-emerald-100 text-emerald-700")}>
      {value}
    </Badge>
  );
}

function MiniTable({ headers, rows }: { headers: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-xl border bg-white">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b text-[11px] text-slate-400">
            {headers.map((h) => (
              <th key={h} className="whitespace-nowrap px-4 py-2.5 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, i) => (
            <tr key={i} className="border-b last:border-0">
              {cells.map((c, j) => (
                <td
                  key={j}
                  className={cn("px-4 py-2.5", j === 0 ? "font-medium text-slate-800" : "text-slate-500")}
                >
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function MarketingPage() {
  const [tab, setTab] = useState("E-mails");

  return (
    <div>
      <SubNav tabs={TABS} active={tab} onChange={setTab} />
      <div className="p-6">
        {tab === "E-mails" && <CampaignsTab />}
        {tab === "Trechos" && <TrechosTab />}
        {tab === "Contadores regressivos" && <CountdownsTab />}
        {tab === "Brand Boards" && <BrandBoardsTab />}
        {tab === "Gerenciador de anúncios" && (
          <>
            <div className="mb-4 flex items-center justify-between">
              <h1 className="text-lg font-bold text-slate-900">Gerenciador de anúncios</h1>
              <Button
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={() => toast.info("Integração com Meta/Google Ads chega em breve")}
              >
                <Plus className="size-3.5" /> Criar anúncio
              </Button>
            </div>
            <div className="mb-4 grid gap-3 md:grid-cols-4">
              <KpiCard label="Investimento" value={formatBRL(12480)} hint="Últimos 30 dias" />
              <KpiCard label="Impressões" value="842 mil" delta={12.7} />
              <KpiCard label="Cliques" value="18.940" delta={8.3} />
              <KpiCard label="CPL" value={formatBRL(13.1)} delta={-6.2} />
            </div>
            <MiniTable
              headers={["Campanha", "Status", "Orçamento/dia", "Resultados (leads)", "CPL"]}
              rows={AD_CAMPAIGNS.map((c) => [
                c.name,
                <StatusBadge key="s" value={c.status} />,
                formatBRL(c.budget),
                c.results,
                formatBRL(c.cpl),
              ])}
            />
          </>
        )}
      </div>
    </div>
  );
}
