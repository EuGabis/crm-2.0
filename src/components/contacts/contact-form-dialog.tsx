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
import { CustomFieldsInputs } from "@/components/contacts/custom-fields-inputs";
import { dbContactActions } from "@/lib/data/repos/db/contacts";
import { useContactsModule } from "@/lib/data/repos/db/contacts-module";

export function ContactFormDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /**
   * A lista da tela de Contatos vem de uma consulta paginada ao banco, não do
   * store — ela não fica sabendo do contato novo sozinha.
   */
  onCreated?: () => void;
}) {
  const { fields } = useContactsModule();
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    doc: "",
    company: "",
    tags: "",
  });
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    if (!form.firstName.trim() || !form.lastName.trim()) {
      toast.error("Nome e sobrenome são obrigatórios");
      return;
    }
    if (form.phone.trim()) {
      const dup = await dbContactActions.findByPhone(form.phone);
      if (dup) {
        toast.error(
          `Já existe um contato com esse número: ${`${dup.firstName} ${dup.lastName}`.trim()}`,
        );
        return;
      }
    }
    setSaving(true);
    const ok = await dbContactActions.add({
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      doc: form.doc.trim(),
      company: form.company.trim() || undefined,
      tags: form.tags
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean),
      customFields: Object.fromEntries(
        Object.entries(custom).filter(([, v]) => v.trim() !== "")
      ),
    });
    setSaving(false);
    if (!ok) {
      toast.error("Não foi possível salvar o contato — tente novamente");
      return;
    }
    toast.success("Contato criado");
    setForm({
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      doc: "",
      company: "",
      tags: "",
    });
    setCustom({});
    onCreated?.();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Adicionar contato</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Nome *</Label>
            <Input value={form.firstName} onChange={set("firstName")} className="h-8" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Sobrenome *</Label>
            <Input value={form.lastName} onChange={set("lastName")} className="h-8" />
          </div>
          <div className="col-span-2 space-y-1">
            <Label className="text-xs">E-mail</Label>
            <Input type="email" value={form.email} onChange={set("email")} className="h-8" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Telefone</Label>
            <Input value={form.phone} onChange={set("phone")} className="h-8" />
          </div>
          <div className="space-y-1">
            {/* Chave principal do cruzamento com a Guru (migração 0048). */}
            <Label className="text-xs">CPF/CNPJ</Label>
            <Input
              value={form.doc}
              onChange={set("doc")}
              placeholder="000.000.000-00"
              className="h-8"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Empresa</Label>
            <Input value={form.company} onChange={set("company")} className="h-8" />
          </div>
          <div className="col-span-2 space-y-1">
            <Label className="text-xs">Tags (separadas por vírgula)</Label>
            <Input
              value={form.tags}
              onChange={set("tags")}
              className="h-8"
              placeholder="quente, negociando"
            />
          </div>
          <div className="col-span-2 grid grid-cols-2 gap-3">
            <CustomFieldsInputs
              fields={fields}
              values={custom}
              onChange={(name, value) => setCustom((c) => ({ ...c, [name]: value }))}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? "Salvando..." : "Salvar contato"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
