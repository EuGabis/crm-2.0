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
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { NodePicker } from "@/components/automations/node-picker";
import type { CatalogNode } from "@/components/automations/node-catalog";
import {
  useDbWorkflow,
  dbWorkflowActions,
  EXECUTABLE_ACTIONS,
} from "@/lib/data/repos/db/workflows";
import { useWhatsappChannels } from "@/lib/data/repos/db/whatsapp";
import type { NodeCategory, WorkflowNode } from "@/lib/data/types";

/** Gatilhos que operam sobre mensagens de WhatsApp — podem escolher o número. */
const CHANNEL_TRIGGERS = new Set(["cliente-respondeu"]);

/** Campos de configuração por ação (o que o executor lê em `steps[].config`). */
const CONFIG_FIELDS: Record<
  string,
  { name: string; label: string; type: "text" | "textarea" | "number"; placeholder?: string }[]
> = {
  "enviar-whatsapp": [{ name: "message", label: "Mensagem", type: "textarea", placeholder: "Ex.: Oi {{nome}}! Recebemos sua mensagem, já te respondemos 😊" }],
  "nota-interna": [{ name: "body", label: "Texto da nota", type: "textarea", placeholder: "Ex.: Cliente respondeu — dar atenção" }],
  "adicionar-tag": [{ name: "tag", label: "Tag", type: "text", placeholder: "Ex.: respondeu" }],
  "remover-tag": [{ name: "tag", label: "Tag", type: "text", placeholder: "Ex.: frio" }],
  "adicionar-tarefa": [
    { name: "title", label: "Título da tarefa", type: "text", placeholder: "Ex.: Ligar para {{nome}}" },
    { name: "dueInDays", label: "Vence em (dias)", type: "number", placeholder: "1" },
  ],
  "enviar-email": [
    { name: "subject", label: "Assunto", type: "text", placeholder: "Ex.: Obrigado, {{nome}}!" },
    { name: "body", label: "Corpo", type: "textarea", placeholder: "Escreva o e-mail..." },
  ],
  "atualizar-campo": [
    { name: "field", label: "Campo", type: "text", placeholder: "nome do campo" },
    { name: "value", label: "Valor", type: "text", placeholder: "novo valor" },
  ],
  esperar: [
    { name: "days", label: "Dias", type: "number", placeholder: "0" },
    { name: "hours", label: "Horas", type: "number", placeholder: "0" },
    { name: "minutes", label: "Minutos", type: "number", placeholder: "0" },
  ],
  webhook: [{ name: "url", label: "URL do webhook", type: "text", placeholder: "https://..." }],
};

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
  onSaveConfig,
  isTrigger,
  channels,
}: {
  node: WorkflowNode;
  onRemove: () => void;
  onSaveConfig?: (config: Record<string, unknown>) => void;
  isTrigger?: boolean;
  channels?: { id: string; name: string; phoneE164?: string | null }[];
}) {
  const Icon = CATEGORY_ICON[node.category];
  const showChannel = isTrigger && CHANNEL_TRIGGERS.has(node.key);
  const fields = !isTrigger ? CONFIG_FIELDS[node.key] : undefined;
  const [cfg, setCfg] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of fields ?? []) {
      const v = (node.config ?? {})[f.name];
      init[f.name] = v == null ? "" : String(v);
    }
    return init;
  });
  // Ação sem equivalente no motor ainda (ex.: split test, agente IA).
  const notExecutable = !isTrigger && !EXECUTABLE_ACTIONS.has(node.key);

  const saveField = (name: string) => {
    if (!onSaveConfig) return;
    onSaveConfig({ ...(node.config ?? {}), ...cfg, [name]: cfg[name] });
  };

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

      {showChannel && (
        <div className="mt-3 border-t pt-3">
          <span className="mb-0.5 block text-[10px] font-medium text-slate-500">
            Número do WhatsApp
          </span>
          <select
            value={String((node.config ?? {}).channelId ?? "")}
            onChange={(e) => onSaveConfig?.({ ...(node.config ?? {}), channelId: e.target.value })}
            className="w-full rounded-md border px-2 py-1 text-xs outline-none focus:border-indigo-400"
          >
            <option value="">Todos os números</option>
            {(channels ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.phoneE164 ? ` · ${c.phoneE164}` : ""}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[10px] text-slate-400">
            O fluxo só dispara para mensagens deste número.
          </p>
        </div>
      )}

      {fields && (
        <div className="mt-3 space-y-2 border-t pt-3">
          {fields.map((f) => (
            <label key={f.name} className="block">
              <span className="mb-0.5 block text-[10px] font-medium text-slate-500">{f.label}</span>
              {f.type === "textarea" ? (
                <textarea
                  value={cfg[f.name] ?? ""}
                  onChange={(e) => setCfg((c) => ({ ...c, [f.name]: e.target.value }))}
                  onBlur={() => saveField(f.name)}
                  placeholder={f.placeholder}
                  rows={2}
                  className="w-full resize-none rounded-md border px-2 py-1 text-xs outline-none focus:border-indigo-400"
                />
              ) : (
                <Input
                  type={f.type === "number" ? "number" : "text"}
                  value={cfg[f.name] ?? ""}
                  onChange={(e) => setCfg((c) => ({ ...c, [f.name]: e.target.value }))}
                  onBlur={() => saveField(f.name)}
                  placeholder={f.placeholder}
                  className="h-7 text-xs"
                />
              )}
            </label>
          ))}
        </div>
      )}

      {notExecutable && (
        <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-[10px] text-amber-700">
          Esta ação ainda não é executada pelo motor — será ignorada ao rodar.
        </p>
      )}

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
  const workflow = useDbWorkflow(id);
  const { channels } = useWhatsappChannels();
  const activeChannels = channels.filter((c) => c.active);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerMode, setPickerMode] = useState<"trigger" | "action">("trigger");

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

  const onPick = (node: CatalogNode, kind: "trigger" | "action") => {
    const wfNode: WorkflowNode = {
      id: `n-${nodeSeq++}`,
      kind,
      key: node.key,
      label: node.label,
      category: node.category,
      config: {},
    };
    if (kind === "trigger") {
      void dbWorkflowActions.setTrigger(id, wfNode);
      toast.success(`Acionador "${node.label}" definido`);
    } else {
      void dbWorkflowActions.addAction(id, wfNode);
      toast.success(`Ação "${node.label}" adicionada`);
    }
  };

  const togglePublish = () => {
    if (workflow.status !== "published") {
      if (!workflow.trigger) {
        toast.error("Defina um acionador antes de publicar");
        return;
      }
      if (workflow.actions.length === 0) {
        toast.error("Adicione ao menos uma ação antes de publicar");
        return;
      }
    }
    void dbWorkflowActions.toggleStatus(id);
    toast.success(
      workflow.status === "published" ? "Fluxo despublicado (rascunho)" : "Fluxo publicado",
    );
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
            <Switch checked={workflow.status === "published"} onCheckedChange={togglePublish} />
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
            channels={activeChannels}
            onRemove={() => void dbWorkflowActions.removeNode(id, workflow.trigger!.id)}
            onSaveConfig={(config) =>
              void dbWorkflowActions.updateNodeConfig(id, workflow.trigger!.id, config)
            }
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
            <NodeCard
              node={action}
              onRemove={() => void dbWorkflowActions.removeNode(id, action.id)}
              onSaveConfig={(config) => void dbWorkflowActions.updateNodeConfig(id, action.id, config)}
            />
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
