"use client";

import { useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Trash2, Plus } from "lucide-react";
import { formActions } from "@/lib/data/repos/db/forms";
import type { FormField, LeadForm } from "@/lib/data/types";

const MAP_OPTIONS: { value: string; label: string }[] = [
  { value: "name", label: "Nome" },
  { value: "email", label: "E-mail" },
  { value: "phone", label: "Telefone/WhatsApp" },
  { value: "company", label: "Empresa" },
];

export function FormEditor({
  form,
  open,
  onOpenChange,
}: {
  form: LeadForm;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [name, setName] = useState(form.name);
  const [description, setDescription] = useState(form.description);
  const [fields, setFields] = useState<FormField[]>(form.fields);
  const [successAction, setSuccessAction] = useState(form.successAction);
  const [successValue, setSuccessValue] = useState(form.successValue);
  const [active, setActive] = useState(form.active);
  const [saving, setSaving] = useState(false);

  const setField = (i: number, patch: Partial<FormField>) =>
    setFields((fs) => fs.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const removeField = (i: number) => setFields((fs) => fs.filter((_, j) => j !== i));
  const addField = () =>
    setFields((fs) => [
      ...fs,
      { key: `campo${fs.length + 1}`, label: "Novo campo", type: "text", required: false, mapsTo: "company" },
    ]);

  const save = async () => {
    if (!name.trim()) {
      toast.error("Dê um nome ao formulário");
      return;
    }
    setSaving(true);
    const ok = await formActions.update(form.id, {
      name: name.trim(),
      description,
      fields,
      successAction,
      successValue,
      active,
    });
    setSaving(false);
    if (ok) {
      toast.success("Formulário salvo");
      onOpenChange(false);
    } else toast.error("Não foi possível salvar");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Editar formulário</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-[1fr_260px]">
          {/* Campos */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold">Campos</Label>
            {fields.map((f, i) => (
              <div key={i} className="flex items-center gap-1.5 rounded-md border p-2">
                <Input
                  value={f.label}
                  onChange={(e) => setField(i, { label: e.target.value })}
                  className="h-8 text-xs"
                  placeholder="Rótulo"
                />
                <Select value={f.mapsTo} onValueChange={(v) => v && setField(i, { mapsTo: v })}>
                  <SelectTrigger className="h-8 w-[130px] text-xs" size="sm">
                    <SelectValue>{MAP_OPTIONS.find((o) => o.value === f.mapsTo)?.label ?? f.mapsTo}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {MAP_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value} className="text-xs">
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <button
                  onClick={() => setField(i, { required: !f.required })}
                  className={`rounded px-1.5 py-1 text-[10px] font-semibold ${f.required ? "bg-indigo-100 text-indigo-700" : "bg-slate-100 text-slate-500"}`}
                >
                  Obrigatório
                </button>
                <button onClick={() => removeField(i)} className="text-slate-400 hover:text-rose-600">
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
            <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={addField}>
              <Plus className="size-3.5" /> Adicionar campo
            </Button>
          </div>

          {/* Detalhes */}
          <div className="space-y-3">
            <div className="grid gap-1">
              <Label className="text-xs">Nome</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 text-xs" />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">Descrição</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="min-h-14 text-xs"
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">Ação de sucesso</Label>
              <Select value={successAction} onValueChange={(v) => v && setSuccessAction(v as any)}>
                <SelectTrigger className="h-8 text-xs" size="sm">
                  <SelectValue>{successAction === "redirect" ? "Redirecionar (URL)" : "Mostrar mensagem"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="message" className="text-xs">Mostrar mensagem</SelectItem>
                  <SelectItem value="redirect" className="text-xs">Redirecionar (URL)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">{successAction === "redirect" ? "URL de redirecionamento" : "Mensagem de sucesso"}</Label>
              <Input value={successValue} onChange={(e) => setSuccessValue(e.target.value)} className="h-8 text-xs" />
            </div>
            <label className="flex items-center gap-2 text-xs">
              <Switch checked={active} onCheckedChange={setActive} /> Ativado
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button size="sm" className="h-8 text-xs" onClick={save} disabled={saving}>
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
