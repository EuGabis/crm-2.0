"use client";

import { useEffect, useMemo, useState } from "react";
import { Send } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAiAgents, aiAgentActions, type AiAgent } from "@/lib/data/repos/db/ai-agents";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<AiAgent["status"], string> = {
  ativo: "Ativo",
  sugestivo: "Sugestivo",
  desativado: "Desativado",
};
const ACTION_KEYS = [
  "Agendamento de compromissos",
  "Acionar um fluxo de trabalho",
  "Informações de contato",
  "Parar bot",
  "Transferência humana",
  "Follow-up automático",
];

export function ConversationAiTab() {
  const { agents, ready } = useAiAgents();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(
    () => agents.find((a) => a.id === selectedId) ?? agents[0] ?? null,
    [agents, selectedId],
  );

  // form
  const [personality, setPersonality] = useState("");
  const [goal, setGoal] = useState("");
  const [extraInfo, setExtraInfo] = useState("");
  const [model, setModel] = useState("gpt-4o-mini");
  const [status, setStatus] = useState<AiAgent["status"]>("sugestivo");
  const [actions, setActions] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!selected) return;
    setPersonality(selected.personality);
    setGoal(selected.goal);
    setExtraInfo(selected.extraInfo);
    setModel(selected.model);
    setStatus(selected.status);
    setActions(selected.actions ?? {});
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // criar
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const doCreate = async () => {
    if (!newName.trim()) return toast.error("Dê um nome ao agente");
    const res = await aiAgentActions.create({ name: newName.trim() });
    if (res.ok) {
      setSelectedId(res.id ?? null);
      setCreateOpen(false);
      setNewName("");
      toast.success("Agente criado");
    } else toast.error(res.error ?? "Falha ao criar");
  };

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    const ok = await aiAgentActions.update(selected.id, {
      personality,
      goal,
      extraInfo,
      model,
      status,
      actions,
    });
    setSaving(false);
    if (ok) toast.success("Agente salvo");
    else toast.error("Não foi possível salvar");
  };

  // teste
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  useEffect(() => {
    setMessages([]);
  }, [selected?.id]);

  const sendTest = async () => {
    if (!selected) return toast.error("Crie ou selecione um agente");
    const text = input.trim();
    if (!text || sending) return;
    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setInput("");
    setSending(true);
    const res = await aiAgentActions.chat(selected.id, next);
    setSending(false);
    if (res.ok) setMessages([...next, { role: "assistant", content: res.text ?? "" }]);
    else {
      toast.error(res.error ?? "Falha ao responder");
      setMessages(messages); // desfaz a msg do usuário
      setInput(text);
    }
  };

  if (ready && agents.length === 0) {
    return (
      <div className="rounded-xl border bg-white p-8 text-center">
        <p className="text-sm font-semibold text-slate-700">Nenhum agente ainda</p>
        <p className="mt-1 text-xs text-slate-500">Crie um agente de IA e teste a conversa aqui.</p>
        <Button size="sm" className="mt-3 h-8 text-xs" onClick={() => setCreateOpen(true)}>
          + Criar bot
        </Button>
        <CreateDialog open={createOpen} onOpenChange={setCreateOpen} value={newName} onChange={setNewName} onCreate={doCreate} />
      </div>
    );
  }

  return (
    <>
      <h1 className="mb-4 text-lg font-bold text-slate-900">Agentes de Conversation AI</h1>
      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          {/* Lista */}
          <div className="rounded-xl border bg-white">
            <div className="flex items-center justify-between border-b px-4 py-2.5">
              <h2 className="text-sm font-semibold text-slate-700">Lista de agentes</h2>
              <Button size="sm" className="h-7 text-xs" onClick={() => setCreateOpen(true)}>+ Criar bot</Button>
            </div>
            <p className="border-b bg-amber-50 px-4 py-2 text-[11px] text-amber-700">
              Importante: somente o agente principal responde às mensagens recebidas.
            </p>
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b text-[11px] text-slate-400">
                  <th className="px-4 py-2 font-medium">Nome do agente</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((a) => (
                  <tr
                    key={a.id}
                    onClick={() => setSelectedId(a.id)}
                    className={cn("cursor-pointer border-b last:border-0 hover:bg-slate-50", selected?.id === a.id && "bg-indigo-50/60")}
                  >
                    <td className="px-4 py-2.5 font-medium text-slate-800">
                      {a.name}{" "}
                      {a.isPrimary && <Badge className="ml-1 bg-indigo-100 text-[9px] text-indigo-700">Principal</Badge>}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge variant="secondary" className={cn(a.status === "ativo" && "bg-emerald-100 text-emerald-700")}>
                        {STATUS_LABEL[a.status]}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex gap-2 text-[11px]">
                        {!a.isPrimary && (
                          <button
                            onClick={(e) => { e.stopPropagation(); void aiAgentActions.setPrimary(a.id).then((ok) => ok && toast.success("Definido como principal")); }}
                            className="text-indigo-600 hover:underline"
                          >Tornar principal</button>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!window.confirm(`Excluir o agente "${a.name}"? Essa ação não pode ser desfeita.`)) return;
                            void aiAgentActions.remove(a.id).then((ok) => ok && toast.success("Agente excluído"));
                          }}
                          className="text-rose-600 hover:underline"
                        >Excluir</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Form */}
          {selected && (
            <div className="rounded-xl border bg-white p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-700">Metas do bot — {selected.name}</h2>
                <div className="flex items-center gap-2">
                  <Select value={status} onValueChange={(v) => v && setStatus(v as AiAgent["status"])}>
                    <SelectTrigger className="h-7 w-[110px] text-xs" size="sm"><SelectValue>{STATUS_LABEL[status]}</SelectValue></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ativo" className="text-xs">Ativo</SelectItem>
                      <SelectItem value="sugestivo" className="text-xs">Sugestivo</SelectItem>
                      <SelectItem value="desativado" className="text-xs">Desativado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs font-bold">Personalidade</Label>
                  <Textarea value={personality} onChange={(e) => setPersonality(e.target.value)} placeholder="Ex.: Você é a Laura, assistente comercial. Tom simpático e consultivo." className="min-h-16 text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-bold">Meta</Label>
                  <Textarea value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Ex.: Levar o lead até a demonstração." className="min-h-16 text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-bold">Informações adicionais</Label>
                  <Textarea value={extraInfo} onChange={(e) => setExtraInfo(e.target.value)} placeholder="Contexto/produto/preços que o bot deve saber." className="min-h-16 text-xs" />
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-xs font-bold">Modelo</Label>
                  <Input value={model} onChange={(e) => setModel(e.target.value)} className="h-8 w-40 text-xs" />
                </div>
              </div>
              <p className="mt-3 mb-1.5 text-xs font-bold text-slate-700">Configure suas ações</p>
              <div className="flex flex-wrap gap-1.5">
                {ACTION_KEYS.map((label) => (
                  <button
                    key={label}
                    onClick={() => setActions((m) => ({ ...m, [label]: !m[label] }))}
                    className={cn("rounded-full border px-2.5 py-1 text-[11px] font-medium", actions[label] ? "border-indigo-300 bg-indigo-50 text-indigo-700" : "text-slate-500 hover:bg-slate-50")}
                  >{label}</button>
                ))}
              </div>
              <div className="mt-4">
                <Button size="sm" className="h-8 text-xs" onClick={save} disabled={saving}>{saving ? "Salvando..." : "Salvar agente"}</Button>
              </div>
            </div>
          )}
        </div>

        {/* Teste */}
        <div className="flex h-fit flex-col rounded-xl border bg-white">
          <div className="border-b px-4 py-2.5"><h2 className="text-sm font-semibold text-slate-700">Testar seu bot</h2></div>
          <div className="flex max-h-96 min-h-56 flex-col gap-2 overflow-y-auto p-3 [scrollbar-width:thin]">
            {messages.length === 0 && (
              <p className="text-xs text-slate-400">
                {selected ? `Converse com "${selected.name}" para testar.` : "Crie ou selecione um agente."}
              </p>
            )}
            {messages.map((m, i) => (
              <div key={i} className={cn("max-w-[85%] whitespace-pre-wrap rounded-xl px-3 py-1.5 text-xs", m.role === "assistant" ? "self-start bg-slate-100 text-slate-700" : "self-end bg-indigo-500 text-white")}>
                {m.content}
              </div>
            ))}
            {sending && <div className="self-start rounded-xl bg-slate-100 px-3 py-1.5 text-xs text-slate-400">Digitando...</div>}
          </div>
          <div className="flex items-center gap-2 border-t p-2.5">
            <Input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendTest()} placeholder="Enviar uma mensagem" className="h-8 text-xs" disabled={!selected || sending} />
            <Button size="sm" className="size-8 p-0" onClick={sendTest} disabled={!selected || sending}><Send className="size-3.5" /></Button>
          </div>
        </div>
      </div>
      <CreateDialog open={createOpen} onOpenChange={setCreateOpen} value={newName} onChange={setNewName} onCreate={doCreate} />
    </>
  );
}

function CreateDialog({ open, onOpenChange, value, onChange, onCreate }: { open: boolean; onOpenChange: (v: boolean) => void; value: string; onChange: (v: string) => void; onCreate: () => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Novo agente</DialogTitle></DialogHeader>
        <div className="grid gap-1.5">
          <Label className="text-xs">Nome do agente</Label>
          <Input value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onCreate()} placeholder="Ex.: IA Comercial" className="h-8 text-xs" autoFocus />
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button size="sm" className="h-8 text-xs" onClick={onCreate}>Criar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
