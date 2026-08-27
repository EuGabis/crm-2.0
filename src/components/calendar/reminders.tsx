"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarClock, CheckSquare, Clock, Target, User, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { contactName } from "@/lib/data/repos/contacts";
import { useApptStore, useDbAppointments } from "@/lib/data/repos/db/appointments";
import { useDbContact } from "@/lib/data/repos/db/contacts";
import {
  taskActions,
  useContactsModule,
  type DbTask,
} from "@/lib/data/repos/db/contacts-module";
import { useDbOpportunities } from "@/lib/data/repos/db/pipeline";
import type { Appointment } from "@/lib/data/types";

/**
 * Lembretes dentro do CRM: compromisso (migração 0042) e tarefa (0050).
 *
 * Mora no shell (`(app)/layout.tsx`) para avisar em qualquer tela — um aviso
 * que só aparece com o módulo Calendários aberto não serve para nada.
 *
 * Um componente só para os dois: a mecânica é a mesma (janela de disparo,
 * "já avisei" local, adiar 5 min) e dois popups independentes acabariam
 * abrindo um por cima do outro no mesmo canto da tela.
 *
 * Decisões que valem registro:
 *
 * - **"Já avisei" fica no localStorage**, não no banco: é estado de tela, por
 *   dispositivo. Marcar no banco esconderia o aviso no computador porque o
 *   celular mostrou primeiro.
 * - **Janela de disparo**, e não "passou da hora": só avisa entre
 *   `início - lembrete` e `início + TOLERÂNCIA`. Sem isso, abrir o CRM depois
 *   do almoço despejaria os avisos da manhã inteira de uma vez.
 * - **Recarrega a agenda de tempos em tempos**: a store carrega uma vez só, e
 *   sem isso um compromisso criado em outro dispositivo nunca avisaria aqui.
 */

const CHECK_MS = 30_000; // varredura
const RELOAD_MS = 5 * 60_000; // relê a agenda do banco
const LATE_TOLERANCE_MIN = 15; // atraso máximo para ainda valer o aviso
/**
 * Tarefa aguenta muito mais atraso que reunião: a reunião passou e acabou, a
 * tarefa continua pendente o dia inteiro. Com os mesmos 15 min, quem abrisse o
 * CRM às 9h20 nunca veria o lembrete das 9h.
 */
const TASK_LATE_TOLERANCE_MIN = 12 * 60;
const STORAGE_KEY = "lito.appointment-reminders.shown";

/** Ids já avisados NESTE navegador (sobrevive ao F5). */
function loadShown(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return new Set<string>(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function saveShown(ids: Set<string>) {
  try {
    // Guarda os 200 mais recentes: a lista cresceria para sempre e só
    // interessa o passado próximo.
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids].slice(-200)));
  } catch {
    // localStorage cheio ou bloqueado — o lembrete some no F5, não quebra nada.
  }
}

/** O que está sendo lembrado agora. */
type Due =
  | { kind: "appointment"; appointment: Appointment; minutesLeft: number }
  | { kind: "task"; task: DbTask; minutesLeft: number };

export function Reminders() {
  const { appointments } = useDbAppointments();
  const { tasks } = useContactsModule();
  const opportunities = useDbOpportunities();
  // Guarda também os minutos que faltavam QUANDO o aviso apareceu: calcular
  // `Date.now()` no render deixaria o componente impuro (e o número mudaria
  // sozinho a cada re-render, sem o popup ter mudado).
  const [due, setDue] = useState<Due | null>(null);
  const [snoozed, setSnoozed] = useState<Record<string, number>>({});

  // Só o contato do item VENCIDO (o popup) importa — busca ELE por id, sem
  // baixar a base inteira. `useDbContact` não força o load dos 40 mil.
  const dueContactId =
    due?.kind === "task"
      ? due.task.contactId ?? null
      : due?.kind === "appointment"
        ? due.appointment.contactId ?? null
        : null;
  const { contact: dueContact } = useDbContact(dueContactId);

  // Varredura + recarga periódica. Um efeito só: os dois timers vivem e morrem
  // juntos com o componente.
  useEffect(() => {
    const check = () => {
      const now = Date.now();
      const shown = loadShown();
      const next = appointments.find((a) => {
        if (a.reminderMinutes === null || a.reminderMinutes === undefined) return false;
        if (shown.has(a.id)) return false;
        const snoozedUntil = snoozed[a.id];
        if (snoozedUntil && now < snoozedUntil) return false;
        const start = new Date(a.start).getTime();
        const from = start - a.reminderMinutes * 60_000;
        const until = start + LATE_TOLERANCE_MIN * 60_000;
        return now >= from && now <= until;
      });
      if (next) {
        const minutesLeft = Math.round((new Date(next.start).getTime() - now) / 60_000);
        setDue((cur) => cur ?? { kind: "appointment", appointment: next, minutesLeft });
        return;
      }

      // Tarefa (0050): mesma janela, com o PRAZO no lugar do início. Só
      // pendente — avisar de tarefa já concluída é ruído puro.
      const task = tasks.find((t) => {
        if (t.status !== "pending" || !t.dueAt) return false;
        if (t.reminderMinutes === null || t.reminderMinutes === undefined) return false;
        if (shown.has(`task-${t.id}`)) return false;
        const snoozedUntil = snoozed[`task-${t.id}`];
        if (snoozedUntil && now < snoozedUntil) return false;
        const dueAt = new Date(t.dueAt).getTime();
        const from = dueAt - t.reminderMinutes * 60_000;
        const until = dueAt + TASK_LATE_TOLERANCE_MIN * 60_000;
        return now >= from && now <= until;
      });
      if (task?.dueAt) {
        const minutesLeft = Math.round((new Date(task.dueAt).getTime() - now) / 60_000);
        setDue((cur) => cur ?? { kind: "task", task, minutesLeft });
      }
    };

    check();
    const tick = setInterval(check, CHECK_MS);
    const reload = setInterval(() => void useApptStore.getState().reload(), RELOAD_MS);
    return () => {
      clearInterval(tick);
      clearInterval(reload);
    };
  }, [appointments, tasks, snoozed]);

  // Chave do "já avisei"/"adiar". Compromisso mantém o id puro (é o que já está
  // gravado no localStorage de quem usa o CRM hoje); tarefa entra com prefixo
  // para os dois nunca colidirem.
  const dueKey = due ? (due.kind === "task" ? `task-${due.task.id}` : due.appointment.id) : null;

  const dismiss = () => {
    if (!dueKey) return;
    const shown = loadShown();
    shown.add(dueKey);
    saveShown(shown);
    setDue(null);
  };

  const snooze = () => {
    if (!dueKey) return;
    // Adiar NÃO marca como avisado: some por 5 minutos e volta.
    setSnoozed((prev) => ({ ...prev, [dueKey]: Date.now() + 5 * 60_000 }));
    setDue(null);
  };

  if (!due) return null;

  if (due.kind === "task") {
    const { task, minutesLeft } = due;
    const taskContact = dueContact;
    return (
      <div
        role="alert"
        className="fixed right-4 top-16 z-50 w-80 animate-in slide-in-from-top-2 fade-in rounded-xl border border-indigo-200 bg-white p-3 shadow-lg"
      >
        <div className="mb-2 flex items-start justify-between gap-2">
          <p className="flex items-center gap-1.5 text-xs font-bold text-indigo-700">
            <CheckSquare className="size-3.5" />
            {minutesLeft > 0
              ? `Tarefa em ${minutesLeft} min`
              : minutesLeft === 0
                ? "Tarefa agora"
                : `Tarefa venceu há ${Math.abs(minutesLeft)} min`}
          </p>
          <button
            onClick={dismiss}
            title="Dispensar"
            className="flex size-5 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-100"
          >
            <X className="size-3.5" />
          </button>
        </div>
        <div className="space-y-1.5">
          <p className="text-sm font-semibold text-slate-800">{task.title}</p>
          {task.dueAt && (
            <p className="flex items-center gap-1.5 text-xs text-slate-600">
              <Clock className="size-3.5 shrink-0 text-slate-400" />
              {format(new Date(task.dueAt), "EEEE, dd 'de' MMMM · HH:mm", { locale: ptBR })}
            </p>
          )}
          {taskContact && (
            <p className="flex items-center gap-1.5 text-xs text-slate-600">
              <User className="size-3.5 shrink-0 text-slate-400" />
              <span className="truncate">{contactName(taskContact)}</span>
            </p>
          )}
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={snooze}>
            Lembrar em 5 min
          </Button>
          <span className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[11px]"
              onClick={async () => {
                // Concluir daqui evita ir até Contatos só para marcar o feito.
                await taskActions.toggle(task.id);
                dismiss();
              }}
            >
              Concluir
            </Button>
            <Button size="sm" className="h-7 text-[11px]" onClick={dismiss}>
              Ok
            </Button>
          </span>
        </div>
      </div>
    );
  }

  const { appointment, minutesLeft } = due;
  const start = new Date(appointment.start);
  const end = new Date(appointment.end);
  const contact = dueContact;
  const opportunity = appointment.opportunityId
    ? opportunities.find((o) => o.id === appointment.opportunityId)
    : null;

  return (
    // Canto superior direito, logo abaixo da topbar (h-12). Card fixo em vez de
    // diálogo: o aviso não pode bloquear a tela nem tirar o foco de quem está
    // no meio de uma conversa.
    <div
      role="alert"
      className="fixed right-4 top-16 z-50 w-80 animate-in slide-in-from-top-2 fade-in rounded-xl border border-indigo-200 bg-white p-3 shadow-lg"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-bold text-indigo-700">
          <CalendarClock className="size-3.5" />
          {minutesLeft > 0
            ? `Compromisso em ${minutesLeft} min`
            : minutesLeft === 0
              ? "Compromisso agora"
              : `Compromisso começou há ${Math.abs(minutesLeft)} min`}
        </p>
        <button
          onClick={dismiss}
          title="Dispensar"
          className="flex size-5 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-100"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-semibold text-slate-800">{appointment.title}</p>
        <p className="flex items-center gap-1.5 text-xs text-slate-600">
          <Clock className="size-3.5 shrink-0 text-slate-400" />
          {format(start, "EEEE, dd 'de' MMMM · HH:mm", { locale: ptBR })}–{format(end, "HH:mm")}
        </p>
        {contact && (
          <p className="flex items-center gap-1.5 text-xs text-slate-600">
            <User className="size-3.5 shrink-0 text-slate-400" />
            <span className="truncate">
              {contactName(contact)}
              {contact.phone ? ` · ${contact.phone}` : ""}
            </span>
          </p>
        )}
        {opportunity && (
          <p className="flex items-center gap-1.5 text-xs text-slate-600">
            <Target className="size-3.5 shrink-0 text-slate-400" />
            <span className="truncate">{opportunity.name}</span>
          </p>
        )}
        <p className="text-[11px] text-slate-400">Calendário: {appointment.calendar}</p>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={snooze}>
          Lembrar em 5 min
        </Button>
        <span className="flex items-center gap-1.5">
          <Link href="/calendarios" onClick={dismiss}>
            <Button variant="outline" size="sm" className="h-7 text-[11px]">
              Abrir agenda
            </Button>
          </Link>
          <Button size="sm" className="h-7 text-[11px]" onClick={dismiss}>
            Ok
          </Button>
        </span>
      </div>
    </div>
  );
}
