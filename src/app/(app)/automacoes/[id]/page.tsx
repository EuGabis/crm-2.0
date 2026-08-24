"use client";

import { use, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Bot,
  Flag,
  GitBranch,
  Megaphone,
  MessageCircle,
  Plus,
  User,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { NodePicker } from "@/components/automations/node-picker";
import type { CatalogNode } from "@/components/automations/node-catalog";
import { useDbWorkflow, workflowDbActions } from "@/lib/data/repos/db/workflows";
import type { NodeCategory, WorkflowNode } from "@/lib/data/types";

const CATEGORY_ICON: Record<NodeCategory, typeof Zap> = {
  contato: User,
  oportunidade: Flag,
  comunicacao: MessageCircle,
  logica: GitBranch,
  ia: Bot,
  marketing: Megaphone,
};

let nodeSeq = 5000;

function NodeCard({
  node,
  onRemove,
  isTrigger,
}: {
  node: WorkflowNode;
  onRemove: () => void;
  isTrigger?: boolean;
}) {
  const Icon = CATEGORY_ICON[node.category];
  return (
    <div
      className={`group relative w-72 rounded-xl border-2 bg-white p-3 shadow-sm ${
        isTrigger ? "border-indigo-300" : "border-slate-200"
      }`}
    >
      <div className="flex items-center gap-2.5">
        <span
          className={`flex size-8 items-center justify-center rounded-lg ${
            isTrigger ? "bg-indigo-100 text-indigo-600" : "bg-slate-100 text-slate-600"
          }`}
        >
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
            {isTrigger ? "Acionador" : "Ação"}
          </p>
          <p className="truncate text-xs font-semibold text-slate-800">{node.label}</p>
        </div>
      </div>
      <button
        onClick={onRemove}
        className="absolute -right-2 -top-2 hidden size-5 items-center justify-center rounded-full bg-red-500 text-white group-hover:flex"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}

function Connector({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center">
      <div className="h-4 w-px bg-slate-300" />
      <button
        onClick={onAdd}
        className="flex size-6 items-center justify-center rounded-full border-2 border-slate-300 bg-white text-slate-400 hover:border-indigo-400 hover:text-indigo-500"
      >
        <Plus className="size-3.5" />
      </button>
      <div className="h-4 w-px bg-slate-300" />
    </div>
  );
}

export default function WorkflowBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { workflow, loading } = useDbWorkflow(id);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerMode, setPickerMode] = useState<"trigger" | "action">("trigger");

  if (loading) {
    return <div className="p-6 text-sm text-slate-500">Carregando fluxo…</div>;
  }

  if (!workflow) {
    return (
      <div className="p-6">
        <p className="text-sm text-slate-500">Fluxo não encontrado.</p>
        <Link href="/automacoes" className="text-sm text-indigo-600 hover:underline">
          Voltar para automações
        </Link>
      </div>
    );
  }

  const openPicker = (mode: "trigger" | "action") => {
    setPickerMode(mode);
    setPickerOpen(true);
  };

  const onPick = async (node: CatalogNode, kind: "trigger" | "action") => {
    const wfNode: WorkflowNode = {
      id: `n-${nodeSeq++}`,
      kind,
      key: node.key,
      label: node.label,
      category: node.category,
    };
    const ok =
      kind === "trigger"
        ? await workflowDbActions.setTrigger(id, wfNode)
        : await workflowDbActions.addAction(id, wfNode);
    if (!ok) {
      toast.error("Não foi possível salvar o fluxo");
      return;
    }
    toast.success(
      kind === "trigger" ? `Acionador "${node.label}" definido` : `Ação "${node.label}" adicionada`
    );
  };

  const removeNode = async (nodeId: string) => {
    const ok = await workflowDbActions.removeNode(id, nodeId);
    if (!ok) toast.error("Não foi possível remover o nó");
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b bg-white px-4 py-2">
        <div className="flex items-center gap-3">
          <Link
            href="/automacoes"
            className="flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800"
          >
            <ArrowLeft className="size-3.5" /> Fluxos
          </Link>
          <h1 className="text-sm font-bold text-slate-900">{workflow.name}</h1>
          <Badge variant="secondary" className="text-[10px]">
            Salvo
          </Badge>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => toast.info("Teste de fluxo chega com o backend")}
            className="text-xs font-medium text-indigo-600 hover:underline"
          >
            Testar fluxo
          </button>
          <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
            {workflow.status === "published" ? "Publicado" : "Rascunho"}
            <Switch
              checked={workflow.status === "published"}
              onCheckedChange={async () => {
                const ok = await workflowDbActions.toggleStatus(id);
                if (!ok) {
                  toast.error("Não foi possível atualizar o status");
                  return;
                }
                toast.success(
                  workflow.status === "published"
                    ? "Fluxo despublicado (rascunho)"
                    : "Fluxo publicado"
                );
              }}
            />
          </label>
        </div>
      </div>

      <div
        className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto py-10 [scrollbar-width:thin]"
        style={{
          backgroundImage: "radial-gradient(circle, #cbd5e1 1px, transparent 1px)",
          backgroundSize: "20px 20px",
        }}
      >
        {workflow.trigger ? (
          <NodeCard
            node={workflow.trigger}
            isTrigger
            onRemove={() => removeNode(workflow.trigger!.id)}
          />
        ) : (
          <button
            onClick={() => openPicker("trigger")}
            className="flex w-72 items-center justify-center gap-2 rounded-xl border-2 border-dashed border-indigo-300 bg-white/70 p-4 text-xs font-semibold text-indigo-600 hover:bg-indigo-50"
          >
            <Plus className="size-4" /> Adicionar novo acionador
          </button>
        )}

        {workflow.actions.map((action) => (
          <div key={action.id} className="flex flex-col items-center">
            <Connector onAdd={() => openPicker("action")} />
            <NodeCard node={action} onRemove={() => removeNode(action.id)} />
          </div>
        ))}

        <Connector onAdd={() => openPicker("action")} />
        <div className="flex w-40 items-center justify-center rounded-full border-2 border-slate-300 bg-white py-2 text-xs font-bold text-slate-500">
          FIM
        </div>
      </div>

      <NodePicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        mode={pickerMode}
        onPick={onPick}
      />
    </div>
  );
}
