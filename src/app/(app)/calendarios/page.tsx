"use client";

import { useMemo, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { SubNav } from "@/components/layout/subnav";
import { WeekCalendar } from "@/components/modules/week-calendar";
import { Badge } from "@/components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { appointmentActions, useDbAppointments } from "@/lib/data/repos/db/appointments";
import { useDbContacts } from "@/lib/data/repos/db/contacts";
import { useDbOpportunities, useDbPipelines } from "@/lib/data/repos/db/pipeline";
import { useDbTeam } from "@/lib/data/repos/db/contacts";
import { useMyMembership } from "@/lib/data/repos/db/team";
import { contactName } from "@/lib/data/repos/contacts";
import type { Appointment, Opportunity } from "@/lib/data/types";
import { cn } from "@/lib/utils";

import { useConfirm } from "@/components/shared/confirm";
/*
 * 🗑️ **A aba "Configurações" SAIU** (03/09/2026, a pedido do Gabriel: "só vamos
 * deixar sem o mock").
 *
 * Ela prometia três coisas e não entregava nenhuma:
 *   * "Calendários conectados" (Google Calendar) — conta inventada com selo
 *     "Conectado" e botões respondendo `toast.info`. Removida no commit anterior;
 *   * "Disponibilidade padrão" — tarjas vindas de uma constante no código, não
 *     editáveis;
 *   * "Duração padrão da reunião" — select num `useState` que morria ao trocar de
 *     página;
 *   * "Lembrete via WhatsApp" (24h e 10min antes) — nada disso existe: não há
 *     rota, agendamento nem template. O "Salvar" respondia
 *     `toast.success("salvas")` sem salvar.
 *
 * ⚠️ **Tela que promete e não entrega é pior do que tela ausente**: alguém
 * configura, lê "salvas", e conta com o lembrete que nunca vai sair. Mesma
 * decisão do Canva, do webphone e do checklist de ativação — o que não funciona
 * sai, e o histórico do git guarda.
 *
 * ⚠️ **O que É real continua onde estava, e não se confunda:**
 * `appointments.reminder_minutes` (0042) e `tasks.reminder_minutes` (0050) geram
 * o popup DENTRO do CRM (`components/calendar/reminders.tsx`), escolhido por
 * compromisso no próprio diálogo. Isso funciona.
 *
 * A versão real desta aba (disponibilidade por atendente, com migração e testes)
 * chegou a ser escrita e foi cancelada a pedido dele — está no commit 480288e se
 * um dia voltar.
 */
const TABS = [
  { label: "Visualização de calendário" },
  { label: "Lista de compromissos" },
];

/* -------------------------- Lista de compromissos ------------------------ */

function ListaCompromissos({
  onNew,
  onEdit,
}: {
  onNew: () => void;
  onEdit: (a: Appointment) => void;
}) {
  const confirm = useConfirm();
  const { appointments } = useDbAppointments();
  const { contacts } = useDbContacts();
  const opportunities = useDbOpportunities();
  const team = useDbTeam();
  const { isAdmin } = useMyMembership();
  const [filtro, setFiltro] = useState<"Futuro" | "Passado">("Futuro");
  // Só admin escolhe de quem é a agenda: os demais já recebem só a própria
  // (a RLS da 0043 filtra), então o seletor não teria o que oferecer.
  const [owner, setOwner] = useState(ALL);

  const remove = async (id: string, title: string) => {
    if (!(await confirm({ title: `Excluir o compromisso "${title}"?`, confirmLabel: "Excluir", destructive: true }))) return;
    (await appointmentActions.remove(id))
      ? toast.success("Compromisso excluído")
      : toast.error("Não foi possível excluir");
  };

  const rows = useMemo(() => {
    const byId = new Map(contacts.map((c) => [c.id, contactName(c)]));
    const now = Date.now();
    return appointments
      .map((a) => ({
        ...a,
        startDate: new Date(a.start),
        contato: a.contactId ? byId.get(a.contactId) ?? "—" : "—",
        lead: a.opportunityId
          ? opportunities.find((o) => o.id === a.opportunityId)?.name ?? "—"
          : "—",
        agenda: a.ownerId
          ? team.find((u) => u.id === a.ownerId)?.name ?? "—"
          : "Empresa",
      }))
      .filter((a) => (owner === ALL ? true : owner === SHARED ? !a.ownerId : a.ownerId === owner))
      .filter((a) => (filtro === "Futuro" ? a.startDate.getTime() >= now : a.startDate.getTime() < now))
      .sort((a, b) =>
        filtro === "Futuro"
          ? a.startDate.getTime() - b.startDate.getTime()
          : b.startDate.getTime() - a.startDate.getTime()
      );
  }, [appointments, contacts, opportunities, team, filtro, owner]);

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Lista de compromissos</h1>
          <p className="text-xs text-slate-500">
            Todos os agendamentos sincronizados, em formato de lista
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Select value={owner} onValueChange={(v) => setOwner(v ?? ALL)}>
              <SelectTrigger className="h-8 w-[170px] text-xs">
                <SelectValue>
                  {owner === ALL
                    ? "Todas as agendas"
                    : owner === SHARED
                      ? "Agenda da empresa"
                      : (team.find((u) => u.id === owner)?.name ?? "Agenda")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL} className="text-xs">
                  Todas as agendas
                </SelectItem>
                <SelectItem value={SHARED} className="text-xs">
                  Agenda da empresa
                </SelectItem>
                {team.map((u) => (
                  <SelectItem key={u.id} value={u.id} className="text-xs">
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <div className="flex gap-1">
            {(["Futuro", "Passado"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFiltro(f)}
                className={cn(
                  "rounded-full px-3 py-1 text-[11px] font-medium",
                  filtro === f ? "bg-indigo-100 text-indigo-700" : "text-slate-500 hover:bg-slate-100"
                )}
              >
                {f}
              </button>
            ))}
          </div>
          <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={onNew}>
            <Plus className="size-3.5" /> Novo compromisso
          </Button>
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b text-[11px] text-slate-400">
              <th className="whitespace-nowrap px-4 py-2.5 font-medium">Título</th>
              <th className="whitespace-nowrap px-4 py-2.5 font-medium">Data e hora</th>
              <th className="whitespace-nowrap px-4 py-2.5 font-medium">Calendário</th>
              <th className="whitespace-nowrap px-4 py-2.5 font-medium">Origem</th>
              <th className="whitespace-nowrap px-4 py-2.5 font-medium">Contato</th>
              <th className="whitespace-nowrap px-4 py-2.5 font-medium">Lead</th>
              <th className="whitespace-nowrap px-4 py-2.5 font-medium">Agenda</th>
              <th className="w-10 px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr
                key={a.id}
                onClick={() => onEdit(a)}
                title="Clique para editar"
                className="cursor-pointer border-b last:border-0 hover:bg-slate-50"
              >
                <td className="whitespace-nowrap px-4 py-2.5 font-medium text-slate-800">
                  {a.title}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">
                  {format(a.startDate, "EEE, dd 'de' MMM · HH:mm", { locale: ptBR })}
                  {" – "}
                  {format(new Date(a.end), "HH:mm", { locale: ptBR })}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">{a.calendar}</td>
                <td className="whitespace-nowrap px-4 py-2.5">
                  <Badge
                    variant="secondary"
                    className={cn(
                      a.source === "google"
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-indigo-100 text-indigo-700"
                    )}
                  >
                    {a.source === "google" ? "Google" : "CRM"}
                  </Badge>
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">{a.contato}</td>
                <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">{a.lead}</td>
                <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">{a.agenda}</td>
                <td className="px-4 py-2.5">
                  <button
                    onClick={(e) => {
                      e.stopPropagation(); // a linha inteira abre a edição
                      remove(a.id, a.title);
                    }}
                    className="text-slate-300 hover:text-red-500"
                    title="Excluir compromisso"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="py-10 text-center text-sm text-slate-500">
                  Nenhum compromisso {filtro === "Futuro" ? "futuro" : "passado"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* --------------------- Compromisso (criar / editar) ---------------------- */

/** Valor do item "sem vínculo" dos selects (ver comentário no uso). */
const NONE = "__none__";

/** Compromisso sem dono: agenda da empresa, todo mundo vê (migração 0043). */
const SHARED = "__shared__";

/** Filtro "todas as agendas" (só admin recebe mais de uma). */
const ALL = "__all__";

/** Antecedência do lembrete dentro do CRM (migração 0042). */
const REMINDERS: { value: string; label: string }[] = [
  { value: NONE, label: "Sem lembrete" },
  { value: "0", label: "Na hora do compromisso" },
  { value: "5", label: "5 minutos antes" },
  { value: "10", label: "10 minutos antes" },
  { value: "15", label: "15 minutos antes" },
  { value: "30", label: "30 minutos antes" },
  { value: "60", label: "1 hora antes" },
  { value: "120", label: "2 horas antes" },
  { value: "1440", label: "1 dia antes" },
];

export interface AppointmentDraft {
  /** Compromisso em edição; null = criando. */
  appointment: Appointment | null;
  /** Pré-preenchimento vindo do clique numa célula da grade. */
  slot?: { date: string; startTime: string; endTime: string };
}

function AppointmentDialog({
  draft,
  onOpenChange,
}: {
  draft: AppointmentDraft | null;
  onOpenChange: (o: boolean) => void;
}) {
  const confirm = useConfirm();
  const { contacts } = useDbContacts();
  const opportunities = useDbOpportunities();
  const pipelines = useDbPipelines();
  const team = useDbTeam();
  const { isAdmin, me } = useMyMembership();
  const editing = draft?.appointment ?? null;

  const [title, setTitle] = useState("");
  const [contactId, setContactId] = useState("");
  const [opportunityId, setOpportunityId] = useState("");
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [startTime, setStartTime] = useState("10:00");
  const [endTime, setEndTime] = useState("10:45");
  const [reminder, setReminder] = useState<string>(NONE);
  const [ownerId, setOwnerId] = useState("");
  const [saving, setSaving] = useState(false);

  // Espelha o rascunho ao (re)abrir. Ajuste durante o render em vez de efeito:
  // um setState em useEffect só para copiar prop dispara render extra a cada
  // abertura.
  const [snapshot, setSnapshot] = useState<AppointmentDraft | null>(null);
  if (draft && snapshot !== draft) {
    setSnapshot(draft);
    setTitle(editing?.title ?? "");
    setContactId(editing?.contactId ?? "");
    setOpportunityId(editing?.opportunityId ?? "");
    setReminder(
      editing?.reminderMinutes === null || editing?.reminderMinutes === undefined
        ? NONE
        : String(editing.reminderMinutes)
    );
    // Novo compromisso nasce meu; em edição, mantém quem já é o dono
    // (`SHARED` = compromisso da empresa, sem dono).
    setOwnerId(
      editing ? (editing.ownerId ?? SHARED) : (me?.userId ?? SHARED)
    );
    if (editing) {
      const start = new Date(editing.start);
      const end = new Date(editing.end);
      setDate(format(start, "yyyy-MM-dd"));
      setStartTime(format(start, "HH:mm"));
      setEndTime(format(end, "HH:mm"));
    } else if (draft.slot) {
      setDate(draft.slot.date);
      setStartTime(draft.slot.startTime);
      setEndTime(draft.slot.endTime);
    }
  }

  const save = async () => {
    if (!title.trim() || !date || !startTime || !endTime) {
      toast.error("Preencha título, data e horários");
      return;
    }
    if (endTime <= startTime) {
      toast.error("O horário de término precisa ser depois do início");
      return;
    }
    setSaving(true);
    const payload = {
      title: title.trim(),
      contactId: contactId || null,
      opportunityId: opportunityId || null,
      reminderMinutes: reminder === NONE ? null : Number(reminder),
      ownerId: ownerId === SHARED || !ownerId ? null : ownerId,
      start: `${date}T${startTime}:00-03:00`,
      end: `${date}T${endTime}:00-03:00`,
    };
    const ok = editing
      ? await appointmentActions.update(editing.id, payload)
      : await appointmentActions.add(payload);
    setSaving(false);
    if (!ok) {
      toast.error(
        editing ? "Não foi possível salvar o compromisso" : "Não foi possível criar o compromisso"
      );
      return;
    }
    toast.success(editing ? "Compromisso atualizado" : "Compromisso criado");
    onOpenChange(false);
  };

  const removeAppointment = async () => {
    if (!editing) return;
    if (!(await confirm({ title: `Excluir o compromisso "${editing.title}"?`, confirmLabel: "Excluir", destructive: true }))) return;
    if (await appointmentActions.remove(editing.id)) {
      toast.success("Compromisso excluído");
      onOpenChange(false);
    } else {
      toast.error("Não foi possível excluir");
    }
  };

  const opportunityLabel = (o: Opportunity) => {
    const pipe = pipelines.find((p) => p.id === o.pipelineId)?.name;
    return pipe ? `${o.name} · ${pipe}` : o.name;
  };

  return (
    <Dialog open={!!draft} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar compromisso" : "Novo compromisso"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Título *</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex.: Demo Lito CRM — Maria"
              className="h-8"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Contato (opcional)</Label>
            {/* Sentinela "none" em vez de "": um SelectItem de valor vazio não
                é um caso que o Base UI trate — o item nem fica selecionável. */}
            <Select
              value={contactId || NONE}
              onValueChange={(v) => setContactId(!v || v === NONE ? "" : v)}
            >
              <SelectTrigger className="h-8 w-full text-xs">
                <SelectValue>
                  {contactId
                    ? (() => {
                        const c = contacts.find((x) => x.id === contactId);
                        return c ? contactName(c) : "Sem contato vinculado";
                      })()
                    : "Sem contato vinculado"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE} className="text-xs">
                  Sem contato vinculado
                </SelectItem>
                {contacts.slice(0, 100).map((c) => (
                  <SelectItem key={c.id} value={c.id} className="text-xs">
                    {contactName(c)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Lead (opcional)</Label>
            <Select
              value={opportunityId || NONE}
              onValueChange={(v) => {
                const id = !v || v === NONE ? "" : v;
                setOpportunityId(id);
                // Escolher o lead já traz o contato dele quando não havia
                // nenhum — é sempre o mesmo contato, e digitar de novo só
                // criaria chance de vincular a pessoa errada.
                const opp = opportunities.find((o) => o.id === id);
                if (opp && !contactId) setContactId(opp.contactId);
              }}
            >
              <SelectTrigger className="h-8 w-full text-xs">
                <SelectValue>
                  {opportunityId
                    ? (() => {
                        const o = opportunities.find((x) => x.id === opportunityId);
                        return o ? opportunityLabel(o) : "Sem lead vinculado";
                      })()
                    : "Sem lead vinculado"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE} className="text-xs">
                  Sem lead vinculado
                </SelectItem>
                {opportunities.slice(0, 100).map((o) => (
                  <SelectItem key={o.id} value={o.id} className="text-xs">
                    {opportunityLabel(o)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {opportunities.length === 0 && (
              <p className="text-[10px] text-slate-400">
                Nenhum lead no funil ainda — crie em Leads.
              </p>
            )}
          </div>
          {isAdmin && (
            <div className="space-y-1">
              <Label className="text-xs">Agenda de</Label>
              <Select value={ownerId || SHARED} onValueChange={(v) => setOwnerId(v ?? SHARED)}>
                <SelectTrigger className="h-8 w-full text-xs">
                  <SelectValue>
                    {ownerId && ownerId !== SHARED
                      ? (team.find((u) => u.id === ownerId)?.name ?? "Usuário")
                      : "Toda a empresa"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SHARED} className="text-xs">
                    Toda a empresa
                  </SelectItem>
                  {team.map((u) => (
                    <SelectItem key={u.id} value={u.id} className="text-xs">
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-slate-400">
                Só administradores marcam na agenda de outra pessoa.
              </p>
            </div>
          )}
          <div className="space-y-1">
            <Label className="text-xs">Lembrete no CRM</Label>
            <Select value={reminder} onValueChange={(v) => setReminder(v ?? NONE)}>
              <SelectTrigger className="h-8 w-full text-xs">
                <SelectValue>
                  {REMINDERS.find((r) => r.value === reminder)?.label ?? "Sem lembrete"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {REMINDERS.map((r) => (
                  <SelectItem key={r.value} value={r.value} className="text-xs">
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-slate-400">
              Aparece como aviso na tela para quem estiver com o CRM aberto.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Data *</Label>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="h-8"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Início *</Label>
              <Input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="h-8"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Término *</Label>
              <Input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="h-8"
              />
            </div>
          </div>
        </div>
        <DialogFooter className="flex-row items-center justify-between sm:justify-between">
          {editing ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 text-xs text-red-600 hover:text-red-700"
              onClick={removeAppointment}
            >
              <Trash2 className="size-3.5" /> Excluir
            </Button>
          ) : (
            <span />
          )}
          <span className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? "Salvando..." : editing ? "Salvar" : "Criar compromisso"}
            </Button>
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------- Page --------------------------------- */

export default function CalendariosPage() {
  const [tab, setTab] = useState(TABS[0].label);
  const team = useDbTeam();
  const { isAdmin } = useMyMembership();
  const [owner, setOwner] = useState(ALL);
  // Um diálogo só para criar e editar: o rascunho diz qual dos dois é.
  const [draft, setDraft] = useState<AppointmentDraft | null>(null);

  const openNew = () => setDraft({ appointment: null });
  const openSlot = (day: Date, hour: number) =>
    setDraft({
      appointment: null,
      slot: {
        date: format(day, "yyyy-MM-dd"),
        startTime: `${String(hour).padStart(2, "0")}:00`,
        /*
         * ⚠️ 45min é padrão FIXO, e o comentário anterior mentia: dizia "duração
         * padrão sugerida nas Configurações do módulo" — aba que era mock (o
         * select não ia a lugar nenhum) e que saiu em 03/09. Não existe
         * configuração de duração hoje; quem quiser outra troca o horário no
         * diálogo, que é o comportamento real.
         */
        endTime: `${String(hour).padStart(2, "0")}:45`,
      },
    });

  return (
    <div>
      <SubNav tabs={TABS} active={tab} onChange={setTab} />
      <div className="p-6">
        {tab === "Visualização de calendário" ? (
          <>
            <div className="mb-3 flex items-center justify-between">
              <h1 className="text-lg font-bold text-slate-900">Calendários</h1>
              <div className="flex items-center gap-3">
                <p className="text-xs text-slate-500">
                  Clique num horário para criar · clique no evento para editar · arraste para
                  mudar de dia ou hora
                </p>
                {isAdmin && (
                  <Select value={owner} onValueChange={(v) => setOwner(v ?? ALL)}>
                    <SelectTrigger className="h-8 w-[170px] text-xs">
                      <SelectValue>
                        {owner === ALL
                          ? "Todas as agendas"
                          : owner === SHARED
                            ? "Agenda da empresa"
                            : (team.find((u) => u.id === owner)?.name ?? "Agenda")}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL} className="text-xs">
                        Todas as agendas
                      </SelectItem>
                      <SelectItem value={SHARED} className="text-xs">
                        Agenda da empresa
                      </SelectItem>
                      {team.map((u) => (
                        <SelectItem key={u.id} value={u.id} className="text-xs">
                          {u.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={openNew}>
                  <Plus className="size-3.5" /> Novo compromisso
                </Button>
              </div>
            </div>
            <WeekCalendar
              ownerFilter={owner}
              onCreateAt={openSlot}
              onEdit={(appointment) => setDraft({ appointment })}
            />
          </>
        ) : (
          <ListaCompromissos
            onNew={openNew}
            onEdit={(appointment) => setDraft({ appointment })}
          />
        )}
      </div>
      <AppointmentDialog draft={draft} onOpenChange={(o) => !o && setDraft(null)} />
    </div>
  );
}
