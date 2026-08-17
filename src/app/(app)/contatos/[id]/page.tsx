"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ArrowLeft, MessageSquare, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ChannelIcon } from "@/components/shared/channel-icon";
import { CustomFieldsInputs } from "@/components/contacts/custom-fields-inputs";
import { contactName } from "@/lib/data/repos/contacts";
import { dbContactActions, useDbContact, useDbTeam } from "@/lib/data/repos/db/contacts";
import { conversationActions } from "@/lib/data/repos/db/conversations";
import { useContactsModule } from "@/lib/data/repos/db/contacts-module";
import { usePipelineDb } from "@/lib/data/repos/db/pipeline";
import { formatBRL } from "@/lib/data/repos/opportunities";

export default function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { contact, loading } = useDbContact(id);
  const team = useDbTeam();
  const [openingChat, setOpeningChat] = useState(false);
  const { fields } = useContactsModule();
  const { pipelines, opportunities } = usePipelineDb();
  const contactOpps = opportunities.filter((o) => o.contactId === id);

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    doc: "",
    company: "",
  });
  const [custom, setCustom] = useState<Record<string, string>>({});

  useEffect(() => {
    if (contact && !editing) {
      setForm({
        firstName: contact.firstName,
        lastName: contact.lastName,
        email: contact.email,
        phone: contact.phone,
        doc: contact.doc ?? "",
        company: contact.company ?? "",
      });
      setCustom(contact.customFields);
    }
  }, [contact, editing]);

  if (loading) {
    return (
      <div className="p-6">
        <p className="text-sm text-slate-500">Carregando contato...</p>
      </div>
    );
  }

  if (!contact) {
    return (
      <div className="p-6">
        <p className="text-sm text-slate-500">Contato não encontrado.</p>
        <Link href="/contatos" className="text-sm text-indigo-600 hover:underline">
          Voltar para contatos
        </Link>
      </div>
    );
  }

  const owner = team.find((u) => u.id === contact.ownerId);

  const save = async () => {
    if (!form.firstName.trim()) {
      toast.error("O nome é obrigatório");
      return;
    }
    if (form.phone.trim()) {
      const dup = await dbContactActions.findByPhone(form.phone);
      if (dup && dup.id !== contact.id) {
        toast.error(`Já existe um contato com esse número: ${contactName(dup)}`);
        return;
      }
    }
    setSaving(true);
    const ok = await dbContactActions.update(contact.id, {
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      doc: form.doc.trim(),
      company: form.company.trim(),
      customFields: Object.fromEntries(
        Object.entries(custom).filter(([, v]) => String(v).trim() !== "")
      ),
    });
    setSaving(false);
    if (!ok) {
      toast.error("Não foi possível salvar as alterações");
      return;
    }
    toast.success("Contato atualizado");
    setEditing(false);
  };

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  // Abre A conversa deste contato (reaproveita a existente ou cria) e leva o id
  // na URL. Antes era um <Link> estático pra /conversas, que caía na primeira
  // conversa da lista — nunca a do contato clicado.
  const openConversation = async () => {
    setOpeningChat(true);
    const convId = await conversationActions.openForContact(contact.id);
    setOpeningChat(false);
    if (!convId) {
      toast.error("Não foi possível abrir a conversa");
      return;
    }
    router.push(`/conversas?c=${convId}`);
  };

  return (
    <div className="p-6">
      <Link
        href="/contatos"
        className="mb-4 inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="size-3.5" /> Contatos
      </Link>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <Avatar className="size-12">
            <AvatarFallback className="bg-indigo-500 text-base font-bold text-white">
              {(contact.firstName[0] ?? "?").toUpperCase()}
              {(contact.lastName[0] ?? "").toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div>
            <h1 className="text-lg font-bold text-slate-900">{contactName(contact)}</h1>
            <p className="flex items-center gap-2 text-xs text-slate-500">
              <ChannelIcon channel={contact.lastActivityChannel} size={14} />
              {contact.company ?? "Sem empresa"} · Proprietário: {owner?.name ?? "—"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {editing ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={() => setEditing(false)}
              >
                <X className="size-3.5" /> Cancelar
              </Button>
              <Button size="sm" className="h-8 text-xs" onClick={save} disabled={saving}>
                {saving ? "Salvando..." : "Salvar alterações"}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={() => setEditing(true)}
              >
                <Pencil className="size-3.5" /> Editar
              </Button>
              <Button
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={() => void openConversation()}
                disabled={openingChat}
              >
                <MessageSquare className="size-3.5" />
                {openingChat ? "Abrindo..." : "Abrir conversa"}
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Campos do contato</h2>
          {editing ? (
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
                <Input value={form.doc} onChange={set("doc")} className="h-8" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Empresa</Label>
                <Input value={form.company} onChange={set("company")} className="h-8" />
              </div>
              <CustomFieldsInputs
                fields={fields}
                values={custom}
                onChange={(name, value) => setCustom((c) => ({ ...c, [name]: value }))}
              />
            </div>
          ) : (
            <>
              <dl className="space-y-2 text-sm">
                {[
                  ["Nome", contact.firstName],
                  ["Sobrenome", contact.lastName || "—"],
                  ["E-mail", contact.email || "—"],
                  ["Telefone", contact.phone || "—"],
                  ["CPF/CNPJ", contact.doc || "—"],
                  ["Empresa", contact.company ?? "—"],
                  ["DND", contact.dnd ? "Ativado" : "Desativado"],
                  [
                    "Criado em",
                    format(new Date(contact.createdAt), "d 'de' MMMM 'de' yyyy", { locale: ptBR }),
                  ],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4 border-b pb-2 last:border-0">
                    <dt className="text-slate-500">{k}</dt>
                    <dd className="font-medium text-slate-800">{v}</dd>
                  </div>
                ))}
                {Object.entries(contact.customFields).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4 border-b pb-2 last:border-0">
                    <dt className="text-slate-500">{k}</dt>
                    <dd className="font-medium text-slate-800">{v}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-3 flex flex-wrap gap-1">
                {contact.tags.map((t) => (
                  <Badge key={t} variant="secondary" className="text-[10px]">
                    {t}
                  </Badge>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="rounded-xl border bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Oportunidades</h2>
          {contactOpps.length === 0 ? (
            <p className="text-sm text-slate-500">
              Nenhuma oportunidade para este contato — crie uma no módulo Leads.
            </p>
          ) : (
            <ul className="space-y-2">
              {contactOpps.map((o) => {
                const pipeline = pipelines.find((p) => p.id === o.pipelineId);
                const stage = pipeline?.stages.find((s) => s.id === o.stageId);
                return (
                  <li key={o.id} className="rounded-lg border p-3">
                    <p className="text-xs font-semibold text-slate-500">
                      {pipeline?.name} &gt;{" "}
                      <span style={{ color: stage?.color }}>{stage?.name}</span>
                    </p>
                    <div className="mt-1 flex items-center justify-between">
                      <span className="text-sm font-medium text-slate-800">{o.name}</span>
                      <span className="text-sm font-bold text-slate-900">{formatBRL(o.value)}</span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      Fonte: {o.source} · Status:{" "}
                      {o.status === "open" ? "Aberta" : o.status === "won" ? "Ganha" : "Perdida"}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
