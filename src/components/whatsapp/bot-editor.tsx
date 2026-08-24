"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, RotateCcw, Save, GripVertical } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useBotFlow } from "@/lib/data/repos/db/bot-flows";
import { useDbTeam } from "@/lib/data/repos/db/contacts";
import { normalize, type BotFlow, type BotNode, type BotOption } from "@/lib/bot/types";

/* eslint-disable @typescript-eslint/no-explicit-any */

const FLOW_KEY = "triagem";

/** Rótulo humano de cada tipo de nó pro editor. */
function nodeLabel(node: BotNode): string {
  switch (node.type) {
    case "message":
      return "Mensagem";
    case "ask":
      return node.options?.length ? "Pergunta com lista de opções" : "Pergunta (resposta livre)";
    case "set_name":
      return "Salva o nome do contato";
    case "set_contact":
      return "Salva um dado do contato";
    case "score":
      return "Qualificação (pontuação)";
    case "ensure_card":
      return "Cria o card do lead no funil";
    case "sync_card":
      return "Atualiza o card no funil";
    case "condition":
      return "Roteia conforme a qualificação";
    case "handoff":
      return node.to === "ia"
        ? "Encerramento — Agente de IA assume"
        : node.to === "usuario"
          ? "Encerramento — transfere para um atendente específico"
          : "Encerramento — distribui pro atendente (rodízio)";
    case "distribute":
      return "Encerramento — distribui por rodízio";
    case "end":
      return "Encerramento — envia mensagem e finaliza";
  }
}

export function BotEditor({
  flowKey = FLOW_KEY,
  onBack,
}: {
  flowKey?: string;
  onBack?: () => void;
} = {}) {
  const { flow, ready, saving, save, reset } = useBotFlow(flowKey);
  const [draft, setDraft] = useState<BotFlow | null>(null);

  // Sincroniza o rascunho local quando o fluxo carrega/salva/reseta.
  useEffect(() => {
    if (flow) setDraft(structuredClone(flow));
  }, [flow]);

  if (!ready || !draft) {
    return <p className="p-4 text-xs text-slate-500">Carregando o fluxo do bot…</p>;
  }

  const nodes = Object.values(draft.nodes);

  function patchNode(id: string, patch: Partial<any>) {
    setDraft((d) =>
      d ? { ...d, nodes: { ...d.nodes, [id]: { ...(d.nodes[id] as any), ...patch } } } : d,
    );
  }

  async function handleSave() {
    if (!draft) return;
    // Reconstrói os pesos a partir dos títulos atuais das opções (some com chaves órfãs).
    const clean = structuredClone(draft);
    for (const node of Object.values(clean.nodes)) {
      if (node.type === "score") {
        for (const [varKey, table] of Object.entries(node.weights)) {
          const ask = Object.values(clean.nodes).find(
            (n) => n.type === "ask" && (n as any).var === varKey,
          ) as any;
          if (!ask?.options?.length) continue;
          const rebuilt: Record<string, number> = {};
          for (const opt of ask.options) rebuilt[normalize(opt.title)] = table[normalize(opt.title)] ?? 0;
          node.weights[varKey] = rebuilt;
        }
      }
    }
    const res = await save(clean);
    if (res.ok) toast.success("Fluxo do bot salvo. Já vale nos próximos atendimentos.");
    else toast.error(res.error ?? "Não foi possível salvar");
  }

  function handleReset() {
    reset();
    toast.info("Voltou ao fluxo padrão. Clique em Salvar para aplicar.");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 rounded-xl border bg-indigo-50/50 p-3">
        <div className="min-w-0">
          {onBack && (
            <button
              onClick={onBack}
              className="mb-1 flex items-center gap-1 text-[11px] font-medium text-indigo-600 hover:underline"
            >
              ← Voltar aos bots
            </button>
          )}
          <p className="text-sm font-bold text-slate-800">{draft.name}</p>
          <p className="text-xs text-slate-600">
            Edite o que o bot fala e pergunta, as opções das listas e para quem transfere ao final.
            Ligue este bot a um número em <strong>Canais → editar → Bot de atendimento</strong>.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" className="h-8 text-xs" onClick={handleReset}>
            <RotateCcw className="mr-1 h-3.5 w-3.5" /> Padrão
          </Button>
          <Button className="h-8 text-xs" onClick={handleSave} disabled={saving}>
            <Save className="mr-1 h-3.5 w-3.5" /> {saving ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      </div>

      <ol className="space-y-3">
        {nodes.map((node, i) => (
          <li key={node.id} className="rounded-xl border bg-white p-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-500">
                {i + 1}
              </span>
              <span className="text-xs font-semibold text-slate-800">{nodeLabel(node)}</span>
            </div>
            <NodeEditor node={node} nodes={draft!.nodes} onPatch={patchNode} />
          </li>
        ))}
      </ol>

      <div className="flex justify-end">
        <Button className="h-8 text-xs" onClick={handleSave} disabled={saving}>
          <Save className="mr-1 h-3.5 w-3.5" /> {saving ? "Salvando…" : "Salvar fluxo"}
        </Button>
      </div>
    </div>
  );
}

function textareaCls() {
  return "w-full rounded-lg border px-2 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-400";
}

function NodeEditor({
  node,
  nodes,
  onPatch,
}: {
  node: BotNode;
  nodes: Record<string, BotNode>;
  onPatch: (id: string, patch: Partial<any>) => void;
}) {
  if (node.type === "message") {
    return (
      <textarea
        className={textareaCls()}
        rows={3}
        value={node.text ?? ""}
        onChange={(e) => onPatch(node.id, { text: e.target.value })}
        placeholder="Texto que o bot envia…"
      />
    );
  }

  if (node.type === "handoff" || node.type === "end" || node.type === "distribute") {
    return (
      <div className="space-y-2">
        <textarea
          className={textareaCls()}
          rows={3}
          value={(node as any).text ?? ""}
          onChange={(e) => onPatch(node.id, { text: e.target.value })}
          placeholder="Última mensagem que o bot envia…"
        />
        <TerminalSelect node={node} onPatch={onPatch} />
      </div>
    );
  }

  if (node.type === "ask") {
    return (
      <div className="space-y-2">
        <textarea
          className={textareaCls()}
          rows={2}
          value={node.text}
          onChange={(e) => onPatch(node.id, { text: e.target.value })}
          placeholder="Texto da pergunta…"
        />
        <p className="text-[10px] text-slate-400">
          Use <code>{"{{first_name}}"}</code> para chamar pelo primeiro nome. Guarda em:{" "}
          <span className="font-mono">{node.var}</span>
        </p>
        {node.options?.length ? (
          <OptionsEditor node={node} onPatch={onPatch} />
        ) : null}
      </div>
    );
  }

  if (node.type === "score") {
    return <ScoreEditor node={node} nodes={nodes} onPatch={onPatch} />;
  }

  if (node.type === "ensure_card") {
    return (
      <div className="space-y-2">
        <p className="text-[11px] text-slate-500">
          Assim que o lead manda a 1ª mensagem, cria um card no funil abaixo (se ainda não
          existir). Se já existir, segue com o card atual.
        </p>
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <span className="w-24 shrink-0">Funil</span>
          <input
            className="h-8 flex-1 rounded-lg border px-2 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"
            value={node.pipeline ?? ""}
            onChange={(e) => onPatch(node.id, { pipeline: e.target.value })}
            placeholder="Ex.: Controle de Leads"
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <span className="w-24 shrink-0">Etapa inicial</span>
          <input
            className="h-8 flex-1 rounded-lg border px-2 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"
            value={node.stage}
            onChange={(e) => onPatch(node.id, { stage: e.target.value })}
            placeholder="Ex.: NOVO LEAD"
          />
        </label>
      </div>
    );
  }

  if (node.type === "sync_card") {
    return <StageMapEditor node={node} onPatch={onPatch} />;
  }

  // set_name / set_contact / condition — estruturais, sem edição.
  return (
    <p className="text-[11px] text-slate-400">
      Passo automático — não precisa configurar.
    </p>
  );
}

function OptionsEditor({
  node,
  onPatch,
}: {
  node: Extract<BotNode, { type: "ask" }>;
  onPatch: (id: string, patch: Partial<any>) => void;
}) {
  const options = node.options ?? [];
  function setOptions(next: BotOption[]) {
    onPatch(node.id, { options: next });
  }
  const update = (idx: number, patch: Partial<BotOption>) => {
    const next = options.slice();
    next[idx] = { ...options[idx], ...patch };
    setOptions(next);
  };
  return (
    <div className="space-y-2 rounded-lg bg-slate-50 p-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase text-slate-400">Opções da lista</span>
        <span className="text-[10px] text-slate-400">título máx. 24 · descrição máx. 72</span>
      </div>
      {options.map((opt, idx) => (
        <div key={opt.id} className="space-y-1 rounded-md border bg-white p-1.5">
          <div className="flex items-center gap-1.5">
            <GripVertical className="h-3.5 w-3.5 shrink-0 text-slate-300" />
            <input
              className="h-8 flex-1 rounded-lg border px-2 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-indigo-400"
              maxLength={24}
              value={opt.title}
              onChange={(e) => update(idx, { title: e.target.value })}
              placeholder="Título da opção"
            />
            <button
              className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-rose-600"
              onClick={() => setOptions(options.filter((_, i) => i !== idx))}
              title="Remover"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
          <input
            className="ml-5 h-7 w-[calc(100%-2.75rem)] rounded-lg border px-2 text-[11px] text-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            maxLength={72}
            value={opt.description ?? ""}
            onChange={(e) => update(idx, { description: e.target.value })}
            placeholder="Descrição (texto secundário — opcional)"
          />
        </div>
      ))}
      {options.length < 10 && (
        <button
          className="flex items-center gap-1 text-[11px] font-medium text-indigo-600 hover:text-indigo-700"
          onClick={() =>
            setOptions([
              ...options,
              { id: `opt_${Date.now().toString(36)}`, title: "Nova opção" },
            ])
          }
        >
          <Plus className="h-3.5 w-3.5" /> Adicionar opção
        </button>
      )}
    </div>
  );
}

function ScoreEditor({
  node,
  nodes,
  onPatch,
}: {
  node: Extract<BotNode, { type: "score" }>;
  nodes: Record<string, BotNode>;
  onPatch: (id: string, patch: Partial<any>) => void;
}) {
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-xs text-slate-600">
        Vira <span className="font-semibold text-emerald-600">quente</span> quando a soma for ≥
        <input
          type="number"
          className="h-8 w-20 rounded-lg border px-2 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"
          value={node.threshold}
          onChange={(e) => onPatch(node.id, { threshold: Number(e.target.value) || 0 })}
        />
      </label>
      {Object.keys(node.weights).map((varKey) => {
        const ask = Object.values(nodes).find(
          (n) => n.type === "ask" && (n as any).var === varKey,
        ) as Extract<BotNode, { type: "ask" }> | undefined;
        const opts = ask?.options ?? [];
        const label = ask?.text ?? varKey;
        return (
          <div key={varKey} className="rounded-lg bg-slate-50 p-2">
            <p className="mb-1.5 text-[10px] font-semibold uppercase text-slate-400">
              Pesos — “{label}”
            </p>
            {opts.length === 0 && (
              <p className="text-[11px] text-slate-400">Esta pergunta não tem opções.</p>
            )}
            {opts.map((opt) => {
              const k = normalize(opt.title);
              return (
                <div key={opt.id} className="flex items-center justify-between gap-2 py-0.5">
                  <span className="text-xs text-slate-600">{opt.title}</span>
                  <input
                    type="number"
                    className="h-7 w-16 rounded-lg border px-2 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"
                    value={node.weights[varKey]?.[k] ?? 0}
                    onChange={(e) => {
                      const n = Number(e.target.value) || 0;
                      onPatch(node.id, {
                        weights: {
                          ...node.weights,
                          [varKey]: { ...node.weights[varKey], [k]: n },
                        },
                      });
                    }}
                  />
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function TerminalSelect({
  node,
  onPatch,
}: {
  node: Extract<BotNode, { type: "handoff" | "end" | "distribute" }>;
  onPatch: (id: string, patch: Partial<any>) => void;
}) {
  const team = useDbTeam();
  const value =
    node.type === "end"
      ? "encerrar"
      : node.type === "distribute"
        ? "distribuir"
        : node.to === "ia"
          ? "ia"
          : node.to === "usuario"
            ? "usuario"
            : "humano";
  const assignTo = node.type === "handoff" ? node.assignTo ?? "" : "";
  return (
    <div className="space-y-2">
      <label className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
        Ao terminar:
        <select
          className="h-8 rounded-lg border px-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          value={value}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "humano") onPatch(node.id, { type: "handoff", to: "humano", assignTo: undefined });
            else if (v === "ia") onPatch(node.id, { type: "handoff", to: "ia", assignTo: undefined });
            else if (v === "usuario") onPatch(node.id, { type: "handoff", to: "usuario" });
            else if (v === "distribuir") onPatch(node.id, { type: "distribute" });
            else onPatch(node.id, { type: "end" });
          }}
        >
          <option value="humano">Passar pro atendente (rodízio)</option>
          <option value="distribuir">Distribuir por rodízio (atendentes online)</option>
          <option value="usuario">Transferir para um atendente específico</option>
          <option value="ia">Deixar o Agente de IA responder</option>
          <option value="encerrar">Só enviar a mensagem e encerrar</option>
        </select>
      </label>
      {value === "usuario" && (
        <label className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
          Atendente:
          <select
            className="h-8 rounded-lg border px-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            value={assignTo}
            onChange={(e) => onPatch(node.id, { type: "handoff", to: "usuario", assignTo: e.target.value })}
          >
            <option value="">Escolher atendente...</option>
            {team.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

function StageMapEditor({
  node,
  onPatch,
}: {
  node: Extract<BotNode, { type: "sync_card" }>;
  onPatch: (id: string, patch: Partial<any>) => void;
}) {
  const rows = Object.entries(node.stageMap);
  const label: Record<string, string> = { quente: "Quente 🔥", frio: "Frio ❄️" };
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-2 text-xs text-slate-600">
        <span className="w-24 shrink-0">Funil</span>
        <input
          className="h-8 flex-1 rounded-lg border px-2 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"
          value={node.pipeline ?? ""}
          onChange={(e) => onPatch(node.id, { pipeline: e.target.value })}
          placeholder="Ex.: Controle de Leads"
        />
      </label>
      <p className="text-[11px] text-slate-500">
        Para onde o card do lead vai, conforme a qualificação (nome da etapa do funil):
      </p>
      {rows.map(([value, stage]) => (
        <div key={value} className="flex items-center gap-2">
          <span className="w-20 text-xs font-medium text-slate-600">{label[value] ?? value}</span>
          <span className="text-slate-300">→</span>
          <input
            className="h-8 flex-1 rounded-lg border px-2 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"
            value={stage}
            onChange={(e) =>
              onPatch(node.id, { stageMap: { ...node.stageMap, [value]: e.target.value } })
            }
            placeholder="Nome da etapa (ex.: QUENTE)"
          />
        </div>
      ))}
      <p className="text-[10px] text-slate-400">
        Casa por &ldquo;contém&rdquo; e ignora acento/emoji — &ldquo;QUENTE&rdquo; encontra a etapa
        &ldquo;QUENTE 🔥&rdquo;.
      </p>
    </div>
  );
}
