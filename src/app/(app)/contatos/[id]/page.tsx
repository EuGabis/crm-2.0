"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ArrowLeft, MessageSquare, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ChannelIcon } from "@/components/shared/channel-icon";
import { ContactConversations } from "@/components/contacts/contact-conversations";
import { CustomFieldsInputs } from "@/components/contacts/custom-fields-inputs";
import { TagBadges } from "@/components/contacts/tag-badges";
import { contactName } from "@/lib/data/repos/contacts";
import { dbContactActions, useDbContact, useDbTeam } from "@/lib/data/repos/db/contacts";
import { conversationActions } from "@/lib/data/repos/db/conversations";
import { ContactPaymentsPanel, formatDoc } from "@/components/payments/lead-payments-panel";
import { useContactsModule } from "@/lib/data/repos/db/contacts-module";
import { usePipelineDb } from "@/lib/data/repos/db/pipeline";
import { formatBRL } from "@/lib/data/repos/opportunities";

export default function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { contact, loading, refresh } = useDbContact(id);
  const team = useDbTeam();
  const [openingChat, setOpeningChat] = useState(false);
  const [salvandoDono, setSalvandoDono] = useState(false);
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

  /*
   * 🔴 Trocar o proprietário passou a ser AÇÃO DE PESSOA, e é o outro lado da
   * 202609111030: a transferência de conversa deixou de reescrever este campo,
   * então sem um seletor aqui ele ficaria congelado em quem inseriu o contato.
   *
   * ⚠️ Não é admin-only: a RLS de `contacts` autoriza qualquer membro a editar
   * (UPDATE olha só `location_id`), e transferir conversa também é de qualquer
   * um desde a 202609041530 — travar só a tela daria a impressão de proteção
   * sem proteger nada.
   *
   * ⚠️ `refresh()` no fim não é enfeite: nesta tela o contato quase nunca vem da
   * store (o inbox parou de carregar os 40 mil), então o `setContacts` do repo
   * atualiza um array que ninguém aqui está lendo — foi exatamente assim que a
   * etiqueta gravava no banco e o seletor continuava mostrando o valor antigo.
   */
  const trocarDono = async (novoDono: string) => {
    if (novoDono === (contact.ownerId ?? "")) return;
    setSalvandoDono(true);
    const ok = await dbContactActions.update(contact.id, { ownerId: novoDono });
    setSalvandoDono(false);
    if (!ok) {
      toast.error("Não foi possível trocar o proprietário");
      return;
    }
    const nome = team.find((u) => u.id === novoDono)?.name;
    toast.success(nome ? `Proprietário: ${nome}` : "Proprietário removido");
    refresh();
  };

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
    // WhatsApp precisa de telefone. Avisa aqui (cedo) em vez de deixar o envio do
    // template falhar depois com "Contato sem telefone".
    if (!contact.phone?.trim()) {
      toast.error("Contato sem telefone — adicione um número em Editar para conversar no WhatsApp.");
      return;
    }
    setOpeningChat(true);
    const res = await conversationActions.openForContact(contact.id);
    setOpeningChat(false);
    if (!res.id) {
      toast.error(res.error ?? "Não foi possível abrir a conversa");
      return;
    }
    router.push(`/conversas?c=${res.id}`);
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
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
              <ChannelIcon channel={contact.lastActivityChannel} size={14} />
              <span>{contact.company ?? "Sem empresa"} ·</span>
              <span className="inline-flex items-center gap-1">
                Proprietário:
                {/*
                  ⚠️ `<select>` nativo, como no "Atribuir…" do Relatório e no
                  seletor de curso: são dezenas de nomes, e o nativo dá busca por
                  digitação e a rolagem do sistema de graça.
                */}
                <select
                  value={contact.ownerId ?? ""}
                  onChange={(e) => void trocarDono(e.target.value)}
                  disabled={salvandoDono}
                  title="O vendedor que cuida deste contato. Não muda quando a conversa é transferida para outro setor."
                  className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-xs font-medium text-slate-700 disabled:opacity-60"
                >
                  <option value="">sem proprietário</option>
                  {/*
                    ⚠️ O dono ATUAL entra na lista mesmo que a equipe ainda não
                    tenha carregado. Sem isto o `value` não casaria com nenhuma
                    opção, o React desenharia "sem proprietário" num contato que
                    TEM dono, e a tela mentiria sobre o dado — a mesma armadilha
                    de campo controlado que o seletor de lead do calendário teve.
                  */}
                  {contact.ownerId && !owner ? (
                    <option value={contact.ownerId}>Carregando...</option>
                  ) : null}
                  {team.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </span>
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
                  ["CPF/CNPJ", contact.doc ? formatDoc(contact.doc) : "—"],
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
              <TagBadges tags={contact.tags} className="mt-3 flex flex-wrap gap-1" />
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
                      {" · "}
                      {/*
                        ⚠️ O responsável é a informação que faltava aqui (pedido
                        do Gabriel, 2026-09-10): sem ele, quem abre o contato vê
                        em que fase o lead está e não vê COM QUEM ele está — e é
                        essa a pergunta de quem atende o cliente que ligou.

                        "Sem responsável" é escrito, não omitido: um lead do funil
                        sem dono é justamente o que precisa aparecer.
                      */}
                      Responsável:{" "}
                      <span className={o.ownerId ? "text-slate-600" : "text-amber-600"}>
                        {o.ownerId
                          ? (team.find((u) => u.id === o.ownerId)?.name ?? "Carregando...")
                          : "sem responsável"}
                      </span>
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <div className="mt-4">
        <ContactConversations contactId={contact.id} contatoNome={contactName(contact)} />
      </div>

      <div className="mt-4">
        <ContactPaymentsPanel contact={contact} />
      </div>
    </div>
  );
}
