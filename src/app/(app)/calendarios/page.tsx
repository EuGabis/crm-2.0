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
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { appointmentActions, useDbAppointments } from "@/lib/data/repos/db/appointments";
import { ContactPicker } from "@/components/contacts/contact-picker";
import { useContactsByIds } from "@/lib/data/repos/db/contacts-search";
import { useDbOpportunities, useDbPipelines } from "@/lib/data/repos/db/pipeline";
import { useDbTeam } from "@/lib/data/repos/db/contacts";
import { useMyMembership } from "@/lib/data/repos/db/team";
import { contactName } from "@/lib/data/repos/contacts";
import type { Appointment, Opportunity } from "@/lib/data/types";
import { cn } from "@/lib/utils";

import { useConfirm } from "@/components/shared/confirm";
const TABS = [
  { label: "Visualização de calendário" },
  { label: "Lista de compromissos" },
  { label: "Configurações" },
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
  /*
   * ⚠️ **Era `useDbContacts()` — os 41.583 contatos da empresa baixados para
   * escrever o nome em ~59 linhas.** É o mesmo defeito que a 0078 corrigiu na
   * tela de Contatos, e o `AGENTS.md` já listava Calendários como pendência
   * dele. `useContactsByIds` busca só os contatos que os compromissos citam,
   * em lotes de 200.
   */
  const contatosPorId = useContactsByIds(appointments.map((a) => a.contactId));
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
    const now = Date.now();
    return appointments
      .map((a) => ({
        ...a,
        startDate: new Date(a.start),
        contato: (() => {
          if (!a.contactId) return "—";
          const c = contatosPorId.get(a.contactId);
          // "Carregando..." e "—" são coisas diferentes: sem isso, o compromisso
          // COM contato aparece como se não tivesse nenhum enquanto a busca não
          // volta — que é exatamente a confusão que este PR conserta.
          return c ? contactName(c) : "Carregando...";
        })(),
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
  }, [appointments, contatosPorId, opportunities, team, filtro, owner]);

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

/* ------------------------------ Configurações ---------------------------- */

const DIAS = [
  { dia: "Seg", horario: "09:00–18:00" },
  { dia: "Ter", horario: "09:00–18:00" },
  { dia: "Qua", horario: "09:00–18:00" },
  { dia: "Qui", horario: "09:00–18:00" },
  { dia: "Sex", horario: "09:00–18:00" },
  { dia: "Sáb", horario: "Indisponível" },
  { dia: "Dom", horario: "Indisponível" },
];

function ConfigCalendarios() {
  const [duracao, setDuracao] = useState("30");
  const [lembrete24h, setLembrete24h] = useState(true);
  const [lembrete10min, setLembrete10min] = useState(true);

  return (
    <>
      <div className="mb-4">
        <h1 className="text-lg font-bold text-slate-900">Configurações de calendário</h1>
        <p className="text-xs text-slate-500">
          Conexões, disponibilidade e lembretes automáticos
        </p>
      </div>
      <div className="grid max-w-4xl gap-4 md:grid-cols-2">
        {/*
          🗑️ **"Calendários conectados" REMOVIDO** (03/09/2026, a pedido do
          Gabriel: "remover essa opção de conectar com o google calendar por
          enquanto").

          Era mock inteiro: o cartão mostrava uma conta inventada
          (`gustavo@litocrm.com.br`, que vem das fixtures) com o selo verde
          **"Conectado"** — afirmação falsa —, e os dois botões respondiam
          `toast.info("chega com o backend")`. Não existe OAuth de Google
          Calendar no CRM: nenhuma rota, nenhuma tabela, nenhuma env.

          Prometer integração que não existe é pior do que não oferecer: alguém
          confia que a agenda está sincronizada e para de conferir. Mesma decisão
          do Canva (código morto sai, o histórico do git guarda) e do interruptor
          falso de resposta automática nas Conversas.

          Se o Google Calendar entrar um dia, o caminho é OAuth por empresa como
          o do Google Ads (`google_ads_connections`, migração 0023) — e aí o selo
          "Conectado" passa a sair do banco, não de um literal.
        */}
        <div className="rounded-xl border bg-white p-5">
          <p className="mb-3 text-xs font-bold text-slate-700">Disponibilidade padrão</p>
          <div className="flex flex-wrap gap-1.5">
            {DIAS.map((d) => (
              <span
                key={d.dia}
                className={cn(
                  "rounded-full px-3 py-1 text-[11px] font-medium",
                  d.horario === "Indisponível"
                    ? "bg-slate-100 text-slate-400"
                    : "bg-indigo-50 text-indigo-700"
                )}
              >
                {d.dia} {d.horario === "Indisponível" ? "—" : d.horario}
              </span>
            ))}
          </div>
          <div className="mt-4 space-y-1">
            <Label className="text-xs">Duração padrão da reunião</Label>
            <Select value={duracao} onValueChange={(v) => v && setDuracao(v)}>
              <SelectTrigger className="h-8 w-44 text-xs">
                <SelectValue>{duracao} minutos</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {["30", "45", "60"].map((m) => (
                  <SelectItem key={m} value={m} className="text-xs">
                    {m} minutos
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="rounded-xl border bg-white p-5 md:col-span-2">
          <p className="mb-3 text-xs font-bold text-slate-700">Lembretes automáticos</p>
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-xs font-semibold text-slate-700">
                  Lembrete via WhatsApp — 24h antes
                </p>
                <p className="text-[11px] text-slate-500">
                  Envia uma mensagem de confirmação ao contato um dia antes da reunião
                </p>
              </div>
              <Switch checked={lembrete24h} onCheckedChange={(v) => setLembrete24h(!!v)} />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-xs font-semibold text-slate-700">
                  Lembrete via WhatsApp — 10min antes
                </p>
                <p className="text-[11px] text-slate-500">
                  Envia o link e os detalhes da reunião minutos antes do início
                </p>
              </div>
              <Switch checked={lembrete10min} onCheckedChange={(v) => setLembrete10min(!!v)} />
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            {/*
              ⚠️ Era `toast.success("Configurações de calendário salvas")` — e
              NADA era salvo: os dois interruptores são `useState`, que morre ao
              trocar de página. Alguém ligava o lembrete de 24h, lia "salvas" e
              acreditava que o cliente seria avisado; não seria, e o resultado é
              falta na reunião.

              A convenção do projeto para ação que depende de backend é
              `toast.info("<ação> chega com o backend")`. O botão fica — é onde a
              ação vai morar — mas para de afirmar o que não fez.
            */}
            <Button
              size="sm"
              className="h-8 text-xs"
              onClick={() =>
                toast.info("Lembrete automático por WhatsApp chega com o backend")
              }
            >
              Salvar
            </Button>
          </div>
        </div>
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
  /*
   * ⚠️ **`useDbContacts()` saiu daqui**: o diálogo baixava os 41.583 contatos da
   * empresa para preencher um seletor que mostrava 100. Quem resolve o nome do
   * contato vinculado agora é o próprio `ContactPicker` (por id, no servidor).
   */
  const opportunities = useDbOpportunities();
  const pipelines = useDbPipelines();
  const team = useDbTeam();
  const { isAdmin, me } = useMyMembership();
  const editing = draft?.appointment ?? null;

  const [title, setTitle] = useState("");
  const [contactId, setContactId] = useState("");
  const [opportunityId, setOpportunityId] = useState("");
  /*
   * Leads DO contato escolhido.
   *
   * ⚠️ O lead já vinculado entra na lista mesmo que não pertença ao contato
   * atual — sem isso, abrir para editar um compromisso e salvar APAGARIA o lead
   * em silêncio, porque o `SelectItem` do valor corrente não existiria. É a
   * armadilha clássica de filtrar a lista de um campo controlado.
   */
  const leadsDoContato = useMemo(() => {
    const doContato = contactId ? opportunities.filter((o) => o.contactId === contactId) : [];
    if (opportunityId && !doContato.some((o) => o.id === opportunityId)) {
      const atual = opportunities.find((o) => o.id === opportunityId);
      if (atual) return [atual, ...doContato];
    }
    return doContato;
  }, [opportunities, contactId, opportunityId]);

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
            {/*
              ⚠️ **Era um `Select` com `contacts.slice(0, 100)` — 100 opções de
              41.583 contatos, sem busca.** E a lista vem ordenada por criação,
              então as 100 eram as mais recentes: o contato que a pessoa quer
              quase nunca está lá.

              O efeito medido: dos 59 compromissos, os 2 sem contato vinculado
              foram criados justamente aqui, e nos dois o atendente digitou o
              NOME DO CONTATO no campo Título — a única coisa que sobrava para
              registrar de quem era a reunião. Foi essa a queixa que chegou
              ("não fica registrado qual é o contato").

              O `ContactPicker` busca no servidor (`search_contacts`, 0078) e
              já existia no repo exatamente para isto. Ele resolve o nome do
              contato já vinculado por id, então editar um compromisso antigo
              mostra o nome certo sem depender de nenhuma lista carregada.
            */}
            <ContactPicker
              value={contactId}
              onChange={(id) => setContactId(id)}
              placeholder="Sem contato vinculado"
            />
            {contactId && (
              <button
                type="button"
                className="text-[10px] text-slate-400 underline hover:text-slate-600"
                onClick={() => {
                  setContactId("");
                  // Desvincular o contato tem de soltar o lead junto: lead
                  // pertence a um contato, e deixar o lead de outra pessoa
                  // pendurado seria pior do que não ter nenhum.
                  setOpportunityId("");
                }}
              >
                Desvincular contato
              </button>
            )}
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Lead (opcional)</Label>
            <Select
              value={opportunityId || NONE}
              onValueChange={(v) => setOpportunityId(!v || v === NONE ? "" : v)}
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
                {leadsDoContato.map((o) => (
                  <SelectItem key={o.id} value={o.id} className="text-xs">
                    {opportunityLabel(o)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/*
              ⚠️ **`opportunity_id` era 0 de 59 compromissos** — o campo nunca
              foi usado uma vez. A causa é a mesma do contato: `slice(0, 100)`
              sobre 596 leads, sem busca e sem relação com o contato da reunião.

              Agora a lista é a dos leads DAQUELE contato (no máximo 3 neste
              banco, medido), que é a única leitura que faz sentido: lead
              pertence a um contato. Sem contato escolhido não há o que
              oferecer, e a tela DIZ isso em vez de mostrar cem leads de outras
              pessoas.
            */}
            {!contactId ? (
              <p className="text-[10px] text-slate-400">
                Escolha o contato acima para ver os leads dele.
              </p>
            ) : leadsDoContato.length === 0 ? (
              <p className="text-[10px] text-slate-400">
                Este contato não tem lead no funil — crie em Leads.
              </p>
            ) : null}
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
        // 45min é a duração padrão sugerida nas Configurações do módulo.
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
        ) : tab === "Lista de compromissos" ? (
          <ListaCompromissos
            onNew={openNew}
            onEdit={(appointment) => setDraft({ appointment })}
          />
        ) : (
          <ConfigCalendarios />
        )}
      </div>
      <AppointmentDialog draft={draft} onOpenChange={(o) => !o && setDraft(null)} />
    </div>
  );
}
