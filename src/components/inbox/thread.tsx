"use client";

import { useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Archive,
  CalendarDays,
  Check,
  CheckCheck,
  CheckCircle2,
  Download,
  FileText,
  Loader2,
  Mail,
  Pause,
  Phone,
  Play,
  Star,
  Trash2,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SlaBadge } from "@/components/shared/sla-badge";
import { useWebphone } from "@/components/layout/webphone-store";
import { contactName } from "@/lib/data/repos/contacts";
import { useDbContact } from "@/lib/data/repos/db/contacts";
import {
  conversationActions,
  useConversation,
  useConvStore,
  useMessages,
  useMessagesLoading,
} from "@/lib/data/repos/db/conversations";
import { useMyMembership, useTeam } from "@/lib/data/repos/db/team";
import { useWhatsappChannels } from "@/lib/data/repos/db/whatsapp";
import type { Conversation, Message } from "@/lib/data/types";
import { cn } from "@/lib/utils";

/** Responsável pelo atendimento — grava em `conversations.assigned_to` (0024). */
function AssignPicker({
  conversation,
  onGone,
}: {
  conversation: Conversation;
  /** Chamado quando, após transferir, eu perco a visibilidade da conversa. */
  onGone?: () => void;
}) {
  const { members } = useTeam();
  const { me } = useMyMembership();
  const owner = members.find((m) => m.userId === conversation.assignedTo) ?? null;

  const set = async (userId: string | null) => {
    const ok = await conversationActions.assign(conversation.id, userId);
    if (!ok) {
      toast.error("Não foi possível alterar o responsável");
      return;
    }
    // Registra de quem, para quem e POR quem — vira evento inline (log).
    // `owner` é o dono ANTERIOR (capturado no render antes da troca) = a origem.
    const actor = members.find((m) => m.userId === me?.userId)?.name ?? "Alguém";
    const from = owner?.name ?? null;
    const target = userId ? members.find((m) => m.userId === userId)?.name ?? "usuário" : null;
    let body: string;
    if (!target) {
      body = `${actor} removeu o responsável`;
    } else if (from && actor === target && from !== target) {
      // Quem transfere PUXA a conversa para si, tirando de outro — deixa claro
      // que foi o ator (ex.: admin assume a conversa da Cibele).
      body = `${actor} assumiu a conversa de ${from}`;
    } else if (from && from !== target) {
      // Credita "por Fulano" quando quem transferiu não é a origem (ex.: admin
      // transfere a conversa de um atendente para outro).
      const by = actor !== from ? ` por ${actor}` : "";
      body = `Conversa transferida de ${from} para ${target}${by}`;
    } else if (!from) {
      body = actor === target ? `${actor} assumiu a conversa` : `Conversa atribuída a ${target} por ${actor}`;
    } else {
      body = `Conversa atribuída a ${target}`;
    }
    void conversationActions.logEvent(conversation.id, body);
    toast.success(target ? `Atribuída a ${target}` : "Devolvida para a caixa do grupo");
    // Transferi para outro e perdi a visibilidade → o assign() já tirou a conversa
    // do store. Fecho o painel para voltar à lista, sem depender de F5.
    if (
      userId &&
      userId !== me?.userId &&
      !useConvStore.getState().conversations.some((c) => c.id === conversation.id)
    ) {
      onGone?.();
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            title={owner ? `Responsável: ${owner.name}` : "Sem responsável"}
            className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-slate-500 hover:bg-slate-100"
          />
        }
      >
        {owner ? (
          <>
            <Avatar className="size-5">
              <AvatarFallback
                className="text-[9px] font-bold text-white"
                style={{ background: owner.color }}
              >
                {owner.name.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="max-w-24 truncate">{owner.name}</span>
          </>
        ) : (
          <>
            <UserPlus className="size-3.5" />
            Atribuir
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {me && conversation.assignedTo !== me.userId && (
          <DropdownMenuItem className="text-xs" onClick={() => void set(me.userId)}>
            Atribuir a mim
          </DropdownMenuItem>
        )}
        {members
          .filter((m) => m.userId !== me?.userId)
          .map((m) => (
            <DropdownMenuItem key={m.userId} className="text-xs" onClick={() => void set(m.userId)}>
              {m.name}
            </DropdownMenuItem>
          ))}
        {conversation.assignedTo && (
          <DropdownMenuItem className="text-xs text-slate-500" onClick={() => void set(null)}>
            Remover responsável
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function fmtBytes(n?: number) {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Busca a URL assinada da mídia (bucket privado) uma vez por mensagem. */
function useMediaUrl(path?: string) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    if (path) {
      void conversationActions.mediaUrl(path).then((u) => {
        if (active) setUrl(u);
      });
    }
    return () => {
      active = false;
    };
  }, [path]);
  return url;
}

/** Player de áudio real (elemento <audio>) com a mesma UI de onda. */
function AudioPlayer({ url, duration, out }: { url: string | null; duration?: string; out: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [pct, setPct] = useState(0);
  return (
    <div className="flex items-center gap-2">
      <audio
        ref={audioRef}
        src={url ?? undefined}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setPct(0);
        }}
        onTimeUpdate={(e) => {
          const a = e.currentTarget;
          if (a.duration) setPct((a.currentTime / a.duration) * 100);
        }}
      />
      <button
        onClick={() => {
          const a = audioRef.current;
          if (!a) return;
          if (a.paused) void a.play();
          else a.pause();
        }}
        disabled={!url}
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-full text-white disabled:opacity-50",
          out ? "bg-white/25" : "bg-indigo-500"
        )}
      >
        {playing ? <Pause className="size-3.5" /> : <Play className="ml-0.5 size-3.5" />}
      </button>
      <div className="flex h-6 items-center gap-px">
        {Array.from({ length: 24 }, (_, i) => (
          <span
            key={i}
            className={cn(
              "w-1 rounded-full",
              (i / 24) * 100 <= pct ? (out ? "bg-white" : "bg-indigo-500") : out ? "bg-white/40" : "bg-slate-300"
            )}
            style={{ height: 4 + ((i * 7) % 16) }}
          />
        ))}
      </div>
      {duration && <span className={cn("text-[10px]", out ? "text-indigo-100" : "text-slate-500")}>{duration}</span>}
    </div>
  );
}

/** Conteúdo de mensagens de mídia: imagem, áudio ou arquivo. */
function MediaContent({ message, out }: { message: Message; out: boolean }) {
  const url = useMediaUrl(message.mediaPath);

  if (message.type === "image") {
    return url ? (
      <a href={url} target="_blank" rel="noreferrer" className="block">
        <img
          src={url}
          alt={message.mediaName ?? "imagem"}
          className="max-h-64 max-w-full rounded-lg object-cover"
        />
      </a>
    ) : (
      <div className="h-40 w-52 animate-pulse rounded-lg bg-black/10" />
    );
  }

  if (message.type === "audio") {
    return <AudioPlayer url={url} duration={message.body || undefined} out={out} />;
  }

  if (message.type === "video") {
    return url ? (
      // eslint-disable-next-line jsx-a11y/media-has-caption
      <video src={url ?? undefined} controls className="max-h-72 w-full rounded-lg" />
    ) : (
      <div className="h-40 w-52 animate-pulse rounded-lg bg-black/10" />
    );
  }

  // file
  return (
    <a
      href={url ?? undefined}
      target="_blank"
      rel="noreferrer"
      download={message.mediaName}
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-1 py-0.5",
        out ? "text-white" : "text-slate-700"
      )}
    >
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-lg",
          out ? "bg-white/20" : "bg-slate-200"
        )}
      >
        <FileText className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block max-w-[180px] truncate text-xs font-semibold">
          {message.mediaName ?? "Arquivo"}
        </span>
        <span className={cn("text-[10px]", out ? "text-indigo-100" : "text-slate-400")}>
          {fmtBytes(message.mediaSize)}
        </span>
      </span>
      <Download className={cn("size-4 shrink-0", out ? "text-indigo-100" : "text-slate-400")} />
    </a>
  );
}

function PipelineEvent({ message }: { message: Message }) {
  return (
    <div className="my-2 flex justify-center">
      <span className="flex items-center gap-1.5 rounded-full border bg-slate-50 px-3 py-1 text-[10px] text-slate-500">
        <CalendarDays className="size-3" />
        {message.body}
      </span>
    </div>
  );
}

/**
 * Log do agendamento dentro da própria bolha: quem agendou, para quando e em
 * que pé está. Antes só existia o selo "AGENDADA", que nunca mudava porque
 * nada disparava a mensagem (migração 0028).
 */
function ScheduleTag({ message }: { message: Message }) {
  const { members } = useTeam();
  const who = members.find((m) => m.userId === message.scheduledBy)?.name;
  const status = message.scheduleStatus;

  const head =
    status === "enviada"
      ? "Agendada · enviada"
      : status === "falhou"
        ? "Agendada · falhou"
        : status === "cancelada"
          ? "Agendamento cancelado"
          : status === "enviando"
            ? "Agendada · enviando"
            : "Agendada";

  return (
    <span className="mb-1 block border-b border-white/25 pb-1">
      <span className="block text-[9px] font-bold uppercase tracking-wide opacity-90">{head}</span>
      <span className="block text-[10px] opacity-80">
        {message.scheduledFor &&
          `para ${format(new Date(message.scheduledFor), "dd/MM 'às' HH:mm", { locale: ptBR })}`}
        {who && ` · por ${who}`}
      </span>
      {status === "enviada" && message.dispatchedAt && (
        <span className="block text-[10px] opacity-80">
          disparada em {format(new Date(message.dispatchedAt), "dd/MM 'às' HH:mm", { locale: ptBR })}
        </span>
      )}
      {status === "falhou" && message.scheduleError && (
        <span className="block text-[10px] font-medium opacity-90">{message.scheduleError}</span>
      )}
    </span>
  );
}

function MessageBubble({ message }: { message: Message }) {
  if (message.type === "event") return <PipelineEvent message={message} />;
  const isOut = message.direction === "out";
  // Rótulo explícito do rastreio (WhatsApp): aparece no hover do checkzinho, com
  // a hora de entrega/leitura quando a Meta informou.
  const at = (iso?: string) =>
    iso ? " · " + format(new Date(iso), "dd/MM 'às' HH:mm", { locale: ptBR }) : "";
  const statusLabel =
    message.status === "read"
      ? `Lido${at(message.readAt)}`
      : message.status === "delivered"
        ? `Entregue${at(message.deliveredAt)}`
        : message.status === "failed"
          ? "Falhou ao enviar"
          : "Enviado";
  return (
    <div className={cn("flex", isOut ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[70%] rounded-2xl px-3.5 py-2 text-[13px]",
          message.internal
            ? "border border-amber-200 bg-amber-50 text-amber-900"
            : isOut
              ? "rounded-br-sm bg-indigo-500 text-white"
              : "rounded-bl-sm bg-slate-100 text-slate-800"
        )}
      >
        {message.internal && (
          <p className="mb-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-600">
            Comentário interno
          </p>
        )}
        {message.scheduleStatus && <ScheduleTag message={message} />}
        {message.type === "audio" ||
        message.type === "image" ||
        message.type === "video" ||
        message.type === "file" ? (
          <MediaContent message={message} out={isOut && !message.internal} />
        ) : (
          message.body
        )}
        <p
          className={cn(
            "mt-1 text-right text-[9px]",
            message.internal ? "text-amber-500" : isOut ? "text-indigo-200" : "text-slate-400"
          )}
        >
          {format(new Date(message.at), "HH:mm")}
          {isOut && message.status && (
            <span className="ml-1 inline-flex align-middle" title={statusLabel}>
              {message.status === "read" ? (
                <CheckCheck className="size-3 text-sky-300" />
              ) : message.status === "delivered" ? (
                <CheckCheck className="size-3 text-indigo-200" />
              ) : message.status === "failed" ? (
                <span className="text-[9px] text-rose-300">falhou</span>
              ) : (
                <Check className="size-3 text-indigo-200" />
              )}
            </span>
          )}
        </p>
      </div>
    </div>
  );
}

/**
 * Faixa de estado: diz que a conversa está finalizada e/ou arquivada, quem fez
 * e quando, com o caminho de volta ao lado (migração 0029). Sem isso, abrir uma
 * conversa finalizada dá a impressão de que ela ainda está na fila.
 */
function StatusBanner({ conversation }: { conversation: Conversation }) {
  const { members } = useTeam();
  if (!conversation.closedAt && !conversation.archivedAt) return null;

  const nameOf = (userId?: string | null) =>
    members.find((m) => m.userId === userId)?.name ?? "alguém da equipe";
  const when = (iso: string) => format(new Date(iso), "dd/MM 'às' HH:mm", { locale: ptBR });

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-slate-50 px-4 py-2">
      {conversation.closedAt && (
        <span className="flex items-center gap-1.5 text-[11px] text-slate-600">
          <CheckCircle2 className="size-3.5 text-emerald-500" />
          Finalizada por <strong className="font-semibold">{nameOf(conversation.closedBy)}</strong>{" "}
          em {when(conversation.closedAt)}
        </span>
      )}
      {conversation.archivedAt && (
        <span className="flex items-center gap-1.5 text-[11px] text-slate-600">
          <Archive className="size-3.5 text-slate-400" />
          Arquivada por{" "}
          <strong className="font-semibold">{nameOf(conversation.archivedBy)}</strong> em{" "}
          {when(conversation.archivedAt)}
        </span>
      )}
      <span className="ml-auto flex items-center gap-2">
        {conversation.closedAt && (
          <button
            onClick={async () =>
              (await conversationActions.close(conversation.id, false))
                ? toast.success("Conversa reaberta")
                : toast.error("Não foi possível reabrir")
            }
            className="text-[11px] font-semibold text-indigo-600 hover:underline"
          >
            Reabrir
          </button>
        )}
        {conversation.archivedAt && (
          <button
            onClick={async () =>
              (await conversationActions.archive(conversation.id, false))
                ? toast.success("Conversa desarquivada")
                : toast.error("Não foi possível desarquivar")
            }
            className="text-[11px] font-semibold text-indigo-600 hover:underline"
          >
            Desarquivar
          </button>
        )}
      </span>
    </div>
  );
}

export function Thread({
  conversationId,
  onDeleted,
}: {
  conversationId: string;
  onDeleted?: () => void;
}) {
  const conversation = useConversation(conversationId);
  const { contact } = useDbContact(conversation?.contactId ?? null);
  const messages = useMessages(conversationId);
  const loadingMessages = useMessagesLoading(conversationId);
  const callContact = useWebphone((s) => s.callContact);
  const { isAdmin } = useMyMembership();
  const { channels } = useWhatsappChannels();
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  /**
   * Confirmação de finalizar/arquivar. Só a ida pede confirmação: reabrir e
   * desarquivar devolvem a conversa para a caixa, não custam nada a quem
   * clicou sem querer — perguntar ali seria atrito puro.
   */
  const [confirmStatus, setConfirmStatus] = useState<"finalizar" | "arquivar" | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);

  const applyStatus = async () => {
    if (!conversation || !confirmStatus) return;
    setStatusBusy(true);
    const ok =
      confirmStatus === "finalizar"
        ? await conversationActions.close(conversation.id, true)
        : await conversationActions.archive(conversation.id, true);
    setStatusBusy(false);
    setConfirmStatus(null);
    if (!ok) {
      toast.error("Não foi possível atualizar a conversa");
      return;
    }
    toast.success(confirmStatus === "finalizar" ? "Conversa finalizada" : "Conversa arquivada");
  };

  const jumpToBottom = () => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  // Abrir/trocar de conversa: cai DIRETO no fim, sem animação. (Antes era
  // scrollIntoView "smooth", que dava a impressão de a conversa "subir".)
  useEffect(() => {
    pinnedRef.current = true;
    requestAnimationFrame(() => {
      jumpToBottom();
      requestAnimationFrame(jumpToBottom);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  // Mensagem nova: só puxa pro fim se o usuário já estava no fim (não atrapalha
  // quem está lendo o histórico).
  useEffect(() => {
    if (pinnedRef.current) jumpToBottom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  // Conteúdo que cresce DEPOIS (imagem/vídeo/documento carregando) reancora no
  // fim — antes a imagem carregava, empurrava tudo e a view ficava pra cima.
  useEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (pinnedRef.current) jumpToBottom();
    });
    ro.observe(content);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!conversation || !contact) return null;

  // Número (WhatsApp associado) desta conversa — deixa explícito por qual número
  // você está falando. A conversa fica travada nele.
  const waChannel =
    conversation.channel === "whatsapp" && conversation.channelId
      ? channels.find((c) => c.id === conversation.channelId)
      : null;

  let lastDay = "";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b bg-white px-4 py-2">
        <div className="flex items-center gap-2.5">
          <Avatar className="size-8">
            <AvatarFallback className="bg-slate-200 text-[11px] font-bold text-slate-600">
              {(contact.firstName[0] ?? "?").toUpperCase()}
              {(contact.lastName[0] ?? "").toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div>
            <p className="text-sm font-semibold text-slate-800">{contactName(contact)}</p>
            <p className="text-[10px] text-slate-400">{contact.phone}</p>
          </div>
          {waChannel && (
            <span
              title="Número por onde esta conversa trafega — ela fica travada nele"
              className="hidden items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 sm:inline-flex"
            >
              via {waChannel.phoneE164 || waChannel.name}
            </span>
          )}
          <SlaBadge days={conversation.slaDays} />
        </div>
        <div className="flex items-center gap-1.5">
          <AssignPicker conversation={conversation} onGone={onDeleted} />
          <button
            onClick={async () => {
              await conversationActions.markUnread(conversation.id);
              toast.success("Marcada como não lida");
            }}
            title="Marcar como não lida (volta pra caixa como pendente)"
            className="flex size-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100"
          >
            <Mail className="size-3.5" />
          </button>
          <button
            onClick={async () => {
              // Reabrir vai direto; finalizar passa pela confirmação.
              if (!conversation.closedAt) {
                setConfirmStatus("finalizar");
                return;
              }
              const ok = await conversationActions.close(conversation.id, false);
              if (!ok) {
                toast.error("Não foi possível atualizar a conversa");
                return;
              }
              toast.success("Conversa reaberta");
            }}
            title={
              conversation.closedAt
                ? "Reabrir o atendimento"
                : "Marcar o atendimento como resolvido"
            }
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium",
              conversation.closedAt
                ? "text-emerald-600 hover:bg-emerald-50"
                : "text-slate-500 hover:bg-slate-100"
            )}
          >
            <CheckCircle2 className="size-3.5" />
            {conversation.closedAt ? "Reabrir" : "Finalizar"}
          </button>
          <button
            onClick={async () => {
              if (!conversation.archivedAt) {
                setConfirmStatus("arquivar");
                return;
              }
              const ok = await conversationActions.archive(conversation.id, false);
              if (!ok) {
                toast.error("Não foi possível atualizar a conversa");
                return;
              }
              toast.success("Conversa desarquivada");
            }}
            title={
              conversation.archivedAt
                ? "Tirar do arquivo"
                : "Arquivar (sai da caixa, nada é excluído)"
            }
            className={cn(
              "flex size-7 items-center justify-center rounded-md hover:bg-slate-100",
              conversation.archivedAt ? "text-indigo-600" : "text-slate-400"
            )}
          >
            <Archive className="size-4" />
          </button>
          <button
            onClick={() => {
              if (!contact.phone?.trim()) {
                toast.error("Contato sem telefone cadastrado");
                return;
              }
              callContact(contact.phone, contactName(contact));
            }}
            title="Abrir o webphone com este número"
            className="flex items-center gap-1.5 rounded-full bg-[var(--lito-wa-green)] px-3 py-1 text-xs font-bold text-white hover:opacity-90"
          >
            <Phone className="size-3.5" /> Ligar
          </button>
          <button
            onClick={() => conversationActions.star(conversation.id)}
            className="flex size-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100"
          >
            <Star
              className={cn(
                "size-4",
                conversation.starred && "fill-amber-400 text-amber-400"
              )}
            />
          </button>
          {/* Excluir apaga o histórico junto e não tem desfazer — é do admin.
              Quem não é admin usa "Arquivar", que tira da vista sem destruir.
              A RLS da 0040 reforça: esconder o botão não bastaria. */}
          {isAdmin && (
            <button
              onClick={() => setConfirmOpen(true)}
              title="Excluir conversa"
              className="flex size-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-rose-600"
            >
              <Trash2 className="size-4" />
            </button>
          )}
          <Dialog
            open={confirmStatus !== null}
            onOpenChange={(o) => !o && setConfirmStatus(null)}
          >
            <DialogContent className="sm:max-w-sm">
              <DialogHeader>
                <DialogTitle>
                  {confirmStatus === "arquivar" ? "Arquivar conversa?" : "Finalizar conversa?"}
                </DialogTitle>
              </DialogHeader>
              <p className="text-xs leading-relaxed text-slate-500">
                {confirmStatus === "arquivar" ? (
                  <>
                    A conversa com{" "}
                    <strong className="text-slate-800">{contactName(contact)}</strong> sai da
                    caixa de entrada. <strong className="text-slate-800">Nada é excluído</strong>{" "}
                    — ela continua na aba Arquivadas, e volta sozinha se o cliente responder.
                  </>
                ) : (
                  <>
                    O atendimento de{" "}
                    <strong className="text-slate-800">{contactName(contact)}</strong> passa a
                    contar como resolvido e vai para a aba Finalizadas. Dá para reabrir a
                    qualquer momento, e uma nova mensagem do cliente reabre sozinha.
                  </>
                )}
              </p>
              <DialogFooter>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => setConfirmStatus(null)}
                >
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  className="h-8 text-xs"
                  disabled={statusBusy}
                  onClick={() => void applyStatus()}
                >
                  {statusBusy
                    ? "Aguarde..."
                    : confirmStatus === "arquivar"
                      ? "Arquivar"
                      : "Finalizar"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <DialogContent className="sm:max-w-sm">
              <DialogHeader>
                <DialogTitle>Excluir conversa?</DialogTitle>
              </DialogHeader>
              <p className="text-xs leading-relaxed text-slate-500">
                A conversa com <strong className="text-slate-800">{contactName(contact)}</strong> e todas as
                mensagens dela serão removidas. Essa ação não pode ser desfeita.
              </p>
              <DialogFooter>
                <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setConfirmOpen(false)}>
                  Cancelar
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={async () => {
                    const ok = await conversationActions.remove(conversation.id);
                    setConfirmOpen(false);
                    if (ok) {
                      toast.success("Conversa excluída");
                      onDeleted?.();
                    } else {
                      toast.error(
                        "Não foi possível excluir — apenas administradores podem"
                      );
                    }
                  }}
                >
                  Excluir
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>
      <StatusBanner conversation={conversation} />
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
        }}
        className="min-h-0 flex-1 overflow-y-auto bg-slate-50 p-4 [scrollbar-width:thin]"
      >
        <div ref={contentRef} className="space-y-2">
        {loadingMessages && messages.length === 0 && (
          <div className="flex items-center justify-center gap-2 py-10 text-xs text-slate-400">
            <Loader2 className="size-4 animate-spin" /> Carregando conversa...
          </div>
        )}
        {messages.map((m) => {
          const day = format(new Date(m.at), "d 'de' MMMM", { locale: ptBR });
          const showDay = day !== lastDay;
          lastDay = day;
          return (
            <div key={m.id}>
              {showDay && (
                <div className="my-3 flex justify-center">
                  <span className="flex items-center gap-1 rounded-full bg-white px-3 py-1 text-[10px] font-medium text-slate-400 shadow-sm">
                    <CalendarDays className="size-3" /> {day}
                  </span>
                </div>
              )}
              <MessageBubble message={m} />
            </div>
          );
        })}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}
