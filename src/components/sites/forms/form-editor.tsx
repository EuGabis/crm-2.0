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

import {
  COM_OPCOES,
  DESTINOS,
  FORMATOS_DATA,
  FORMATOS_HORA,
  TIPOS,
  opcoesDoTexto,
} from "@/lib/forms/campos";

/** Rótulo do destino; o formato antigo `custom:<nome>` também é "campo do contato". */
function rotuloDestino(mapsTo: string): string {
  if (mapsTo.startsWith("custom:")) return `Campo: ${mapsTo.slice(7)}`;
  return DESTINOS.find((o) => o.value === mapsTo)?.label ?? mapsTo;
}

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
  const [tag, setTag] = useState(form.tag);
  const [saving, setSaving] = useState(false);

  const setField = (i: number, patch: Partial<FormField>) =>
    setFields((fs) => fs.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const removeField = (i: number) => setFields((fs) => fs.filter((_, j) => j !== i));
  const addField = () =>
    setFields((fs) => [
      ...fs,
      /*
       * ⚠️ Nasce como CAMPO DO CONTATO, não "Empresa". O padrão antigo fazia
       * cada pergunta nova sobrescrever `contacts.company`, e só a última
       * resposta sobrevivia.
       */
      { key: `campo${Date.now().toString(36)}`, label: "Novo campo", type: "text", required: false, mapsTo: "custom" },
    ]);

  const save = async () => {
    if (!name.trim()) {
      toast.error("Dê um nome ao formulário");
      return;
    }
    if (!tag.trim()) {
      toast.error("A tag não pode ficar vazia");
      return;
    }
    const semOpcoes = fields.find(
      (f) => COM_OPCOES.includes(f.type) && !(f.options ?? []).length,
    );
    if (semOpcoes) {
      toast.error(`"${semOpcoes.label}" precisa de pelo menos uma opção`);
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
      tag: tag.trim(),
    });
    setSaving(false);
    if (ok) {
      toast.success("Formulário salvo");
      onOpenChange(false);
    } else toast.error("Não foi possível salvar");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Editar formulário</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-[1fr_240px]">
          {/* Campos */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold">Campos</Label>
            {fields.map((f, i) => (
              <div key={`${f.key}-${i}`} className="space-y-1.5 rounded-md border p-2">
                <div className="flex items-start gap-1.5">
                  {/*
                   * Caixa que CRESCE com o texto (`field-sizing-content`): a
                   * pergunta costuma ser uma frase inteira, e num campo de uma
                   * linha só dava para ler o final dela. Enter não quebra linha
                   * — a pergunta é uma frase só no formulário do site.
                   */}
                  <Textarea
                    value={f.label}
                    onChange={(e) => setField(i, { label: e.target.value.replace(/\r?\n/g, " ") })}
                    onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
                    rows={1}
                    className="min-h-8 resize-none py-1.5 text-xs md:text-xs"
                    placeholder="Pergunta"
                  />
                  <button
                    onClick={() => setField(i, { required: !f.required })}
                    className={`mt-1 shrink-0 rounded px-1.5 py-1 text-[10px] font-semibold ${f.required ? "bg-indigo-100 text-indigo-700" : "bg-slate-100 text-slate-500"}`}
                  >
                    Obrigatório
                  </button>
                  <button
                    onClick={() => removeField(i)}
                    className="mt-1.5 shrink-0 text-slate-400 hover:text-rose-600"
                    title="Remover campo"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-12 shrink-0 text-[10px] text-slate-400">Tipo</span>
                  <Select
                    value={f.type}
                    onValueChange={(v) => v && setField(i, { type: v as FormField["type"] })}
                  >
                    <SelectTrigger className="h-7 flex-1 text-xs" size="sm">
                      <SelectValue>{TIPOS.find((t) => t.value === f.type)?.label ?? f.type}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {TIPOS.map((t) => (
                        <SelectItem key={t.value} value={t.value} className="text-xs">
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="shrink-0 text-[10px] text-slate-400">Salvar em</span>
                  <Select value={f.mapsTo} onValueChange={(v) => v && setField(i, { mapsTo: v })}>
                    <SelectTrigger className="h-7 flex-1 text-xs" size="sm">
                      <SelectValue>{rotuloDestino(f.mapsTo)}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {DESTINOS.map((o) => (
                        <SelectItem key={o.value} value={o.value} className="text-xs">
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {(f.type === "date" || f.type === "time" || f.type === "datetime") && (
                  /*
                   * Formato em que a resposta fica gravada no contato, com os
                   * modelos da tela do WordPress. O rótulo é o próprio exemplo.
                   */
                  <div className="flex items-center gap-1.5">
                    <span className="w-12 shrink-0 text-[10px] text-slate-400">Formato</span>
                    {f.type !== "time" && (
                      <Select
                        value={f.formatoData ?? "d/m/Y"}
                        onValueChange={(v) => v && setField(i, { formatoData: v as FormField["formatoData"] })}
                      >
                        <SelectTrigger className="h-7 flex-1 text-xs" size="sm">
                          <SelectValue>
                            {FORMATOS_DATA.find((o) => o.value === (f.formatoData ?? "d/m/Y"))?.label}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {FORMATOS_DATA.map((o) => (
                            <SelectItem key={o.value} value={o.value} className="text-xs">
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    {f.type !== "date" && (
                      <Select
                        value={f.formatoHora ?? "24h"}
                        onValueChange={(v) => v && setField(i, { formatoHora: v as FormField["formatoHora"] })}
                      >
                        <SelectTrigger className="h-7 flex-1 text-xs" size="sm">
                          <SelectValue>
                            {FORMATOS_HORA.find((o) => o.value === (f.formatoHora ?? "24h"))?.label}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {FORMATOS_HORA.map((o) => (
                            <SelectItem key={o.value} value={o.value} className="text-xs">
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                )}
                {COM_OPCOES.includes(f.type) && (
                  <Textarea
                    defaultValue={(f.options ?? []).join("\n")}
                    onBlur={(e) => setField(i, { options: opcoesDoTexto(e.target.value) })}
                    className="min-h-16 text-xs"
                    placeholder={"Uma opção por linha\nEx.: Manhã\nTarde\nNoite"}
                  />
                )}
                {f.mapsTo === "company" && fields.filter((x) => x.mapsTo === "company").length > 1 && (
                  <p className="text-[10px] text-amber-700">
                    Mais de um campo grava em Empresa — só a última resposta fica no contato.
                  </p>
                )}
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
              <Label className="text-xs">Tag / Lista Inteligente</Label>
              <Input value={tag} onChange={(e) => setTag(e.target.value)} className="h-8 text-xs" />
              <p className="text-[10px] text-slate-400">
                Aplicada ao contato no envio e usada pela Lista Inteligente deste formulário.
              </p>
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
