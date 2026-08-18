"use client";

import { useState } from "react";
import { Building2, ChevronDown, LayoutGrid, Pin, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { dashboardActions, type DashboardView } from "@/lib/data/repos/db/dashboards";
import { useDepartments, useMyMembership } from "@/lib/data/repos/db/team";
import { DEFAULT_WIDGETS } from "./widget-catalog";
import { cn } from "@/lib/utils";

import { useConfirm } from "@/components/shared/confirm";
/**
 * Seletor de painéis. Antes eram três nomes fixos no código e um "Adicionar
 * painel" que só emitia toast; agora lista os painéis reais
 * (`dashboard_views`, migração 0037), separados por escopo:
 *
 *   * Meus painéis — pessoais, cada um mexe no seu.
 *   * Do departamento — montados pelo admin; quem é do departamento só lê.
 *
 * Some o grupo "Compartilhado comigo" que existia: não havia compartilhamento
 * nenhum por trás dele.
 */
export function DashboardSwitcher({
  views,
  activeId,
  onSelect,
}: {
  views: DashboardView[];
  activeId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const confirm = useConfirm();
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const { isAdmin } = useMyMembership();
  const departments = useDepartments();

  const mine = views.filter((v) => v.scope === "user");
  const dept = views.filter((v) => v.scope === "department");
  const active = views.find((v) => v.id === activeId) ?? null;
  const match = (v: DashboardView) => v.name.toLowerCase().includes(query.toLowerCase());

  const departmentName = (id: string | null) =>
    departments.find((d) => d.id === id)?.name ?? "Departamento";

  const row = (v: DashboardView, suffix?: string) => (
    <div
      key={v.id}
      className={cn(
        "group flex items-center gap-1 rounded-md px-2 py-1.5 hover:bg-slate-50",
        v.id === activeId && "bg-indigo-50"
      )}
    >
      <button
        onClick={() => onSelect(v.id)}
        className="min-w-0 flex-1 truncate text-left text-xs text-slate-700"
      >
        {v.name}
        {suffix && <span className="ml-1 text-[10px] text-slate-400">· {suffix}</span>}
      </button>
      <button
        onClick={async () => {
          if (await dashboardActions.setDefault(v.id)) {
            toast.success(`"${v.name}" agora abre por padrão`);
          } else {
            toast.error("Não foi possível definir como padrão");
          }
        }}
        title={v.isDefault ? "Painel padrão" : "Definir como padrão"}
        className="shrink-0 p-0.5"
      >
        <Pin
          className={cn(
            "size-3",
            v.isDefault ? "fill-indigo-500 text-indigo-500" : "text-slate-300 hover:text-slate-500"
          )}
        />
      </button>
      {(v.scope === "user" || isAdmin) && (
        <button
          onClick={async () => {
            if (!(await confirm({ title: `Excluir o painel "${v.name}"?`, confirmLabel: "Excluir", destructive: true }))) return;
            const ok = await dashboardActions.remove(v.id);
            if (!ok) {
              toast.error("Não foi possível excluir");
              return;
            }
            if (v.id === activeId) onSelect(null);
            toast.success("Painel excluído");
          }}
          title="Excluir painel"
          className="shrink-0 p-0.5 text-slate-300 hover:text-red-500"
        >
          <Trash2 className="size-3" />
        </button>
      )}
    </div>
  );

  return (
    <>
      <Popover>
        <PopoverTrigger
          render={
            <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-sm font-bold" />
          }
        >
          <LayoutGrid className="size-4 text-indigo-500" />
          {active?.name ?? "(Padrão) Visão Geral"}
          <ChevronDown className="size-3.5 text-slate-400" />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 p-2">
          <div className="mb-2 flex items-center gap-2 rounded-md border px-2">
            <Search className="size-3.5 text-slate-400" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Pesquisar um painel"
              className="h-7 border-0 p-0 text-xs shadow-none focus-visible:ring-0"
            />
          </div>
          <button
            onClick={() => setCreateOpen(true)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs font-semibold text-indigo-600 hover:bg-indigo-50"
          >
            <Plus className="size-3.5" /> Adicionar painel
          </button>

          <p className="mt-2 px-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">
            Meus painéis de controle
          </p>
          <button
            onClick={() => onSelect(null)}
            className={cn(
              "flex w-full items-center rounded-md px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50",
              activeId === null && "bg-indigo-50"
            )}
          >
            (Padrão) Visão Geral
          </button>
          {mine.filter(match).map((v) => row(v))}

          {dept.length > 0 && (
            <>
              <p className="mt-2 px-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                Painéis de departamento
              </p>
              {dept.filter(match).map((v) => row(v, departmentName(v.departmentId)))}
            </>
          )}
          {isAdmin && dept.length === 0 && (
            <p className="mt-2 px-2 text-[10px] text-slate-400">
              Nenhum painel de departamento. Crie um em “Adicionar painel”.
            </p>
          )}
        </PopoverContent>
      </Popover>
      <CreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(id) => onSelect(id)}
      />
    </>
  );
}

function CreateDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const { isAdmin } = useMyMembership();
  const departments = useDepartments();
  const [name, setName] = useState("");
  const [target, setTarget] = useState("me");
  const [saving, setSaving] = useState(false);

  const create = async () => {
    setSaving(true);
    // Nasce com o layout padrão para o usuário editar em cima, em vez de
    // abrir um painel vazio e deixar ele adivinhar o que existe.
    const view = await dashboardActions.create(
      name,
      DEFAULT_WIDGETS,
      target === "me" ? null : target
    );
    setSaving(false);
    if (!view) {
      toast.error(
        target === "me"
          ? "Não foi possível criar o painel"
          : "Não foi possível criar — só administradores criam painel de departamento"
      );
      return;
    }
    toast.success(`Painel "${view.name}" criado — use "Personalizar" para ajustar`);
    setName("");
    setTarget("me");
    onCreated(view.id);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Novo painel</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Nome</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Funil Cibelle"
              className="h-8 text-xs"
            />
          </div>
          {isAdmin && departments.length > 0 && (
            <div className="space-y-1">
              <Label className="text-xs">Para quem</Label>
              <Select value={target} onValueChange={(v) => setTarget(v ?? "me")}>
                <SelectTrigger className="h-8 w-full text-xs">
                  <SelectValue>
                    {target === "me"
                      ? "Só para mim"
                      : (departments.find((d) => d.id === target)?.name ?? "Departamento")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="me" className="text-xs">
                    Só para mim
                  </SelectItem>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id} className="text-xs">
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="flex items-start gap-1 text-[10px] text-slate-400">
                <Building2 className="mt-0.5 size-3 shrink-0" />
                Painel de departamento aparece para todo mundo daquele departamento; só
                administradores podem editar.
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={create} disabled={saving}>
            {saving ? "Criando..." : "Criar painel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
