"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
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
import { useSnippets, snippetActions } from "@/lib/data/repos/db/conversations";

export function TrechosTab() {
  const snippets = useSnippets();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim() || !content.trim()) return;
    setSaving(true);
    const ok = await snippetActions.add(name.trim(), content.trim());
    setSaving(false);
    if (ok) {
      toast.success("Trecho criado");
      setName("");
      setContent("");
      setOpen(false);
    } else {
      toast.error("Não foi possível criar");
    }
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Trechos</h1>
          <p className="text-xs text-slate-500">
            Blocos de texto reutilizáveis em e-mails, conversas e campanhas
          </p>
        </div>
        <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setOpen(true)}>
          <Plus className="size-3.5" /> Novo trecho
        </Button>
      </div>

      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b text-[11px] text-slate-400">
              <th className="px-4 py-2.5 font-medium">Nome</th>
              <th className="px-4 py-2.5 font-medium">Conteúdo</th>
              <th className="w-10 px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {snippets.map((s) => (
              <tr key={s.id} className="border-b last:border-0">
                <td className="px-4 py-2.5 font-medium text-slate-800">{s.name}</td>
                <td className="px-4 py-2.5 text-slate-500">
                  <span className="block max-w-xl truncate">{s.content}</span>
                </td>
                <td className="px-4 py-2.5">
                  <button
                    onClick={async () => {
                      const ok = await snippetActions.remove(s.id);
                      toast[ok ? "success" : "error"](ok ? "Trecho removido" : "Falha ao remover");
                    }}
                    className="text-slate-400 hover:text-rose-600"
                    title="Remover"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </td>
              </tr>
            ))}
            {snippets.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-10 text-center text-slate-400">
                  Nenhum trecho ainda. Clique em “Novo trecho” para começar.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Novo trecho</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Nome</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 text-xs" placeholder="Ex.: Assinatura padrão" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Conteúdo</Label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={4}
                className="w-full rounded-lg border px-3 py-2 text-xs outline-none focus:border-indigo-400"
                placeholder="Texto reutilizável…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button size="sm" className="h-8 text-xs" disabled={saving || !name.trim() || !content.trim()} onClick={save}>
              Salvar trecho
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
