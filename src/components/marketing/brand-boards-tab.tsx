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
import { useBrandBoards, brandBoardActions } from "@/lib/data/repos/db/brand-boards";

function parsePalette(raw: string): string[] {
  return raw
    .split(",")
    .map((c) => c.trim())
    .filter((c) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c));
}

export function BrandBoardsTab() {
  const { boards } = useBrandBoards();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [paletteRaw, setPaletteRaw] = useState("#6366f1, #0f172a, #10b981, #f8fafc");
  const [font, setFont] = useState("Inter");
  const [saving, setSaving] = useState(false);

  const preview = parsePalette(paletteRaw);

  async function save() {
    const palette = parsePalette(paletteRaw);
    if (!name.trim() || palette.length === 0) return;
    setSaving(true);
    const ok = await brandBoardActions.add({ name: name.trim(), palette, font: font.trim() || "Inter" });
    setSaving(false);
    if (ok) {
      toast.success("Marca criada");
      setName("");
      setOpen(false);
    } else {
      toast.error("Não foi possível criar");
    }
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-bold text-slate-900">Brand Boards</h1>
        <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setOpen(true)}>
          <Plus className="size-3.5" /> Nova marca
        </Button>
      </div>

      {boards.length === 0 ? (
        <div className="rounded-xl border bg-white p-10 text-center text-xs text-slate-400">
          Nenhuma marca ainda. Clique em “Nova marca” para criar sua paleta.
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {boards.map((b) => (
            <div key={b.id} className="group rounded-xl border bg-white p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-lg bg-indigo-100 text-sm font-bold text-indigo-600">
                    {b.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{b.name}</p>
                    <p className="text-[11px] text-slate-500">Fonte: {b.font}</p>
                  </div>
                </div>
                <button
                  onClick={async () => {
                    const ok = await brandBoardActions.remove(b.id);
                    toast[ok ? "success" : "error"](ok ? "Marca removida" : "Falha ao remover");
                  }}
                  className="text-slate-300 hover:text-rose-600"
                  title="Remover"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {b.palette.map((color) => (
                  <div key={color} className="size-7 rounded-md border" style={{ backgroundColor: color }} title={color} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nova marca</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Nome</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 text-xs" placeholder="Ex.: Lito — Principal" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Paleta (cores hex, separadas por vírgula)</Label>
              <Input value={paletteRaw} onChange={(e) => setPaletteRaw(e.target.value)} className="h-8 text-xs" placeholder="#6366f1, #0f172a, #10b981" />
              <div className="mt-1 flex flex-wrap gap-1.5">
                {preview.map((c) => (
                  <div key={c} className="size-6 rounded border" style={{ backgroundColor: c }} title={c} />
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Fonte</Label>
              <Input value={font} onChange={(e) => setFont(e.target.value)} className="h-8 text-xs" placeholder="Inter" />
            </div>
          </div>
          <DialogFooter>
            <Button size="sm" className="h-8 text-xs" disabled={saving || !name.trim() || preview.length === 0} onClick={save}>
              Salvar marca
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
