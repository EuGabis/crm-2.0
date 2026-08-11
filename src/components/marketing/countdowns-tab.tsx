"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCountdowns, countdownActions } from "@/lib/data/repos/db/countdowns";
import { cn } from "@/lib/utils";

const pad = (n: number) => String(n).padStart(2, "0");

function remaining(endsAt: string, now: number): { label: string; expired: boolean } {
  const diff = new Date(endsAt).getTime() - now;
  if (diff <= 0) return { label: "00d 00h 00m 00s", expired: true };
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return { label: `${pad(d)}d ${pad(h)}h ${pad(m)}m ${pad(s)}s`, expired: false };
}

export function CountdownsTab() {
  const { countdowns } = useCountdowns();
  const [now, setNow] = useState(() => Date.now());
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  async function save() {
    if (!name.trim() || !endsAt) return;
    setSaving(true);
    const ok = await countdownActions.add({ name: name.trim(), endsAt: new Date(endsAt).toISOString() });
    setSaving(false);
    if (ok) {
      toast.success("Contador criado");
      setName("");
      setEndsAt("");
      setOpen(false);
    } else {
      toast.error("Não foi possível criar");
    }
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Contadores regressivos</h1>
          <p className="text-xs text-slate-500">Crie urgência em páginas e e-mails com timers dinâmicos</p>
        </div>
        <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setOpen(true)}>
          <Plus className="size-3.5" /> Novo contador
        </Button>
      </div>

      {countdowns.length === 0 ? (
        <div className="rounded-xl border bg-white p-10 text-center text-xs text-slate-400">
          Nenhum contador ainda. Clique em “Novo contador” para criar.
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-3">
          {countdowns.map((c) => {
            const r = remaining(c.endsAt, now);
            return (
              <div key={c.id} className="rounded-xl border bg-white p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-slate-800">{c.name}</p>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className={cn(!r.expired && "bg-emerald-100 text-emerald-700")}>
                      {r.expired ? "Expirado" : "Ativo"}
                    </Badge>
                    <button
                      onClick={async () => {
                        const ok = await countdownActions.remove(c.id);
                        toast[ok ? "success" : "error"](ok ? "Contador removido" : "Falha ao remover");
                      }}
                      className="text-slate-300 hover:text-rose-600"
                      title="Remover"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
                <p className="mt-3 font-mono text-2xl font-bold tracking-tight text-indigo-600">{r.label}</p>
                <p className="mt-2 text-[11px] text-slate-500">
                  Termina em {new Date(c.endsAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                </p>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Novo contador</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Nome</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 text-xs" placeholder="Ex.: Oferta 70% OFF" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Termina em</Label>
              <Input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className="h-8 text-xs" />
            </div>
          </div>
          <DialogFooter>
            <Button size="sm" className="h-8 text-xs" disabled={saving || !name.trim() || !endsAt} onClick={save}>
              Salvar contador
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
