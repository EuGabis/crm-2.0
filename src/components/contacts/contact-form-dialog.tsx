"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
  const router = useRouter();

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  /**
   * Aviso de duplicado com CAMINHO para o contato existente.
   *
   * Dizer só "já existe" deixa a pessoa procurando à mão numa base de 41 mil —
   * e foi o que ela tentou evitar cadastrando de novo.
   */
  const avisarDuplicado = (nome: string, id: string) => {
    toast.error(
      nome
        ? `Já existe um contato com esse telefone: ${nome}`
        : "Já existe um contato com esse telefone",
      {
        action: {
          label: "Abrir contato",
          onClick: () => {
            onOpenChange(false);
            router.push(`/contatos/${id}`);
          },
        },
        duration: 8000,
      },
    );
  };

  const submit = async () => {
    if (!form.firstName.trim()) {
      toast.error("O nome é obrigatório");
      return;
    }
    if (form.phone.trim()) {
      const dup = await dbContactActions.findByPhone(form.phone);
      if (dup) {
        // Nomear o contato não basta: quem tentou cadastrar quer CHEGAR nele.
        avisarDuplicado(`${dup.firstName} ${dup.lastName}`.trim(), dup.id);
        return;
      }
    }
    setSaving(true);
    const res = await dbContactActions.add({
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
    /*
     * ⚠️ Antes era `if (!ok)` sobre um booleano, e "duplicado" e "falhou" caíam
     * na MESMA frase: "tente novamente". No duplicado esse conselho é impossível
     * de seguir — repetir encontra o mesmo contato para sempre. Foi o sintoma
     * relatado, e a checagem prévia acima não pegava porque `findByPhone`
     * procurava no array do store, que hoje vive vazio.
     *
     * Este ramo é a segunda barreira: mesmo que a checagem prévia falhe, a
     * mensagem sai certa, porque o motivo vem do repo.
     */
    if (!res.ok) {
      if (res.motivo === "duplicado") {
        const dup = await dbContactActions.findByPhone(form.phone);
        avisarDuplicado(dup ? `${dup.firstName} ${dup.lastName}`.trim() : "", res.existingId);
      } else {
        toast.error(res.erro ? `Não foi possível salvar: ${res.erro}` : "Não foi possível salvar o contato");
      }
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
            <Label className="text-xs">Sobrenome</Label>
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
