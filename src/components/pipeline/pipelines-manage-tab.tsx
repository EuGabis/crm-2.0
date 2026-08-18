"use client";

import { useState } from "react";
import { Pencil, Plus, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { pipelineActions, usePipelineDb } from "@/lib/data/repos/db/pipeline";
import { useDbTeam } from "@/lib/data/repos/db/contacts";
import { useDepartments, useMyMembership } from "@/lib/data/repos/db/team";
import { PipelineScopeDialog, scopeBadge } from "./pipeline-scope-dialog";

import { useConfirm } from "@/components/shared/confirm";
const STAGE_COLORS = ["#94a3b8", "#3b82f6", "#f43f5e", "#f59e0b", "#ec4899", "#22c55e", "#64748b", "#ef4444", "#8b5cf6"];

export function PipelinesManageTab() {
  const confirm = useConfirm();
  const { pipelines, opportunities, loaded } = usePipelineDb();
  const { isAdmin, me } = useMyMembership();
  const departments = useDepartments();
  const team = useDbTeam();
  const [scopeDialog, setScopeDialog] = useState<"new" | string | null>(null);
  const [stageDialogFor, setStageDialogFor] = useState<string | null>(null);
  const [stageName, setStageName] = useState("");
  const [stageColor, setStageColor] = useState(STAGE_COLORS[0]);
  const [saving, setSaving] = useState(false);

  const countFor = (stageId: string) => opportunities.filter((o) => o.stageId === stageId).length;

  const renamePipeline = async (id: string, current: string) => {
    const name = window.prompt("Novo nome do pipeline:", current);
    if (!name?.trim() || name.trim() === current) return;
    (await pipelineActions.renamePipeline(id, name.trim()))
      ? toast.success("Pipeline renomeado")
      : toast.error("Não foi possível renomear");
  };

  const removePipeline = async (id: string, name: string) => {
    if (!(await confirm({ title: `Excluir o pipeline "${name}"?`, confirmLabel: "Excluir", destructive: true }))) return;
    const result = await pipelineActions.removePipeline(id);
    if (result === "ok") toast.success("Pipeline excluído");
    else if (result === "has-opps")
      toast.error("Este pipeline tem oportunidades — mova ou exclua os leads antes");
    else toast.error("Não foi possível excluir");
  };

  const renameStage = async (id: string, current: string) => {
    const name = window.prompt("Novo nome da fase:", current);
    if (!name?.trim() || name.trim() === current) return;
    (await pipelineActions.renameStage(id, name.trim()))
      ? toast.success("Fase renomeada")
      : toast.error("Não foi possível renomear");
  };

  const removeStage = async (id: string, name: string) => {
    if (!(await confirm({ title: `Excluir a fase "${name}"?`, confirmLabel: "Excluir", destructive: true }))) return;
    const result = await pipelineActions.removeStage(id);
    if (result === "ok") toast.success("Fase excluída");
    else if (result === "has-opps")
      toast.error("Esta fase tem oportunidades — mova os leads antes de excluir");
    else toast.error("Não foi possível excluir");
  };

  const addStage = async () => {
    if (!stageDialogFor || !stageName.trim()) {
      toast.error("Dê um nome à fase");
      return;
    }
    setSaving(true);
    const ok = await pipelineActions.addStage(stageDialogFor, stageName.trim(), stageColor);
    setSaving(false);
    if (!ok) {
      toast.error("Não foi possível criar a fase");
      return;
    }
    toast.success(`Fase "${stageName.trim()}" criada`);
    setStageName("");
    setStageDialogFor(null);
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Pipelines</h1>
          <p className="text-xs text-slate-500">
            Crie e organize os funis e as fases do seu processo comercial.
            {isAdmin
              ? " Como administrador, você escolhe se o funil é da empresa, de um departamento ou de uma pessoa."
              : " Os funis que você criar ficam só para você."}
          </p>
        </div>
        <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setScopeDialog("new")}>
          <Plus className="size-3.5" /> Novo pipeline
        </Button>
      </div>

      {loaded && pipelines.length === 0 && (
        <p className="text-sm text-slate-500">Nenhum pipeline ainda — crie o primeiro.</p>
      )}

      <div className="space-y-4">
        {pipelines.map((p) => (
          <div key={p.id} className="rounded-xl border bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-slate-800">{p.name}</p>
                <Badge variant="secondary" className="text-[10px]">
                  {p.stages.length} fases
                </Badge>
                {(() => {
                  const badge = scopeBadge(p, departments, team);
                  return (
                    <Badge variant="secondary" className={`text-[10px] ${badge.className}`}>
                      {badge.label}
                    </Badge>
                  );
                })()}
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 text-xs"
                  onClick={() => renamePipeline(p.id, p.name)}
                >
                  <Pencil className="size-3" /> Renomear
                </Button>
                {isAdmin && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 text-xs"
                    onClick={() => setScopeDialog(p.id)}
                  >
                    <Users className="size-3" /> Quem vê
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 text-xs text-red-500 hover:text-red-600"
                  onClick={() => removePipeline(p.id, p.name)}
                >
                  <Trash2 className="size-3" /> Excluir
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {p.stages
                .slice()
                .sort((a, b) => a.order - b.order)
                .map((s) => (
                  <span
                    key={s.id}
                    className="group flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold text-white"
                    style={{ background: s.color }}
                  >
                    {s.name}
                    <span className="rounded-full bg-black/20 px-1">{countFor(s.id)}</span>
                    <button
                      onClick={() => renameStage(s.id, s.name)}
                      className="hidden group-hover:inline"
                      title="Renomear fase"
                    >
                      <Pencil className="size-2.5" />
                    </button>
                    <button
                      onClick={() => removeStage(s.id, s.name)}
                      className="hidden group-hover:inline"
                      title="Excluir fase"
                    >
                      <Trash2 className="size-2.5" />
                    </button>
                  </span>
                ))}
              <button
                onClick={() => setStageDialogFor(p.id)}
                className="flex items-center gap-1 rounded-full border border-dashed px-2.5 py-1 text-[10px] font-semibold text-slate-500 hover:border-indigo-300 hover:text-indigo-600"
              >
                <Plus className="size-3" /> Nova fase
              </button>
            </div>
          </div>
        ))}
      </div>

      <PipelineScopeDialog
        open={!!scopeDialog}
        mode={scopeDialog === "new" ? "create" : "edit"}
        pipeline={
          scopeDialog && scopeDialog !== "new"
            ? (pipelines.find((p) => p.id === scopeDialog) ?? null)
            : null
        }
        isAdmin={isAdmin}
        myUserId={me?.userId ?? null}
        departments={departments}
        team={team}
        onOpenChange={(o) => !o && setScopeDialog(null)}
      />

      <Dialog open={!!stageDialogFor} onOpenChange={(o) => !o && setStageDialogFor(null)}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>Nova fase</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Nome da fase</Label>
              <Input
                value={stageName}
                onChange={(e) => setStageName(e.target.value)}
                placeholder="Ex.: PROPOSTA ENVIADA"
                className="h-8"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Cor</Label>
              <div className="flex flex-wrap gap-1.5">
                {STAGE_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setStageColor(c)}
                    className={`size-6 rounded-full ${stageColor === c ? "ring-2 ring-slate-900 ring-offset-2" : ""}`}
                    style={{ background: c }}
                  />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setStageDialogFor(null)}>
              Cancelar
            </Button>
            <Button onClick={addStage} disabled={saving}>
              {saving ? "Criando..." : "Criar fase"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
