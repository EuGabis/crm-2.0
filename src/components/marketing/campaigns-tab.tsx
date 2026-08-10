"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useDbCampaigns } from "@/lib/data/repos/db/campaigns";
import type { Campaign } from "@/lib/marketing/types";
import { CampaignComposer } from "./campaign-composer";
import { CampaignDetail } from "./campaign-detail";
import { cn } from "@/lib/utils";

type View = { kind: "list" } | { kind: "composer"; id: string | null } | { kind: "detail"; id: string };

const STATUS_LABEL: Record<Campaign["status"], string> = {
  draft: "Rascunho",
  scheduled: "Agendada",
  sending: "Enviando",
  sent: "Enviada",
  paused: "Pausada",
  failed: "Falhou",
};

function pct(part: number, whole: number): string {
  if (!whole) return "—";
  return `${((part / whole) * 100).toFixed(1)}%`;
}

export function CampaignsTab() {
  const { campaigns, loading } = useDbCampaigns();
  const [view, setView] = useState<View>({ kind: "list" });

  if (view.kind === "composer") {
    return (
      <CampaignComposer
        campaignId={view.id}
        onClose={() => setView({ kind: "list" })}
        onSaved={(id) => setView({ kind: "detail", id })}
      />
    );
  }
  if (view.kind === "detail") {
    return <CampaignDetail campaignId={view.id} onBack={() => setView({ kind: "list" })} />;
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-bold text-slate-900">Campanhas de e-mail</h1>
        <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setView({ kind: "composer", id: null })}>
          <Plus className="size-3.5" /> Nova campanha
        </Button>
      </div>

      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b text-[11px] text-slate-400">
              <th className="px-4 py-2.5 font-medium">Nome</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium">Destinatários</th>
              <th className="px-4 py-2.5 font-medium">Abertura</th>
              <th className="px-4 py-2.5 font-medium">Cliques</th>
              <th className="px-4 py-2.5 font-medium">Criada</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((c) => (
              <tr
                key={c.id}
                onClick={() =>
                  setView(c.status === "draft" ? { kind: "composer", id: c.id } : { kind: "detail", id: c.id })
                }
                className="cursor-pointer border-b last:border-0 hover:bg-slate-50"
              >
                <td className="px-4 py-2.5 font-medium text-slate-800">{c.name}</td>
                <td className="px-4 py-2.5">
                  <Badge variant="secondary" className={cn(c.status === "sent" && "bg-emerald-100 text-emerald-700")}>
                    {STATUS_LABEL[c.status]}
                  </Badge>
                </td>
                <td className="px-4 py-2.5 text-slate-500">{c.total.toLocaleString("pt-BR")}</td>
                <td className="px-4 py-2.5 text-slate-500">{pct(c.opened, c.sent)}</td>
                <td className="px-4 py-2.5 text-slate-500">{pct(c.clicked, c.sent)}</td>
                <td className="px-4 py-2.5 text-slate-500">
                  {c.createdAt ? new Date(c.createdAt).toLocaleDateString("pt-BR") : "—"}
                </td>
              </tr>
            ))}
            {!loading && campaigns.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                  Nenhuma campanha ainda. Clique em “Nova campanha” para começar.
                </td>
              </tr>
            )}
            {loading && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                  Carregando…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
