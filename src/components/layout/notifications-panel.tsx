"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  AlertTriangle,
  Bell,
  CalendarClock,
  Check,
  CheckSquare,
  MessageSquare,
  Undo2,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { createClient } from "@/lib/supabase/client";
import { useApptStore } from "@/lib/data/repos/db/appointments";
import { useModuleStore } from "@/lib/data/repos/db/contacts-module";
import { useDbStore } from "@/lib/data/repos/db/contacts";
import { cn } from "@/lib/utils";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Central de notificações do sino, com abas "Não lidas" e "Lidas".
 *
 * **Não existe tabela de notificações.** Os avisos são DERIVADOS do que já
 * está no banco — conversa não lida, compromisso próximo, agendamento que
 * falhou. Uma tabela exigiria alguém escrevendo nela em todo lugar (webhook,
 * motor de automações, cron do marketing) e qualquer caminho esquecido viraria
 * um aviso que nunca chega. Derivar não tem como ficar dessincronizado.
 *
 * **Consultas próprias e enxutas**, não os stores dos módulos: o store de
 * Conversas carrega TODAS as mensagens da empresa, e o sino vive no shell —
 * pagar isso em toda tela pelo contador seria absurdo. Aqui são duas consultas
 * com `limit`, e só as colunas usadas.
 *
 * **"Lido" é um conjunto de ids no `localStorage`** (não no banco): estado de
 * tela, por dispositivo, no mesmo espírito do lembrete de compromisso. É por
 * ITEM, e não um carimbo de "abri o sino às 14h" — com as duas abas, um
 * carimbo mandaria tudo para "Lidas" de uma vez só por ter aberto o painel.
 *
 * **O sino tem MEMÓRIA PRÓPRIA (`ARCHIVE_KEY`)**, e não é detalhe: derivar do
 * banco significa que o aviso morre junto com a condição que o gerou. Abrir a
 * conversa zera o `unread_count` — a notificação sumia das DUAS abas no mesmo
 * instante, sem virar histórico. Agora todo aviso visto é gravado com o texto
 * dele; a lista das abas sai do arquivo, e as consultas só ATUALIZAM o que já
 * está lá e acrescentam o que é novo.
 *
 * Consequência assumida: um aviso não lido continua em "Não lidas" mesmo depois
 * de a origem sumir (a conversa foi lida no inbox por outra pessoa, o
 * compromisso passou). É o comportamento pedido — some só quando alguém marca
 * como lido, ou pelo "Marcar todas como lidas".
 */

const READ_KEY = "lito.notifications.read-ids";
/** Memória do sino: o texto de cada aviso já visto, para o histórico. */
const ARCHIVE_KEY = "lito.notifications.archive";
/** Teto do histórico local: a lista cresceria para sempre sem isso. */
const READ_LIMIT = 300;
const ARCHIVE_LIMIT = 150;
const REFRESH_MS = 60_000;
const UPCOMING_HOURS = 24;

type NotificationKind = "conversa" | "compromisso" | "agendamento" | "tarefa";

interface NotificationItem {
  id: string;
  kind: NotificationKind;
  title: string;
  description: string;
  /** Momento que ordena e define "novo". ISO. */
  at: string;
  href: string;
}

/** Item no arquivo local: o aviso + quando ele foi visto pela primeira vez. */
interface ArchivedItem extends NotificationItem {
  seenAt: string;
}

function loadArchive(): ArchivedItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(ARCHIVE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as ArchivedItem[]) : [];
  } catch {
    return [];
  }
}

function saveArchive(items: ArchivedItem[]) {
  try {
    // Mais recentes primeiro, com teto: o arquivo não pode crescer sem fim.
    const trimmed = [...items]
      .sort((a, b) => b.seenAt.localeCompare(a.seenAt))
      .slice(0, ARCHIVE_LIMIT);
    window.localStorage.setItem(ARCHIVE_KEY, JSON.stringify(trimmed));
  } catch {
    // localStorage bloqueado — o histórico some no F5, nada quebra.
  }
}

/**
 * Junta o que o banco acabou de devolver com o que já estava no arquivo:
 * atualiza o texto do que continua existindo (ex.: "2 não lidas" vira "3"),
 * mantém o que sumiu da origem e acrescenta o que é novo.
 */
function mergeArchive(archive: ArchivedItem[], fresh: NotificationItem[]): ArchivedItem[] {
  const now = new Date().toISOString();
  const byId = new Map(archive.map((a) => [a.id, a]));
  for (const item of fresh) {
    const old = byId.get(item.id);
    byId.set(item.id, { ...item, seenAt: old?.seenAt ?? now });
  }
  return [...byId.values()];
}

const ICON: Record<NotificationKind, typeof Bell> = {
  conversa: MessageSquare,
  compromisso: CalendarClock,
  agendamento: AlertTriangle,
  tarefa: CheckSquare,
};

const ICON_CLASS: Record<NotificationKind, string> = {
  conversa: "bg-indigo-50 text-indigo-600",
  compromisso: "bg-emerald-50 text-emerald-600",
  agendamento: "bg-rose-50 text-rose-600",
  tarefa: "bg-amber-50 text-amber-600",
};

function loadRead(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(READ_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveRead(ids: string[]) {
  try {
    window.localStorage.setItem(READ_KEY, JSON.stringify(ids.slice(-READ_LIMIT)));
  } catch {
    // localStorage bloqueado — as lidas voltam no F5, nada quebra.
  }
}

export function NotificationsPanel() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"nao-lidas" | "lidas">("nao-lidas");
  const [items, setItems] = useState<ArchivedItem[]>([]);
  const [readIds, setReadIds] = useState<string[]>([]);
  const locationId = useDbStore((s) => s.locationId);

  const refresh = useCallback(async () => {
    await useDbStore.getState().load();
    const loc = useDbStore.getState().locationId;
    if (!loc) return;
    const supabase = createClient();
    const now = Date.now();

    // 1) Conversas não lidas (abertas). A RLS já limita ao que a pessoa vê,
    // inclusive a segmentação por número da 0035.
    const { data: convs } = await supabase
      .from("conversations")
      .select("id, contact_id, unread_count, last_message_at, last_message_preview")
      .eq("location_id", loc)
      .gt("unread_count", 0)
      .is("closed_at", null)
      .is("archived_at", null)
      .order("last_message_at", { ascending: false })
      .limit(15);

    // Nomes só dos contatos que apareceram — carregar a agenda inteira de
    // contatos aqui seria pior que o problema.
    const contactIds = [...new Set((convs ?? []).map((c: any) => c.contact_id).filter(Boolean))];
    const nameById = new Map<string, string>();
    if (contactIds.length > 0) {
      const { data: people } = await supabase
        .from("contacts")
        .select("id, first_name, last_name")
        .in("id", contactIds);
      for (const p of people ?? []) {
        nameById.set(p.id, `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "Contato");
      }
    }

    // 2) Mensagens agendadas que falharam — o motor grava o motivo e ninguém
    // ficava sabendo sem abrir a aba Agendadas.
    const { data: failed } = await supabase
      .from("messages")
      .select("id, conversation_id, body, schedule_error, scheduled_for")
      .eq("location_id", loc)
      .eq("schedule_status", "falhou")
      .order("scheduled_for", { ascending: false })
      .limit(10);

    // 3) Compromissos das próximas 24h (a store já está carregada pelo
    // lembrete, que vive no mesmo shell).
    const appointments = useApptStore.getState().appointments.filter((a) => {
      const start = new Date(a.start).getTime();
      return start >= now && start <= now + UPCOMING_HOURS * 3_600_000;
    });

    // 4) Tarefas pendentes vencendo (ou já vencidas). Mesma fonte de graça: a
    // store de tarefas já é carregada pelo lembrete, que vive neste shell.
    // Vencida ENTRA de propósito — é justamente a que não pode ser esquecida.
    const tasks = useModuleStore.getState().tasks.filter((t) => {
      if (t.status !== "pending" || !t.dueAt) return false;
      return new Date(t.dueAt).getTime() <= now + UPCOMING_HOURS * 3_600_000;
    });

    const next: NotificationItem[] = [
      ...(convs ?? []).map((c: any) => ({
        id: `conv-${c.id}`,
        kind: "conversa" as const,
        title: `${nameById.get(c.contact_id) ?? "Contato"} — ${c.unread_count} não lida${
          c.unread_count > 1 ? "s" : ""
        }`,
        description: c.last_message_preview ?? "Nova mensagem",
        at: c.last_message_at ?? new Date(now).toISOString(),
        href: `/conversas?c=${c.id}`,
      })),
      ...(failed ?? []).map((m: any) => ({
        id: `sched-${m.id}`,
        kind: "agendamento" as const,
        title: "Mensagem agendada falhou",
        description: m.schedule_error || m.body || "Sem detalhes",
        at: m.scheduled_for ?? new Date(now).toISOString(),
        href: `/conversas?c=${m.conversation_id}`,
      })),
      ...tasks.map((t) => {
        const late = new Date(t.dueAt as string).getTime() < now;
        return {
          id: `task-${t.id}`,
          kind: "tarefa" as const,
          title: t.title,
          description: late
            ? `Venceu ${format(new Date(t.dueAt as string), "dd/MM 'às' HH:mm", { locale: ptBR })}`
            : `Vence ${format(new Date(t.dueAt as string), "EEEE 'às' HH:mm", { locale: ptBR })}`,
          at: t.dueAt as string,
          href: "/contatos",
        };
      }),
      ...appointments.map((a) => ({
        id: `appt-${a.id}`,
        kind: "compromisso" as const,
        title: a.title,
        description: `Começa ${format(new Date(a.start), "EEEE 'às' HH:mm", { locale: ptBR })}`,
        // Ordena pelo início: um compromisso "novo" é o que está mais perto.
        at: a.start,
        href: "/calendarios",
      })),
    ].sort((x, y) => y.at.localeCompare(x.at));

    // O arquivo é a fonte da tela; a consulta só atualiza e acrescenta.
    const merged = mergeArchive(loadArchive(), next);
    saveArchive(merged);
    setItems(merged);
  }, []);

  useEffect(() => {
    let alive = true;
    // As lidas saem do localStorage aqui dentro (e não num inicializador de
    // estado) porque o servidor não tem localStorage: ler no render daria
    // vazio no HTML e o valor real na hidratação, com o contador piscando.
    const run = async () => {
      await refresh();
      if (alive) setReadIds(loadRead());
    };
    void run();
    const timer = setInterval(() => void run(), REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [refresh, locationId]);

  const read = new Set(readIds);
  // As duas abas saem do ARQUIVO, não da consulta: um aviso cuja origem sumiu
  // (conversa aberta, compromisso que passou) continua tendo o que mostrar.
  const sorted = [...items].sort((a, b) => b.at.localeCompare(a.at));
  const unread = sorted.filter((i) => !read.has(i.id));
  const readItems = sorted.filter((i) => read.has(i.id));
  const visible = tab === "nao-lidas" ? unread : readItems;

  const markRead = (ids: string[]) => {
    if (ids.length === 0) return;
    const next = [...new Set([...readIds, ...ids])];
    saveRead(next);
    setReadIds(next);
  };

  const markUnread = (id: string) => {
    const next = readIds.filter((x) => x !== id);
    saveRead(next);
    setReadIds(next);
  };

  /** Limpa o histórico de lidas (o arquivo cresce sozinho, some sozinho). */
  const clearRead = () => {
    const keep = items.filter((i) => !read.has(i.id));
    saveArchive(keep);
    setItems(keep);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        // Abrir NÃO marca nada como lido: com as duas abas, isso esvaziaria
        // "Não lidas" só por ter espiado o sino.
        if (o) void refresh();
      }}
    >
      <PopoverTrigger
        render={
          <button
            title="Notificações"
            className="relative flex size-7 items-center justify-center rounded-full text-slate-300 hover:bg-slate-700"
          />
        }
      >
        <Bell className="size-4" />
        {unread.length > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex min-w-3.5 items-center justify-center rounded-full bg-orange-400 px-1 text-[9px] font-bold text-slate-900">
            {unread.length > 9 ? "9+" : unread.length}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <p className="text-xs font-bold text-slate-700">Notificações</p>
          {tab === "nao-lidas" && unread.length > 0 && (
            <button
              onClick={() => markRead(unread.map((i) => i.id))}
              className="text-[10px] font-semibold text-indigo-600 hover:underline"
            >
              Marcar todas como lidas
            </button>
          )}
          {tab === "lidas" && readItems.length > 0 && (
            <button
              onClick={clearRead}
              className="text-[10px] font-semibold text-slate-400 hover:text-slate-600 hover:underline"
            >
              Limpar histórico
            </button>
          )}
        </div>
        <div className="flex gap-1 border-b px-2 py-1.5">
          {(
            [
              ["nao-lidas", "Não lidas", unread.length],
              ["lidas", "Lidas", readItems.length],
            ] as const
          ).map(([key, label, count]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                "flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium",
                tab === key ? "bg-indigo-100 text-indigo-700" : "text-slate-500 hover:bg-slate-100"
              )}
            >
              {label}
              {count > 0 && (
                <span
                  className={cn(
                    "rounded-full px-1.5 text-[9px] font-bold",
                    tab === key ? "bg-indigo-500 text-white" : "bg-slate-200 text-slate-600"
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {visible.length === 0 && (
            <p className="px-3 py-8 text-center text-[11px] leading-relaxed text-slate-400">
              {tab === "lidas"
                ? "Nenhuma notificação lida ainda. O que você marcar como lido fica guardado aqui."
                : "Nada por aqui. Aparecem avisos de conversas não lidas, tarefas vencendo, compromissos das próximas 24 horas e mensagens agendadas que falharam."}
            </p>
          )}
          {visible.map((item) => {
            const Icon = ICON[item.kind];
            const isRead = read.has(item.id);
            return (
              <div
                key={item.id}
                className={cn(
                  "group flex items-start gap-2.5 border-b px-3 py-2.5 last:border-0 hover:bg-slate-50",
                  !isRead && "bg-indigo-50/40"
                )}
              >
                <Link
                  href={item.href}
                  // Abrir o item é o gesto natural de "vi isso" — marca como
                  // lido junto, em vez de exigir dois cliques.
                  onClick={() => {
                    markRead([item.id]);
                    setOpen(false);
                  }}
                  className="flex min-w-0 flex-1 items-start gap-2.5"
                >
                  <span
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-full",
                      ICON_CLASS[item.kind]
                    )}
                  >
                    <Icon className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold text-slate-800">
                      {item.title}
                    </span>
                    <span className="block truncate text-[11px] text-slate-500">
                      {item.description}
                    </span>
                    <span className="block text-[10px] text-slate-400">
                      {formatDistanceToNow(new Date(item.at), { addSuffix: true, locale: ptBR })}
                    </span>
                  </span>
                </Link>
                <button
                  onClick={() => (isRead ? markUnread(item.id) : markRead([item.id]))}
                  title={isRead ? "Marcar como não lida" : "Marcar como lida"}
                  className="mt-0.5 shrink-0 rounded p-0.5 text-slate-300 opacity-0 transition-opacity hover:text-indigo-600 group-hover:opacity-100"
                >
                  {isRead ? <Undo2 className="size-3.5" /> : <Check className="size-3.5" />}
                </button>
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
