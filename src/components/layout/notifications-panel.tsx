"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  AlertTriangle,
  Bell,
  CalendarClock,
  Check,
  CheckSquare,
  CircleDollarSign,
  Flame,
  MessageSquare,
  Monitor,
  Play,
  Settings2,
  Undo2,
  Volume2,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import {
  DEFAULT_SOUND,
  installAudioUnlock,
  loadSound,
  playSound,
  saveSound,
  SOUNDS,
  type SoundId,
} from "@/lib/notifications/sounds";
import {
  desktopDiagnostics,
  desktopEnabled,
  desktopPermission,
  requestDesktop,
  setDesktopEnabled,
  showDesktop,
  type DesktopPermission,
} from "@/lib/notifications/desktop";
import { useApptStore } from "@/lib/data/repos/db/appointments";
import { useModuleStore } from "@/lib/data/repos/db/contacts-module";
import { useMyMembership } from "@/lib/data/repos/db/team";
import { formatBRL } from "@/lib/data/repos/opportunities";
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

type NotificationKind =
  | "conversa"
  | "compromisso"
  | "agendamento"
  | "tarefa"
  | "lead-quente"
  | "venda";

interface NotificationItem {
  id: string;
  kind: NotificationKind;
  title: string;
  description: string;
  /** Momento que ordena e define "novo". ISO. */
  at: string;
  href: string;
  /**
   * Muda quando há atividade NOVA no mesmo aviso.
   *
   * O `id` é da CONVERSA, não da mensagem — de propósito: um id por mensagem
   * encheria a lista com dez linhas do mesmo contato. Só que, com id estável, a
   * segunda mensagem caía como "já conhecida" e o sino não tocava mais (o
   * sintoma relatado: toca uma vez só). A assinatura resolve os dois: a linha
   * continua sendo uma, e a mudança dela é o gatilho do som.
   */
  signature: string;
}

/** Item no arquivo local: o aviso + quando ele foi visto pela primeira vez. */
interface ArchivedItem extends NotificationItem {
  seenAt: string;
}

/** Avisos com atividade nova desde a última passada (id novo, ou assinatura mudada). */
function pickFresh(archive: ArchivedItem[], fresh: NotificationItem[]): NotificationItem[] {
  const byId = new Map(archive.map((a) => [a.id, a]));
  return fresh.filter((i) => {
    const old = byId.get(i.id);
    return !old || old.signature !== i.signature;
  });
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
    // Atividade nova renova o "visto em": o aviso volta ao topo do histórico.
    const changed = !!old && old.signature !== item.signature;
    byId.set(item.id, { ...item, seenAt: changed || !old ? now : old.seenAt });
  }
  return [...byId.values()];
}

const ICON: Record<NotificationKind, typeof Bell> = {
  conversa: MessageSquare,
  compromisso: CalendarClock,
  agendamento: AlertTriangle,
  tarefa: CheckSquare,
  "lead-quente": Flame,
  venda: CircleDollarSign,
};

const ICON_CLASS: Record<NotificationKind, string> = {
  conversa: "bg-indigo-50 text-indigo-600",
  compromisso: "bg-emerald-50 text-emerald-600",
  agendamento: "bg-rose-50 text-rose-600",
  tarefa: "bg-amber-50 text-amber-600",
  "lead-quente": "bg-orange-50 text-orange-600",
  venda: "bg-emerald-50 text-emerald-600",
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sound, setSound] = useState<SoundId>(DEFAULT_SOUND);
  const [permission, setPermission] = useState<DesktopPermission>("default");
  const [desktopOn, setDesktopOn] = useState(false);
  /**
   * A PRIMEIRA carga não avisa. O arquivo começa vazio, então todo aviso já
   * existente pareceria novo — abrir o CRM tocaria o sino vinte vezes e
   * empilharia vinte pop-ups. A primeira volta só semeia o arquivo.
   */
  const seeded = useRef(false);
  const locationId = useDbStore((s) => s.locationId);
  /**
   * Venda é assunto de quem enxerga Pagamentos — mesmo guard da sidebar.
   *
   * ⚠️ Aqui o aviso exige a linha do membro CARREGADA, e não é zelo excessivo:
   * `canAccess` devolve `true` quando não acha o membro (`if (!member) return
   * true` — o legado dos membros com `{}`), e no primeiro `refresh` o
   * `useTeamStore` ainda está carregando, então `me` é null e TODO mundo passa
   * por "pode ver Pagamentos" por um instante. Esse instante bastava: a
   * varredura consultava `payment_new_sales` (a RLS de `payment_events` libera
   * qualquer membro da empresa — quem esconde a aba é o app), gravava as vendas
   * no arquivo do localStorage, e o arquivo é PERMANENTE. Quando a permissão
   * real chegava, `mergeArchive` só atualiza e acrescenta: as vendas ficavam no
   * sino de quem não vê a aba, para sempre.
   *
   * O teste é `me`, não o `loaded` da store: `useTeamStore.load()` marca
   * `loaded: true` mesmo quando a consulta falha, e aí `members` fica vazio,
   * `me` volta a ser null e a janela permissiva reabriria calada. Sem saber
   * quem é, o sino NÃO avisa — falha tem que fechar, não abrir.
   */
  const { can, me, isAdmin } = useMyMembership();
  const canPayments = isAdmin || (!!me && can("pagamentos"));

  const refresh = useCallback(async () => {
    await useDbStore.getState().ensureSession();
    const loc = useDbStore.getState().locationId;
    const me = useDbStore.getState().userId;
    if (!loc) return;
    const supabase = createClient();
    const now = Date.now();

    /**
     * "É para mim?"
     *
     * A RLS já garante que ninguém vê o que não pode (segmentação por número da
     * 0035, agenda por dono da 0043...). Mas VER e SER AVISADO são coisas
     * diferentes: a caixa é compartilhada, e sem este filtro o time inteiro
     * levava um pop-up por conversa de qualquer colega. Aviso é interrupção —
     * interromper quem não tem o que fazer com aquilo treina a pessoa a ignorar
     * o sino.
     *
     * A regra é a mesma nas quatro fontes: **meu, ou de ninguém**. O "de
     * ninguém" precisa entrar — conversa na caixa do grupo, compromisso da
     * empresa e tarefa sem responsável não podem virar aviso que ninguém
     * recebe.
     */
    const isMine = (owner: string | null | undefined) => !owner || owner === me;

    // 1) Conversas não lidas (abertas) atribuídas a mim ou a ninguém. A RLS já
    // limita ao que a pessoa VÊ, inclusive a segmentação por número da 0035.
    const { data: convs } = await supabase
      .from("conversations")
      .select("id, contact_id, unread_count, last_message_at, last_message_preview, assigned_to")
      .eq("location_id", loc)
      .gt("unread_count", 0)
      .is("closed_at", null)
      .is("archived_at", null)
      .or(me ? `assigned_to.is.null,assigned_to.eq.${me}` : "assigned_to.is.null")
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
    // Quem agendou é quem precisa saber que falhou.
    const { data: failed } = await supabase
      .from("messages")
      .select("id, conversation_id, body, schedule_error, scheduled_for, scheduled_by")
      .eq("location_id", loc)
      .eq("schedule_status", "falhou")
      .or(me ? `scheduled_by.is.null,scheduled_by.eq.${me}` : "scheduled_by.is.null")
      .order("scheduled_for", { ascending: false })
      .limit(10);

    // 3) Compromissos das próximas 24h (a store já está carregada pelo
    // lembrete, que vive no mesmo shell).
    // Compromisso de outra pessoa não é aviso meu; sem dono = da empresa.
    const appointments = useApptStore.getState().appointments.filter((a) => {
      if (!isMine(a.ownerId)) return false;
      const start = new Date(a.start).getTime();
      return start >= now && start <= now + UPCOMING_HOURS * 3_600_000;
    });

    // 4) Tarefas pendentes vencendo (ou já vencidas). Mesma fonte de graça: a
    // store de tarefas já é carregada pelo lembrete, que vive neste shell.
    // Vencida ENTRA de propósito — é justamente a que não pode ser esquecida.
    const tasks = useModuleStore.getState().tasks.filter((t) => {
      if (t.status !== "pending" || !t.dueAt) return false;
      if (!isMine(t.assigneeId)) return false;
      return new Date(t.dueAt).getTime() <= now + UPCOMING_HOURS * 3_600_000;
    });

    /**
     * 5) Lead que o BOT colocou em fase "quente".
     *
     * Filtra por `source = 'Bot'` de propósito: quem move um lead à mão já sabe
     * que moveu — o aviso existe para o que aconteceu sozinho, sem ninguém
     * olhando. O bot grava essa fonte em `ensureCard`/`syncCard`
     * (src/lib/bot/engine.ts).
     *
     * A fase é reconhecida pelo NOME ("quente"), não por um id fixo: cada
     * empresa monta o próprio funil, e no fluxo do bot a etapa também é
     * escolhida por nome (`stageMap`).
     */
    const { data: hotStages } = await supabase
      .from("stages")
      .select("id, name, pipeline_id")
      .eq("location_id", loc)
      .ilike("name", "%quente%");

    const hotIds = (hotStages ?? []).map((st: any) => st.id);
    const since24h = new Date(now - UPCOMING_HOURS * 3_600_000).toISOString();
    const hotLeads =
      hotIds.length > 0
        ? (
            await supabase
              .from("opportunities")
              .select("id, name, value, stage_id, pipeline_id, source, created_at, owner_id")
              .eq("location_id", loc)
              .eq("source", "Bot")
              .in("stage_id", hotIds)
              .gte("created_at", since24h)
              .order("created_at", { ascending: false })
              .limit(10)
          ).data ?? []
        : [];

    /**
     * 6) VENDA NOVA — e só ela. A view `payment_new_sales` (migração 0056)
     * carrega a definição: aprovada, criada na janela, e primeira cobrança
     * quando é assinatura. Medido neste banco em 7 dias: 12.224 vendas
     * aprovadas ENTRARAM, 93 eram novas; sem essa separação o aviso seria
     * inútil no primeiro dia.
     */
    const newSales = canPayments
      ? (
          await supabase
            .from("payment_new_sales")
            .select("id, code, amount, currency, product_name, contact_name, guru_created_at, kind")
            .eq("location_id", loc)
            .gte("guru_created_at", since24h)
            .order("guru_created_at", { ascending: false })
            .limit(10)
        ).data ?? []
      : [];

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
        // Mensagem nova move `last_message_at` e sobe `unread_count`: é o que
        // faz o sino tocar de novo na MESMA conversa.
        signature: `${c.last_message_at ?? ""}|${c.unread_count}`,
      })),
      ...(failed ?? []).map((m: any) => ({
        id: `sched-${m.id}`,
        kind: "agendamento" as const,
        title: "Mensagem agendada falhou",
        description: m.schedule_error || m.body || "Sem detalhes",
        at: m.scheduled_for ?? new Date(now).toISOString(),
        href: `/conversas?c=${m.conversation_id}`,
        // Uma falha é um evento só; a linha não muda depois de gravada.
        signature: `sched-${m.id}`,
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
          // Reagendar o prazo faz o aviso valer de novo.
          signature: `${t.dueAt}|${late ? "vencida" : "a-vencer"}`,
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
        // Remarcar o compromisso avisa de novo.
        signature: a.start,
      })),
      ...hotLeads
        .filter((o: any) => isMine(o.owner_id))
        .map((o: any) => ({
          id: `hot-${o.id}`,
          kind: "lead-quente" as const,
          title: `Lead quente: ${o.name}`,
          description: `O bot classificou como quente${
            Number(o.value) > 0 ? ` · ${formatBRL(Number(o.value))}` : ""
          }`,
          at: o.created_at,
          href: `/leads?pipeline=${o.pipeline_id}`,
          // Mudar de fase avisa de novo (o bot pode reclassificar depois).
          signature: `${o.stage_id}`,
        })),
      ...newSales.map((v: any) => ({
        id: `venda-${v.id}`,
        kind: "venda" as const,
        title: `Venda nova · ${v.amount === null ? "" : formatBRL(Number(v.amount))}`.trim(),
        description: `${v.product_name ?? "Produto"} — ${v.contact_name ?? "cliente"}${
          v.kind === "assinatura-primeira" ? " (1ª cobrança da assinatura)" : ""
        }`,
        at: v.guru_created_at,
        href: "/pagamentos",
        // A venda entra na view já aprovada; a linha não muda depois.
        signature: `venda-${v.id}`,
      })),
    ].sort((x, y) => y.at.localeCompare(x.at));

    // O arquivo é a fonte da tela; a consulta só atualiza e acrescenta.
    // Exceção: aviso de venda de quem NÃO vê Pagamentos é apagado do arquivo.
    // Só deixar de acrescentar não bastava — o que a janela permissiva já
    // gravou (ver `permLoaded` acima) ficaria no sino para sempre. Também
    // limpa sozinho quem PERDEU o acesso depois.
    const before = canPayments
      ? loadArchive()
      : loadArchive().filter((i) => i.kind !== "venda");
    const merged = mergeArchive(before, next);
    saveArchive(merged);
    setItems(merged);

    // Novo, ou com atividade nova (ver `signature`).
    const fresh = pickFresh(before, next);
    // Atividade nova desmarca o "lido": chegou mensagem depois de você ter
    // lido o aviso, então ele volta a valer.
    if (fresh.length > 0) {
      const freshIds = new Set(fresh.map((i) => i.id));
      const stillRead = loadRead().filter((id) => !freshIds.has(id));
      saveRead(stillRead);
      setReadIds(stillRead);
    }
    if (!seeded.current) {
      seeded.current = true;
      return;
    }
    if (fresh.length === 0) return;

    playSound(loadSound());
    if (fresh.length <= 3) {
      for (const i of fresh) {
        showDesktop({ id: i.id, title: i.title, body: i.description, href: i.href });
      }
    } else {
      // Em rajada, um aviso só: cinco pop-ups empilhados são pior que nenhum.
      showDesktop({
        id: "lote",
        title: `${fresh.length} novas notificações`,
        body: "Abra o sino no CRM para ver a lista.",
        href: "/conversas",
      });
    }
    // `canPayments` entra nas dependências: quem acabou de ganhar acesso a
    // Pagamentos passa a receber aviso de venda sem precisar recarregar.
  }, [canPayments]);

  useEffect(() => {
    let alive = true;
    // As lidas saem do localStorage aqui dentro (e não num inicializador de
    // estado) porque o servidor não tem localStorage: ler no render daria
    // vazio no HTML e o valor real na hidratação, com o contador piscando.
    const run = async () => {
      await refresh();
      if (!alive) return;
      setReadIds(loadRead());
      // Preferências saem do localStorage aqui dentro, pelo mesmo motivo das
      // lidas: no servidor não existe localStorage nem Notification, e ler no
      // render daria um valor no HTML e outro na hidratação.
      setSound(loadSound());
      setPermission(desktopPermission());
      setDesktopOn(desktopEnabled());
    };
    void run();

    // Libera o áudio no primeiro clique/tecla da página. Sem isto, a varredura
    // automática tentava tocar sem gesto do usuário e o navegador descartava em
    // silêncio — só o clique no sino fazia som.
    const releaseUnlock = installAudioUnlock();

    // ----- Realtime: avisa na hora, sem esperar a varredura de 1 min -----
    // As duas tabelas já estão na publicação `supabase_realtime` (0003). Sem
    // isto, a mensagem que chega às 10h00m05s só viraria aviso às 10h01 — e,
    // como a pessoa costuma clicar no sino antes disso, parecia que só a ação
    // manual atualizava.
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const bump = () => {
      if (debounce) clearTimeout(debounce);
      // Uma mensagem mexe em `messages` E em `conversations`: sem o debounce,
      // seriam duas varreduras para o mesmo evento.
      debounce = setTimeout(() => void run(), 600);
    };
    const supabase = createClient();
    const channel = supabase
      .channel("lito-notificacoes")
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, bump)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, bump)
      .subscribe();

    const timer = setInterval(() => void run(), REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
      if (debounce) clearTimeout(debounce);
      releaseUnlock();
      void supabase.removeChannel(channel);
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
          <p className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
            Notificações
            <button
              onClick={() => setSettingsOpen((v) => !v)}
              title="Som e avisos na área de trabalho"
              className={cn(
                "flex size-5 items-center justify-center rounded",
                settingsOpen ? "bg-indigo-100 text-indigo-600" : "text-slate-400 hover:bg-slate-100"
              )}
            >
              <Settings2 className="size-3" />
            </button>
          </p>
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
        {settingsOpen && (
          <div className="space-y-2.5 border-b bg-slate-50 px-3 py-2.5">
            <div>
              <p className="mb-1 flex items-center gap-1.5 text-[11px] font-bold text-slate-600">
                <Volume2 className="size-3" /> Som da notificação
              </p>
              <div className="space-y-0.5">
                {SOUNDS.map((s) => (
                  <div key={s.id} className="flex items-center gap-1.5">
                    <button
                      onClick={() => {
                        setSound(s.id);
                        saveSound(s.id);
                        // Tocar na escolha serve de confirmação E destrava o
                        // AudioContext, que só nasce com um gesto do usuário.
                        playSound(s.id);
                      }}
                      className={cn(
                        "flex min-w-0 flex-1 items-center gap-1.5 rounded px-1.5 py-1 text-left text-[11px]",
                        sound === s.id
                          ? "bg-indigo-100 font-semibold text-indigo-700"
                          : "text-slate-600 hover:bg-white"
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{s.label}</span>
                      <span className="hidden truncate text-[10px] text-slate-400 sm:block">
                        {s.hint}
                      </span>
                    </button>
                    {s.id !== "mudo" && (
                      <button
                        onClick={() => playSound(s.id)}
                        title={`Ouvir "${s.label}"`}
                        className="flex size-5 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-white hover:text-indigo-600"
                      >
                        <Play className="size-2.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t pt-2">
              <p className="mb-1 flex items-center gap-1.5 text-[11px] font-bold text-slate-600">
                <Monitor className="size-3" /> Aviso na área de trabalho
              </p>
              {permission === "unsupported" ? (
                <p className="text-[10px] text-slate-400">
                  Este navegador não suporta avisos do sistema.
                </p>
              ) : permission === "denied" ? (
                <p className="text-[10px] text-amber-600">
                  O navegador bloqueou os avisos deste site. Para liberar, abra o cadeado ao
                  lado do endereço → Notificações → Permitir.
                </p>
              ) : permission === "granted" ? (
                <>
                  <label className="flex items-center gap-1.5 text-[11px] text-slate-600">
                    <input
                      type="checkbox"
                      checked={desktopOn}
                      onChange={(e) => {
                        setDesktopEnabled(e.target.checked);
                        setDesktopOn(e.target.checked);
                      }}
                      className="size-3"
                    />
                    Mostrar pop-up no computador a cada aviso novo
                  </label>
                  {/* Teste explícito: separa "o CRM não disparou" de "o Windows
                      não mostrou". Sem ele, um pop-up que não aparece pode ser
                      o Foco Assistido do Windows, notificação desligada para o
                      navegador ou o site sem permissão — e não dá para saber
                      qual olhando a tela do CRM. */}
                  {/* Sempre clicável e sempre com resposta na tela: um teste
                      que falha calado nao ajuda a distinguir "o CRM nao
                      disparou" de "o Windows nao mostrou". */}
                  <button
                    onClick={() => {
                      playSound(loadSound());
                      const problema = showDesktop({
                        id: "teste",
                        title: "Lito CRM — teste de notificação",
                        body: "Se você está vendo isto, o pop-up está funcionando.",
                        href: "/dashboard",
                      });
                      if (problema) {
                        toast.error(problema, { duration: 10000 });
                        return;
                      }
                      toast.success(
                        "Pop-up enviado ao Windows. Não apareceu? Foco Assistido ligado, ou notificações do navegador desligadas em Configurações → Sistema → Notificações.",
                        { duration: 12000 }
                      );
                    }}
                    className="mt-1.5 rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    Testar som e pop-up agora
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={async () => {
                      const result = await requestDesktop();
                      setPermission(result);
                      setDesktopOn(desktopEnabled());
                    }}
                    className="rounded-md bg-indigo-500 px-2 py-1 text-[11px] font-semibold text-white hover:bg-indigo-600"
                  >
                    Ativar avisos no computador
                  </button>
                  <p className="mt-1 text-[10px] text-slate-400">
                    O navegador vai pedir sua permissão. Funciona com o CRM aberto em
                    qualquer aba.
                  </p>
                </>
              )}
              {/* Estado de cada peça do caminho: transforma "não apareceu" numa
                  resposta legível em vez de tentativa e erro. */}
              <ul className="mt-2 space-y-0.5 border-t pt-1.5">
                {desktopDiagnostics().map((d) => (
                  <li key={d.label} className="flex items-baseline gap-1.5 text-[10px]">
                    <span className={d.ok ? "text-emerald-500" : "text-rose-500"}>
                      {d.ok ? "✓" : "✕"}
                    </span>
                    <span className="text-slate-400">{d.label}:</span>
                    <span className="min-w-0 flex-1 truncate font-medium text-slate-600">
                      {d.value}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
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
                : "Nada por aqui. Aparecem avisos de conversas não lidas, lead que o bot marcou como quente, venda nova, tarefas vencendo, compromissos das próximas 24 horas e mensagens agendadas que falharam."}
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
