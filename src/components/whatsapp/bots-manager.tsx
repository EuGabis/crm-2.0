"use client";

import { useState } from "react";
import { Bot, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useConfirm } from "@/components/shared/confirm";
import {
  useBotFlowsList,
  botFlowActions,
  type BotSummary,
} from "@/lib/data/repos/db/bot-flows";
import { BotEditor } from "./bot-editor";

/**
 * Gestão de VÁRIOS bots conversacionais (independentes). Lista os bots da
 * empresa; cada um abre o editor do seu fluxo. Ligar a um número é feito em
 * Canais → editar → "Bot de atendimento".
 */
export function BotsManager() {
  const { flows, loading, reload } = useBotFlowsList();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<BotSummary | null>(null);
  const [renameName, setRenameName] = useState("");

  if (editing) {
    return <BotEditor flowKey={editing} onBack={() => { setEditing(null); void reload(); }} />;
  }

  const create = async () => {
    const name = newName.trim();
    if (!name) {
      toast.error("Dê um nome ao bot");
      return;
    }
    setBusy(true);
    const res = await botFlowActions.create(name);
    setBusy(false);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    setCreateOpen(false);
    setNewName("");
    toast.success("Bot criado");
    setEditing(res.key);
  };

  const doRename = async () => {
    if (!renaming) return;
    const name = renameName.trim();
    if (!name) return;
    setBusy(true);
    const ok = await botFlowActions.rename(renaming.key, name);
    setBusy(false);
    if (!ok) {
      toast.error("Não foi possível renomear");
      return;
    }
    setRenaming(null);
    toast.success("Bot renomeado");
    void reload();
  };

  const remove = async (bot: BotSummary) => {
    if (bot.isTemplate) {
      toast.info("Este é o modelo padrão — não pode ser excluído (só editado).");
      return;
    }
    if (
      !(await confirm({
        title: `Excluir o bot "${bot.name}"?`,
        description: "Os números ligados a ele ficam sem bot.",
        confirmLabel: "Excluir",
        destructive: true,
      }))
    )
      return;
    const ok = await botFlowActions.remove(bot.key);
    ok ? toast.success("Bot excluído") : toast.error("Não foi possível excluir");
    void reload();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold text-slate-800">Bots de atendimento</h2>
          <p className="text-xs text-slate-500">
            Crie bots independentes e ligue cada um a um número em Canais.
          </p>
        </div>
        <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => { setNewName(""); setCreateOpen(true); }}>
          <Plus className="size-3.5" /> Novo bot
        </Button>
      </div>

      {loading ? (
        <p className="text-xs text-slate-500">Carregando bots…</p>
      ) : flows.length === 0 ? (
        <div className="rounded-xl border bg-white p-6 text-center text-xs text-slate-500">
          Nenhum bot ainda. Clique em <strong>Novo bot</strong> para criar o primeiro.
        </div>
      ) : (
        <div className="grid gap-2">
          {flows.map((bot) => (
            <div
              key={bot.key}
              className="flex items-center gap-3 rounded-xl border bg-white p-3"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600">
                <Bot className="size-4" />
              </span>
              <button className="min-w-0 flex-1 text-left" onClick={() => setEditing(bot.key)}>
                <p className="truncate text-xs font-semibold text-slate-800">
                  {bot.name}
                  {bot.isTemplate && (
                    <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                      modelo
                    </span>
                  )}
                </p>
                <p className="truncate text-[10px] text-slate-400">
                  chave: {bot.key}
                  {bot.updatedAt ? ` · atualizado ${new Date(bot.updatedAt).toLocaleDateString("pt-BR")}` : ""}
                </p>
              </button>
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setEditing(bot.key)}>
                Editar
              </Button>
              {!bot.isTemplate && (
                <>
                  <button
                    title="Renomear"
                    onClick={() => { setRenaming(bot); setRenameName(bot.name); }}
                    className="text-slate-400 hover:text-slate-700"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    title="Excluir"
                    onClick={() => void remove(bot)}
                    className="text-slate-400 hover:text-red-600"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Novo bot</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label className="text-xs">Nome do bot</Label>
            <Input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void create()}
              placeholder="Ex.: Secretaria"
              className="h-9 text-sm"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={() => void create()} disabled={busy}>
              {busy ? "Criando…" : "Criar bot"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!renaming} onOpenChange={(v) => !v && setRenaming(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Renomear bot</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label className="text-xs">Nome</Label>
            <Input
              autoFocus
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void doRename()}
              className="h-9 text-sm"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenaming(null)}>
              Cancelar
            </Button>
            <Button onClick={() => void doRename()} disabled={busy}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
