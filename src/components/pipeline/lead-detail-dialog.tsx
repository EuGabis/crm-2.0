"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  BadgeCheck,
  CalendarClock,
  CheckSquare,
  CreditCard,
  ExternalLink,
  MessageSquare,
  Repeat,
  ShieldQuestion,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { GuruStatusBadge } from "@/components/payments/status-badge";
import { contactName } from "@/lib/data/repos/contacts";
import { useDbContact, useDbTeam } from "@/lib/data/repos/db/contacts";
import { useContactsModule } from "@/lib/data/repos/db/contacts-module";
import { conversationActions } from "@/lib/data/repos/db/conversations";
import { useDbAppointments } from "@/lib/data/repos/db/appointments";
import {
  attemptedKeys,
  MATCH_KEY_LABEL,
  useLeadPaymentProfile,
  type LeadPaymentProfile,
} from "@/lib/data/repos/db/lead-payments";
import { useContactNotes } from "@/lib/data/repos/db/notes";
import { usePipelineDb } from "@/lib/data/repos/db/pipeline";
import { useMyMembership } from "@/lib/data/repos/db/team";
import { formatBRL } from "@/lib/data/repos/opportunities";
import type { Contact, Opportunity } from "@/lib/data/types";

/**
 * Detalhe do lead — o que abre ao clicar no card do funil.
 *
 * Junta três coisas que hoje moram em telas diferentes: o contato (Contatos), o
 * histórico de compra do MESMO comprador na Guru (Pagamentos) e os comentários
 * internos (Conversas). O cruzamento com a Guru é feito no banco
 * (`lead_payment_profile`, migração 0048) na ordem CPF → telefone → e-mail →
 * nome, e a aba mostra QUAL chave casou: sem esse rótulo, "casou pelo nome"
 * (homônimo) pareceria a mesma coisa que "casou pelo CPF".
 *
 * A aba Pagamentos só existe para quem enxerga o módulo Pagamentos — a
 * permissão vem de `useMyMembership().can`, igual à sidebar.
 */

function DataRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b py-1.5 last:border-0">
      <dt className="shrink-0 text-[11px] text-slate-500">{label}</dt>
      <dd className="min-w-0 truncate text-right text-xs font-medium text-slate-800">
        {value}
      </dd>
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border bg-white p-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 text-sm font-bold text-slate-900">{value}</p>
      {hint && <p className="text-[10px] text-slate-400">{hint}</p>}
    </div>
  );
}

const fmtDate = (v: string | null | undefined, withTime = false) =>
  v
    ? format(new Date(v), withTime ? "dd/MM/yyyy HH:mm" : "dd/MM/yyyy", { locale: ptBR })
    : "—";

/** Documento só de dígitos vindo da Guru fica ilegível; formata CPF/CNPJ. */
function formatDoc(raw: string | null | undefined): string {
  const d = (raw ?? "").replace(/\D/g, "");
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (d.length === 14)
    return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return raw?.trim() || "—";
}

/* ------------------------------ aba Pagamentos ------------------------------ */

function PaymentsTab({
  contact,
  profile,
  loading,
  error,
}: {
  contact: Contact;
  profile: LeadPaymentProfile;
  loading: boolean;
  error: string | null;
}) {
  const totals = profile.totals;

  if (loading) {
    return <p className="p-6 text-center text-xs text-slate-400">Cruzando com a Guru…</p>;
  }

  if (error) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <p className="text-xs font-semibold text-amber-900">Não foi possível cruzar</p>
        <p className="mt-1 text-[11px] text-amber-800">{error}</p>
      </div>
    );
  }

  if (!profile.matchKey) {
    const tried = attemptedKeys(contact);
    return (
      <div className="rounded-lg border bg-slate-50 p-5 text-center">
        <ShieldQuestion className="mx-auto size-6 text-slate-300" />
        <p className="mt-2 text-xs font-semibold text-slate-700">
          Nenhuma compra encontrada na Guru para este contato
        </p>
        <p className="mt-1 text-[11px] text-slate-500">
          {tried.length > 0
            ? `Tentamos casar por ${tried.map((k) => MATCH_KEY_LABEL[k]).join(", ")}.`
            : "O contato não tem CPF, telefone, e-mail nem nome para casar."}
        </p>
        {!contact.doc?.trim() && (
          <p className="mt-2 text-[11px] text-slate-500">
            O CPF/CNPJ é a chave mais confiável — preencha no cadastro do contato para
            melhorar o cruzamento.
          </p>
        )}
      </div>
    );
  }

  const g = profile.guruContact;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="gap-1 bg-indigo-100 text-indigo-700">
          <BadgeCheck className="size-3" />
          Casado por {MATCH_KEY_LABEL[profile.matchKey]}
        </Badge>
        {profile.matchKey === "name" && (
          <span className="text-[10px] text-amber-700">
            Chave fraca — confirme que não é homônimo antes de agir sobre esses dados.
          </span>
        )}
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Kpi
          label="Total aprovado"
          value={formatBRL(totals?.approvedTotal ?? 0)}
          hint={`${totals?.approvedCount ?? 0} venda(s) aprovada(s)`}
        />
        <Kpi
          label="Vendas"
          value={String(totals?.salesCount ?? 0)}
          hint={`1ª em ${fmtDate(totals?.firstSaleAt)}`}
        />
        <Kpi
          label="Assinaturas ativas"
          value={String(totals?.activeSubs ?? 0)}
          hint={`${profile.subscriptions.length} no total`}
        />
        <Kpi
          label="Reembolsos"
          value={formatBRL(totals?.refundedTotal ?? 0)}
          hint={`${totals?.refundedCount ?? 0} ocorrência(s)`}
        />
      </div>

      {g && (
        <div className="rounded-lg border bg-white p-3">
          <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">
            Contato na Guru
          </p>
          <dl className="grid gap-x-6 sm:grid-cols-2">
            <DataRow label="Nome" value={g.name ?? "—"} />
            <DataRow label="CPF/CNPJ" value={formatDoc(g.doc)} />
            <DataRow label="E-mail" value={g.email ?? "—"} />
            <DataRow label="Telefone" value={g.phone ?? "—"} />
          </dl>
        </div>
      )}

      <div>
        <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-slate-700">
          <CreditCard className="size-3.5 text-slate-400" /> Vendas
          {profile.sales.length > 0 && (
            <span className="text-[10px] font-normal text-slate-400">
              ({profile.sales.length}
              {(totals?.salesCount ?? 0) > profile.sales.length
                ? ` de ${totals?.salesCount}`
                : ""}
              )
            </span>
          )}
        </p>
        {profile.sales.length === 0 ? (
          <p className="rounded-lg border bg-slate-50 p-3 text-[11px] text-slate-500">
            Nenhuma venda registrada.
          </p>
        ) : (
          <div className="max-h-64 overflow-y-auto rounded-lg border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-50 text-left text-[10px] uppercase text-slate-400">
                <tr>
                  <th className="px-2 py-1.5 font-bold">Produto</th>
                  <th className="px-2 py-1.5 font-bold">Status</th>
                  <th className="px-2 py-1.5 text-right font-bold">Valor</th>
                  <th className="px-2 py-1.5 font-bold">Data</th>
                </tr>
              </thead>
              <tbody>
                {profile.sales.map((s) => (
                  <tr key={s.id} className="border-t">
                    <td className="max-w-[220px] truncate px-2 py-1.5 text-slate-700">
                      {s.productName ?? "—"}
                    </td>
                    <td className="px-2 py-1.5">
                      <GuruStatusBadge status={s.status} />
                    </td>
                    <td className="px-2 py-1.5 text-right font-semibold text-slate-800">
                      {s.amount === null ? "—" : formatBRL(s.amount)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-slate-500">
                      {fmtDate(s.guruCreatedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-slate-700">
          <Repeat className="size-3.5 text-slate-400" /> Assinaturas
        </p>
        {profile.subscriptions.length === 0 ? (
          <p className="rounded-lg border bg-slate-50 p-3 text-[11px] text-slate-500">
            Nenhuma assinatura.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {profile.subscriptions.map((s) => (
              <li key={s.id} className="rounded-lg border bg-white p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-800">
                    {s.productName ?? "—"}
                  </span>
                  <GuruStatusBadge status={s.status} />
                </div>
                <p className="mt-0.5 text-[10px] text-slate-500">
                  {s.amount === null ? "" : `${formatBRL(s.amount)} · `}
                  {s.chargedTimes ?? 0} cobrança(s)
                  {s.chargedEveryDays ? ` a cada ${s.chargedEveryDays} dias` : ""} · início{" "}
                  {fmtDate(s.guruStartedAt)}
                  {s.nextCycleAt ? ` · próximo ciclo ${fmtDate(s.nextCycleAt)}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ------------------------------ corpo do diálogo ---------------------------- */

function LeadDetailBody({
  opportunity,
  onOpenChange,
}: {
  opportunity: Opportunity;
  onOpenChange: (v: boolean) => void;
}) {
  const router = useRouter();
  const { contact } = useDbContact(opportunity.contactId);
  const team = useDbTeam();
  const { pipelines, opportunities } = usePipelineDb();
  const { tasks } = useContactsModule();
  const { appointments } = useDbAppointments();
  const { can } = useMyMembership();
  const canPayments = can("pagamentos");

  const { profile, loading: loadingPayments, error: paymentsError } = useLeadPaymentProfile(
    contact,
    canPayments,
  );
  const { notes, reload: reloadNotes } = useContactNotes(opportunity.contactId);

  const [tab, setTab] = useState("resumo");
  const [note, setNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  const pipeline = pipelines.find((p) => p.id === opportunity.pipelineId);
  const stage = pipeline?.stages.find((s) => s.id === opportunity.stageId);
  const owner = team.find((u) => u.id === opportunity.ownerId);

  const otherOpps = useMemo(
    () =>
      opportunities.filter(
        (o) => o.contactId === opportunity.contactId && o.id !== opportunity.id,
      ),
    [opportunities, opportunity.contactId, opportunity.id],
  );
  const contactTasks = useMemo(
    () => tasks.filter((t) => t.contactId === opportunity.contactId),
    [tasks, opportunity.contactId],
  );
  const leadAppointments = useMemo(
    () =>
      appointments
        .filter(
          (a) =>
            a.opportunityId === opportunity.id ||
            (!!opportunity.contactId && a.contactId === opportunity.contactId),
        )
        .sort((a, b) => b.start.localeCompare(a.start)),
    [appointments, opportunity.id, opportunity.contactId],
  );

  const saveNote = async () => {
    const body = note.trim();
    if (!body || !contact) return;
    setSavingNote(true);
    const conversationId = await conversationActions.openForContact(contact.id);
    const ok =
      !!conversationId &&
      (await conversationActions.send(conversationId, {
        direction: "out",
        type: "text",
        channel: "whatsapp",
        body,
        internal: true,
      }));
    setSavingNote(false);
    if (!ok) {
      toast.error("Não foi possível salvar o comentário");
      return;
    }
    setNote("");
    await reloadNotes();
    toast.success("Comentário registrado");
  };

  const openConversation = async () => {
    if (!contact) return;
    const id = await conversationActions.openForContact(contact.id);
    if (!id) {
      toast.error("Não foi possível abrir a conversa");
      return;
    }
    onOpenChange(false);
    router.push(`/conversas?c=${id}`);
  };

  return (
    <Tabs
      value={tab}
      onValueChange={(v) => setTab((v as string) ?? "resumo")}
      className="flex min-h-0 flex-1 flex-col"
    >
      <TabsList variant="line" className="w-full shrink-0 border-b">
        <TabsTrigger value="resumo" className="text-xs">
          Resumo
        </TabsTrigger>
        {canPayments && (
          <TabsTrigger value="pagamentos" className="text-xs">
            Pagamentos
            {profile.matchKey ? ` (${profile.totals?.salesCount ?? 0})` : ""}
          </TabsTrigger>
        )}
        <TabsTrigger value="comentarios" className="text-xs">
          Comentários{notes.length > 0 ? ` (${notes.length})` : ""}
        </TabsTrigger>
      </TabsList>

      {/* ---------------- Resumo ---------------- */}
      <TabsContent value="resumo" className="mt-4 space-y-4 overflow-y-auto">
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-lg border bg-white p-3">
            <div className="mb-1 flex items-center justify-between">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                Contato
              </p>
              {contact && (
                <Link
                  href={`/contatos/${contact.id}`}
                  className="inline-flex items-center gap-1 text-[10px] font-semibold text-indigo-600 hover:underline"
                >
                  Abrir cadastro <ExternalLink className="size-2.5" />
                </Link>
              )}
            </div>
            {!contact ? (
              <p className="text-xs text-slate-500">
                Este lead não tem contato vinculado.
              </p>
            ) : (
              <>
                <dl>
                  <DataRow label="Nome" value={contactName(contact)} />
                  <DataRow label="CPF/CNPJ" value={formatDoc(contact.doc)} />
                  <DataRow label="Telefone" value={contact.phone || "—"} />
                  <DataRow label="E-mail" value={contact.email || "—"} />
                  <DataRow label="Empresa" value={contact.company ?? "—"} />
                  <DataRow
                    label="Última atividade"
                    value={fmtDate(contact.lastActivityAt, true)}
                  />
                </dl>
                {contact.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {contact.tags.map((t) => (
                      <Badge key={t} variant="secondary" className="text-[10px]">
                        {t}
                      </Badge>
                    ))}
                  </div>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3 h-7 w-full gap-1.5 text-xs"
                  onClick={() => void openConversation()}
                >
                  <MessageSquare className="size-3.5" /> Abrir conversa
                </Button>
              </>
            )}
          </div>

          <div className="rounded-lg border bg-white p-3">
            <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">
              Lead
            </p>
            <dl>
              <DataRow label="Funil" value={pipeline?.name ?? "—"} />
              <DataRow
                label="Fase"
                value={
                  stage ? (
                    <span style={{ color: stage.color }}>{stage.name}</span>
                  ) : (
                    "—"
                  )
                }
              />
              <DataRow label="Valor" value={formatBRL(opportunity.value)} />
              <DataRow label="Fonte" value={opportunity.source} />
              <DataRow
                label="Status"
                value={
                  opportunity.status === "open"
                    ? "Aberta"
                    : opportunity.status === "won"
                      ? "Ganha"
                      : "Perdida"
                }
              />
              <DataRow label="Responsável" value={owner?.name ?? "—"} />
              <DataRow label="Criado em" value={fmtDate(opportunity.createdAt)} />
            </dl>
          </div>
        </div>

        {otherOpps.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-semibold text-slate-700">
              Outros leads deste contato
            </p>
            <ul className="space-y-1.5">
              {otherOpps.map((o) => {
                const p = pipelines.find((x) => x.id === o.pipelineId);
                const st = p?.stages.find((x) => x.id === o.stageId);
                return (
                  <li
                    key={o.id}
                    className="flex items-center justify-between gap-2 rounded-lg border bg-white p-2.5 text-xs"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium text-slate-800">{o.name}</span>
                      <span className="text-slate-400">
                        {" "}
                        · {p?.name}
                        {st ? ` › ${st.name}` : ""}
                      </span>
                    </span>
                    <span className="font-semibold text-slate-700">
                      {formatBRL(o.value)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div className="grid gap-3 lg:grid-cols-2">
          <div>
            <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-slate-700">
              <CheckSquare className="size-3.5 text-slate-400" /> Tarefas
            </p>
            {contactTasks.length === 0 ? (
              <p className="rounded-lg border bg-slate-50 p-3 text-[11px] text-slate-500">
                Nenhuma tarefa para este contato.
              </p>
            ) : (
              <ul className="space-y-1">
                {contactTasks.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-center justify-between gap-2 rounded-lg border bg-white p-2 text-xs"
                  >
                    <span
                      className={
                        t.status === "done"
                          ? "min-w-0 flex-1 truncate text-slate-400 line-through"
                          : "min-w-0 flex-1 truncate text-slate-700"
                      }
                    >
                      {t.title}
                    </span>
                    <span className="shrink-0 text-[10px] text-slate-400">
                      {t.dueAt ? fmtDate(t.dueAt) : "sem prazo"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-slate-700">
              <CalendarClock className="size-3.5 text-slate-400" /> Compromissos
            </p>
            {leadAppointments.length === 0 ? (
              <p className="rounded-lg border bg-slate-50 p-3 text-[11px] text-slate-500">
                Nenhum compromisso.
              </p>
            ) : (
              <ul className="space-y-1">
                {leadAppointments.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center justify-between gap-2 rounded-lg border bg-white p-2 text-xs"
                  >
                    <span className="min-w-0 flex-1 truncate text-slate-700">{a.title}</span>
                    <span className="shrink-0 text-[10px] text-slate-400">
                      {fmtDate(a.start, true)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </TabsContent>

      {/* ---------------- Pagamentos ---------------- */}
      {canPayments && (
        <TabsContent value="pagamentos" className="mt-4 overflow-y-auto">
          {contact ? (
            <PaymentsTab
              contact={contact}
              profile={profile}
              loading={loadingPayments}
              error={paymentsError}
            />
          ) : (
            <p className="rounded-lg border bg-slate-50 p-4 text-xs text-slate-500">
              Sem contato vinculado, não há como cruzar com a Guru.
            </p>
          )}
        </TabsContent>
      )}

      {/* ---------------- Comentários ---------------- */}
      <TabsContent value="comentarios" className="mt-4 space-y-3 overflow-y-auto">
        <div className="space-y-1.5">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="O que ficou combinado com esse lead?"
            className="min-h-16 text-xs"
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] text-slate-400">
              Fica como comentário interno na conversa do contato — o cliente não vê.
            </p>
            <Button
              size="sm"
              className="h-7 shrink-0 text-xs"
              disabled={savingNote || !note.trim() || !contact}
              onClick={() => void saveNote()}
            >
              {savingNote ? "Salvando…" : "Comentar"}
            </Button>
          </div>
        </div>

        {notes.length === 0 ? (
          <p className="rounded-lg border bg-slate-50 p-4 text-center text-[11px] text-slate-500">
            Nenhum comentário ainda.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {notes.map((n) => (
              <li key={n.id} className="rounded-lg border border-amber-200 bg-amber-50 p-2.5">
                <p className="whitespace-pre-wrap text-xs text-slate-700">{n.body}</p>
                <p className="mt-1 text-[10px] text-amber-700">{fmtDate(n.at, true)}</p>
              </li>
            ))}
          </ul>
        )}
      </TabsContent>
    </Tabs>
  );
}

export function LeadDetailDialog({
  opportunity,
  open,
  onOpenChange,
}: {
  opportunity: Opportunity;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] flex-col overflow-hidden sm:max-w-4xl">
        <DialogHeader className="shrink-0">
          <DialogTitle className="truncate pr-6 text-base">{opportunity.name}</DialogTitle>
        </DialogHeader>
        {/* Só monta quando abre: os hooks de dentro disparam consultas (cruzamento
            com a Guru, comentários) que não devem rodar para cada card do funil. */}
        {open && (
          <LeadDetailBody opportunity={opportunity} onOpenChange={onOpenChange} />
        )}
      </DialogContent>
    </Dialog>
  );
}
