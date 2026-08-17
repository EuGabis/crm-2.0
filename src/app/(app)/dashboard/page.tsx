"use client";

import { useMemo, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CustomizeDialog } from "@/components/dashboard/customize-dialog";
import { DashboardSwitcher } from "@/components/dashboard/dashboard-switcher";
import { DateFilter } from "@/components/dashboard/date-filter";
import { DashboardRangeHint, DashboardRangeProvider } from "@/components/dashboard/date-range";
import { KpiStrip } from "@/components/dashboard/kpi-strip";
import { DashboardWidget } from "@/components/dashboard/widget-renderer";
import {
  DEFAULT_WIDGETS,
  widgetMeta,
  type WidgetConfig,
} from "@/components/dashboard/widget-catalog";
import { dashboardActions, useDashboardViews } from "@/lib/data/repos/db/dashboards";
import { useMyMembership } from "@/lib/data/repos/db/team";

export default function DashboardPage() {
  const { views } = useDashboardViews();
  const { isAdmin, can } = useMyMembership();
  // `null` = ninguém escolheu ainda nesta visita; o painel padrão manda.
  // Guardar a escolha num objeto (e não só o id) distingue "não escolhi" de
  // "escolhi a Visão Geral", que também é `null`.
  const [chosen, setChosen] = useState<{ id: string | null } | null>(null);
  const [customizeOpen, setCustomizeOpen] = useState(false);

  // Painel que abre sozinho: o padrão do usuário ganha do padrão do
  // departamento — quem personalizou o próprio espera ver o próprio.
  const defaultView =
    views.find((v) => v.scope === "user" && v.isDefault) ??
    views.find((v) => v.scope === "department" && v.isDefault) ??
    null;
  const activeId = chosen ? chosen.id : (defaultView?.id ?? null);

  const active = views.find((v) => v.id === activeId) ?? null;
  const readOnly = !!active && active.scope === "department" && !isAdmin;

  // Widget de módulo bloqueado nunca é desenhado, mesmo se estiver salvo na
  // visualização: um painel de departamento pode incluir Pagamentos e ser
  // aberto por quem não tem esse acesso. A RLS das tabelas da Guru já
  // devolveria vazio, mas mostrar um card vazio seria confuso.
  const widgets = useMemo(() => {
    const list: WidgetConfig[] = active ? active.widgets : DEFAULT_WIDGETS;
    return list.filter((w) => {
      const meta = widgetMeta(w.key);
      if (!meta) return false;
      return !meta.requires || can(meta.requires);
    });
  }, [active, can]);

  const saveWidgets = async (next: WidgetConfig[]) => {
    if (!active) {
      // Sem visualização salva ainda: personalizar cria a primeira, com o que
      // a pessoa acabou de escolher.
      const view = await dashboardActions.create("Meu painel", next);
      if (!view) {
        toast.error("Não foi possível salvar o painel");
        return;
      }
      setChosen({ id: view.id });
      toast.success("Painel salvo");
      return;
    }
    if (await dashboardActions.setWidgets(active.id, next)) {
      toast.success("Painel salvo");
    } else {
      toast.error("Não foi possível salvar — sem permissão para editar este painel");
    }
  };

  // Só existe handler quando há onde gravar. Sem ele, o seletor do widget
  // volta a ser local (ver `usePipelineSelection`): no layout de fábrica e no
  // painel do departamento a troca vale para a visita, sem persistir.
  const canPersist = !!active && !readOnly;
  const changePipeline = (index: number, pipelineId: string) => {
    if (!active) return;
    // O índice vem da lista JÁ filtrada por permissão; casa pela chave para
    // não gravar no widget errado quando algum foi escondido.
    const key = widgets[index]?.key;
    const next = active.widgets.map((w) => (w.key === key ? { ...w, pipelineId } : w));
    void dashboardActions.setWidgets(active.id, next);
  };

  return (
    <DashboardRangeProvider>
      <div className="p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <DashboardSwitcher
            views={views}
            activeId={activeId}
            onSelect={(id) => setChosen({ id })}
          />
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => setCustomizeOpen(true)}
            >
              <SlidersHorizontal className="size-3.5" /> Personalizar
            </Button>
            <DateFilter />
          </div>
        </div>
        <DashboardRangeHint />
        {/* Resumo em números antes dos gráficos: gráfico responde "como está
            distribuído", nunca "como estamos". */}
        <KpiStrip />
        {readOnly && (
          <p className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
            Painel do departamento — montado por um administrador. Para ter um seu, use
            “Adicionar painel”.
          </p>
        )}
        {/* items-stretch + h-full nos cards: sem isso, cards da mesma linha
            ficavam com alturas diferentes conforme o gráfico de dentro. */}
        <div className="grid items-stretch gap-3 md:grid-cols-6">
          {widgets.map((w, i) => (
            <DashboardWidget
              key={`${w.key}-${i}`}
              config={w}
              onPipelineChange={
                canPersist ? (pipelineId) => changePipeline(i, pipelineId) : undefined
              }
            />
          ))}
        </div>
        {widgets.length === 0 && (
          <p className="rounded-xl border bg-white p-8 text-center text-xs text-slate-400">
            Este painel está sem widgets. Use “Personalizar” para escolher o que aparece.
          </p>
        )}
      </div>
      <CustomizeDialog
        open={customizeOpen}
        onOpenChange={setCustomizeOpen}
        widgets={active ? active.widgets : DEFAULT_WIDGETS}
        onSave={saveWidgets}
        readOnly={readOnly}
        readOnlyReason="Este painel é do departamento — só administradores editam."
      />
    </DashboardRangeProvider>
  );
}
