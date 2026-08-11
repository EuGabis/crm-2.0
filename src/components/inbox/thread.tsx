"use client";

import { useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  CalendarDays,
  Download,
  FileText,
  Pause,
  Phone,
  Play,
  Star,
  Trash2,
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
import { SlaBadge } from "@/components/shared/sla-badge";
import { contactName } from "@/lib/data/repos/contacts";
import { useDbContact } from "@/lib/data/repos/db/contacts";
import {
  conversationActions,
  useConversation,
  useMessages,
} from "@/lib/data/repos/db/conversations";
import type { Message } from "@/lib/data/types";
import { cn } from "@/lib/utils";

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
        {message.body} ·{" "}
        <button
          onClick={() => toast.info("Detalhes da oportunidade em breve")}
          className="font-semibold text-indigo-600 hover:underline"
        >
          Detalhes
        </button>
      </span>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  if (message.type === "event") return <PipelineEvent message={message} />;
  const isOut = message.direction === "out";
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
        {message.scheduledFor && (
          <p className="mb-0.5 text-[9px] font-bold uppercase tracking-wide opacity-80">
            Agendada
          </p>
        )}
        {message.type === "audio" || message.type === "image" || message.type === "file" ? (
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
        </p>
      </div>
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
  const bottomRef = useRef<HTMLDivElement>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  if (!conversation || !contact) return null;

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
          <SlaBadge days={conversation.slaDays} />
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => toast.info("Ligação via WhatsApp chega com o backend")}
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
          <button
            onClick={() => setConfirmOpen(true)}
            title="Excluir conversa"
            className="flex size-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-rose-600"
          >
            <Trash2 className="size-4" />
          </button>
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
                      toast.error("Não foi possível excluir");
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
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-slate-50 p-4 [scrollbar-width:thin]">
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
  );
}
