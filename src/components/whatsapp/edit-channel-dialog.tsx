"use client";

import { useEffect, useState } from "react";
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
import { whatsappActions } from "@/lib/data/repos/db/whatsapp";
import { useTeam } from "@/lib/data/repos/db/team";

interface Channel {
  id: string;
  name: string;
  sector: string;
  dailyLimit: number;
  botFlow?: string;
  leadPool?: string[];
  phoneE164?: string;
}

// Fluxos de bot disponíveis (config-driven por enquanto).
const BOT_FLOWS: { value: string; label: string }[] = [
  { value: "", label: "Nenhum (sem bot)" },
  { value: "triagem", label: "Triagem Comercial" },
];

/**
 * Edita nome, setor e limite diário de um canal. Os identificadores da Meta
 * (phone_number_id / waba_id) NÃO são editáveis aqui — trocá-los é recadastrar
 * o número, não renomear.
 */
export function EditChannelDialog({
  channel,
  open,
  onOpenChange,
}: {
  channel: Channel | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [saving, setSaving] = useState(false);
  const { members } = useTeam();
  const [form, setForm] = useState({ name: "", sector: "", dailyLimit: "1000", botFlow: "" });
  const [leadPool, setLeadPool] = useState<string[]>([]);

  useEffect(() => {
    if (channel) {
      setForm({
        name: channel.name,
        sector: channel.sector,
        dailyLimit: String(channel.dailyLimit),
        botFlow: channel.botFlow ?? "",
      });
      setLeadPool(channel.leadPool ?? []);
    }
  }, [channel]);

  const togglePool = (userId: string) =>
    setLeadPool((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId],
    );

  const submit = async () => {
    if (!channel) return;
    if (!form.name.trim()) {
      toast.error("O nome do canal é obrigatório");
      return;
    }
    setSaving(true);
    const ok = await whatsappActions.updateChannel(channel.id, {
      name: form.name.trim(),
      sector: form.sector.trim(),
      dailyLimit: Number(form.dailyLimit) || 1000,
      botFlow: form.botFlow,
      leadPool,
    });
    setSaving(false);
    if (ok) {
      toast.success("Canal atualizado");
      onOpenChange(false);
    } else {
      toast.error("Não foi possível atualizar o canal");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Editar canal{channel?.phoneE164 ? ` · ${channel.phoneE164}` : ""}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1">
            <Label className="text-xs">Nome do canal</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Ex.: Secretaria - Reserva"
              className="h-8 text-xs"
            />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Setor</Label>
            <Input
              value={form.sector}
              onChange={(e) => setForm((f) => ({ ...f, sector: e.target.value }))}
              placeholder="Ex.: Secretaria"
              className="h-8 text-xs"
            />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Limite diário</Label>
            <Input
              value={form.dailyLimit}
              onChange={(e) => setForm((f) => ({ ...f, dailyLimit: e.target.value }))}
              placeholder="1000"
              className="h-8 text-xs"
            />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Bot de atendimento</Label>
            <select
              value={form.botFlow}
              onChange={(e) => setForm((f) => ({ ...f, botFlow: e.target.value }))}
              className="h-8 rounded-md border bg-white px-2 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-300"
            >
              {BOT_FLOWS.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-slate-400">
              Quando ativo, o bot responde a 1ª mensagem deste número e conduz o fluxo até passar pra um humano.
            </p>
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Distribuição de leads (rodízio)</Label>
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
              {members.length === 0 ? (
                <p className="text-[11px] text-slate-400">Nenhum membro na equipe ainda.</p>
              ) : (
                members.map((m) => (
                  <label
                    key={m.userId}
                    className="flex cursor-pointer items-center gap-2 text-xs text-slate-700"
                  >
                    <input
                      type="checkbox"
                      checked={leadPool.includes(m.userId)}
                      onChange={() => togglePool(m.userId)}
                      className="h-3.5 w-3.5 accent-indigo-600"
                    />
                    <span>{m.name || m.email}</span>
                    {m.role === "admin" && (
                      <span className="rounded bg-slate-100 px-1 text-[9px] font-semibold text-slate-500">
                        admin
                      </span>
                    )}
                  </label>
                ))
              )}
            </div>
            <p className="text-[10px] text-slate-400">
              Marque quem entra no rodízio deste número. Leads quentes vão, em rodízio, para
              quem estiver <strong>online</strong> (ativo nos últimos 5 min).
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button size="sm" className="h-8 text-xs" onClick={submit} disabled={saving}>
            {saving ? "Salvando..." : "Salvar alterações"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
