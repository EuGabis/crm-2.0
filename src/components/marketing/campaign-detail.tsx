"use client";

import { ArrowLeft, Pause } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { KpiCard } from "@/components/shared/kpi-card";
import {
  campaignActions,
  useCampaignRecipients,
  useDbCampaign,
} from "@/lib/data/repos/db/campaigns";
import type { RecipientStatus } from "@/lib/marketing/types";
import { cn } from "@/lib/utils";

const RECIPIENT_LABEL: Record<RecipientStatus, string> = {
  pending: "Pendente",
  sent: "Enviado",
  delivered: "Entregue",
  opened: "Aberto",
  clicked: "Clicou",
  bounced: "Rejeitado",
  failed: "Falhou",
  skipped: "Ignorado",
};

function pct(part: number, whole: number): string {
  if (!whole) return "—";
  return `${((part / whole) * 100).toFixed(1)}%`;
}

function fmt(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function CampaignDetail({
  campaignId,
  onBack,
}: {
  campaignId: string;
  onBack: () => void;
}) {
  const campaign = useDbCampaign(campaignId);
  const { recipients, loading } = useCampaignRecipients(campaignId);

  if (!campaign) {
    return (
      <div>
        <Button variant="ghost" size="sm" className="mb-4 h-8 gap-1.5 text-xs" onClick={onBack}>
          <ArrowLeft className="size-3.5" /> Voltar
        </Button>
        <p className="text-xs text-slate-500">Campanha não encontrada.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={onBack}>
            <ArrowLeft className="size-3.5" /> Voltar
          </Button>
          <h1 className="text-lg font-bold text-slate-900">{campaign.name}</h1>
          <Badge variant="secondary" className={cn(campaign.status === "sent" && "bg-emerald-100 text-emerald-700")}>
            {campaign.status}
          </Badge>
        </div>
        {campaign.status === "sending" && (
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={async () => {
              const ok = await campaignActions.pause(campaign.id);
              toast[ok ? "success" : "error"](ok ? "Campanha pausada" : "Não foi possível pausar");
            }}
          >
            <Pause className="size-3.5" /> Pausar
          </Button>
        )}
      </div>

      <div className="mb-4 grid gap-3 md:grid-cols-3 lg:grid-cols-6">
        <KpiCard label="Destinatários" value={String(campaign.total)} />
        <KpiCard label="Enviados" value={String(campaign.sent)} />
        <KpiCard label="Entregues" value={String(campaign.delivered)} />
        <KpiCard label="Abertura" value={pct(campaign.opened, campaign.sent)} hint={`${campaign.opened} aberturas`} />
        <KpiCard label="Cliques" value={pct(campaign.clicked, campaign.sent)} hint={`${campaign.clicked} cliques`} />
        <KpiCard label="Descadastros" value={String(campaign.unsubscribed)} hint={`${campaign.bounced} bounces`} />
      </div>

      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b text-[11px] text-slate-400">
              <th className="px-4 py-2.5 font-medium">E-mail</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium">Enviado</th>
              <th className="px-4 py-2.5 font-medium">Aberto</th>
              <th className="px-4 py-2.5 font-medium">Clicou</th>
            </tr>
          </thead>
          <tbody>
            {recipients.map((r) => (
              <tr key={r.id} className="border-b last:border-0">
                <td className="px-4 py-2.5 font-medium text-slate-800">{r.email}</td>
                <td className="px-4 py-2.5">
                  <Badge
                    variant="secondary"
                    className={cn(
                      (r.status === "delivered" || r.status === "opened" || r.status === "clicked") &&
                        "bg-emerald-100 text-emerald-700",
                      (r.status === "bounced" || r.status === "failed") && "bg-rose-100 text-rose-700",
                    )}
                  >
                    {RECIPIENT_LABEL[r.status]}
                  </Badge>
                </td>
                <td className="px-4 py-2.5 text-slate-500">{fmt(r.sentAt)}</td>
                <td className="px-4 py-2.5 text-slate-500">{fmt(r.openedAt)}</td>
                <td className="px-4 py-2.5 text-slate-500">{fmt(r.clickedAt)}</td>
              </tr>
            ))}
            {!loading && recipients.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                  Nenhum destinatário ainda. Publique a campanha para materializar a fila.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
