"use client";

import { useRef, useState } from "react";
import {
  Clock,
  DollarSign,
  Eye,
  Loader2,
  Mic,
  Paperclip,
  Send,
  Smile,
  Square,
  Tag,
  Trash2,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ScheduleDialog } from "./schedule-dialog";
import { channelLabel } from "@/components/shared/channel-icon";
import { conversationActions, useConversation, useSnippets } from "@/lib/data/repos/db/conversations";
import { dbContactActions } from "@/lib/data/repos/db/contacts";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Channel } from "@/lib/data/types";
import { cn } from "@/lib/utils";

const CHANNELS: Channel[] = ["whatsapp", "sms", "email"];

const EMOJIS = "😀 😁 😂 🤣 😊 😍 😘 😎 🤩 🥳 👍 👏 🙏 💪 🔥 🎉 ✅ ❤️ 💜 💙 ⭐ ✨ 📌 📎 📅 ⏰ 💰 📞 💬 👋".split(" ");

const QUICK_REPLIES = [
  "Olá! Tudo bem? 👋",
  "Obrigado pelo contato! Em que posso ajudar?",
  "Só um momento, já verifico isso pra você.",
  "Perfeito! Vou dar andamento.",
  "Qualquer dúvida, estou à disposição. 😊",
];

export function Composer({ conversationId }: { conversationId: string }) {
  const [channel, setChannel] = useState<Channel>("whatsapp");
  const [internal, setInternal] = useState(false);
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState("");
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recSecs, setRecSecs] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelRef = useRef(false);
  const snippets = useSnippets();
  const conversation = useConversation(conversationId);
  const contactId = conversation?.contactId ?? null;

  const fmtSecs = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  const uploadFile = async (file: File) => {
    const isImg = file.type.startsWith("image/");
    const name = file.name.toLowerCase();
    const isDoc =
      file.type === "application/pdf" ||
      name.endsWith(".pdf") ||
      file.type.includes("wordprocessingml") ||
      name.endsWith(".docx");
    if (!isImg && !isDoc) {
      toast.error("Aceito imagens, PDF ou DOCX");
      return;
    }
    setUploading(true);
    const res = await conversationActions.sendMedia(conversationId, {
      file,
      kind: isImg ? "image" : "file",
      channel,
    });
    setUploading(false);
    if (res.ok) toast.success(isImg ? "Imagem enviada" : "Arquivo enviado");
    else toast.error(res.error ?? "Não foi possível enviar");
  };

  const startRec = async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      toast.error("Gravação de áudio não é suportada neste navegador");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      cancelRef.current = false;
      mr.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data);
      };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (timerRef.current) clearInterval(timerRef.current);
        setRecording(false);
        if (cancelRef.current) return;
        const secs = Math.max(1, Math.round((Date.now() - startedRef.current) / 1000));
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const file = new File([blob], `audio-${secs}s.webm`, { type: "audio/webm" });
        setUploading(true);
        const res = await conversationActions.sendMedia(conversationId, {
          file,
          kind: "audio",
          channel,
          duration: fmtSecs(secs),
        });
        setUploading(false);
        if (res.ok) toast.success("Áudio enviado");
        else toast.error(res.error ?? "Não foi possível enviar o áudio");
      };
      startedRef.current = Date.now();
      mr.start();
      recorderRef.current = mr;
      setRecSecs(0);
      setRecording(true);
      timerRef.current = setInterval(() => setRecSecs((s) => s + 1), 1000);
    } catch {
      toast.error("Não foi possível acessar o microfone — verifique a permissão");
    }
  };

  const stopRec = (cancel: boolean) => {
    cancelRef.current = cancel;
    recorderRef.current?.stop();
  };

  const addTag = async () => {
    const t = tagInput.trim();
    if (!t || !contactId) return;
    const ok = await dbContactActions.addTag([contactId], t);
    if (ok) {
      toast.success(`Tag "${t}" adicionada ao contato`);
      setTagInput("");
    } else {
      toast.error("Não foi possível adicionar a tag");
    }
  };

  const send = async (scheduledFor?: string) => {
    const text = channel === "email" && subject ? `[${subject}] ${body}` : body;
    if (!text.trim()) {
      toast.error("Escreva uma mensagem antes de enviar");
      return;
    }
    setSending(true);
    const ok = await conversationActions.send(conversationId, {
      direction: "out",
      type: "text",
      channel,
      body: text.trim(),
      internal: internal || undefined,
      scheduledFor,
    });
    setSending(false);
    if (!ok) {
      toast.error("Não foi possível enviar — tente novamente");
      return;
    }
    setBody("");
    setSubject("");
    toast.success(
      scheduledFor
        ? "Mensagem agendada"
        : internal
          ? "Comentário interno adicionado"
          : `Mensagem enviada via ${channelLabel(channel)}`
    );
  };

  return (
    <div className={cn("border-t bg-white p-3", internal && "bg-amber-50/60")}>
      <div className="mb-2 flex items-center gap-2">
        <Select value={channel} onValueChange={(v) => v && setChannel(v as Channel)}>
          <SelectTrigger className="h-7 w-[130px] text-xs" size="sm">
            <SelectValue>{channelLabel(channel)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {CHANNELS.map((c) => (
              <SelectItem key={c} value={c} className="text-xs">
                {channelLabel(c)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <button
          onClick={() => setInternal((v) => !v)}
          className={cn(
            "flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium",
            internal
              ? "bg-amber-200 text-amber-900"
              : "text-slate-500 hover:bg-slate-100"
          )}
        >
          <Eye className="size-3" /> Comentário Interno
        </button>
        {channel === "email" && !internal && (
          <Input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Assunto"
            className="h-7 flex-1 text-xs"
          />
        )}
      </div>
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
        placeholder={
          internal
            ? "Escreva uma nota interna (o lead não vê)"
            : `Digite uma mensagem (${channelLabel(channel)})`
        }
        className="min-h-16 resize-none text-sm"
      />
      {recording && (
        <div className="mt-2 flex items-center gap-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2">
          <span className="size-2.5 animate-pulse rounded-full bg-rose-500" />
          <span className="text-xs font-semibold text-rose-700">
            Gravando áudio… {fmtSecs(recSecs)}
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <button
              onClick={() => stopRec(true)}
              title="Descartar gravação"
              className="flex size-7 items-center justify-center rounded-md text-slate-500 hover:bg-white"
            >
              <Trash2 className="size-4" />
            </button>
            <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => stopRec(false)}>
              <Square className="size-3 fill-current" /> Enviar áudio
            </Button>
          </div>
        </div>
      )}
      {!recording && (
      <div className="mt-2 flex items-center justify-between">
        <div className="flex items-center gap-0.5">
          {/* Emoji */}
          <Popover>
            <PopoverTrigger
              render={
                <button
                  title="Emoji"
                  className="flex size-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                />
              }
            >
              <Smile className="size-4" />
            </PopoverTrigger>
            <PopoverContent align="start" className="w-56 p-2">
              <div className="grid grid-cols-8 gap-1">
                {EMOJIS.map((e) => (
                  <button key={e} onClick={() => setBody((b) => b + e)} className="rounded p-1 text-lg hover:bg-slate-100">
                    {e}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>

          {/* Anexo (imagem, PDF ou DOCX) */}
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,.pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadFile(f);
              e.target.value = "";
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            title="Anexar imagem, PDF ou DOCX"
            className="flex size-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
          >
            {uploading ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />}
          </button>

          {/* Áudio (gravação pelo microfone) */}
          <button
            onClick={startRec}
            disabled={uploading}
            title="Gravar áudio"
            className="flex size-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
          >
            <Mic className="size-4" />
          </button>

          {/* Tag no contato */}
          <Popover>
            <PopoverTrigger
              render={
                <button
                  title="Adicionar tag ao contato"
                  className="flex size-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                />
              }
            >
              <Tag className="size-4" />
            </PopoverTrigger>
            <PopoverContent align="start" className="w-60 p-3">
              <Label className="text-xs">Adicionar tag ao contato</Label>
              <div className="mt-1.5 flex gap-1.5">
                <Input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addTag()}
                  placeholder="Ex.: quente"
                  className="h-8 text-xs"
                />
                <Button size="sm" className="h-8 text-xs" onClick={addTag} disabled={!tagInput.trim() || !contactId}>
                  Add
                </Button>
              </div>
            </PopoverContent>
          </Popover>

          {/* Respostas rápidas */}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  title="Respostas rápidas"
                  className="flex size-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                />
              }
            >
              <Zap className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              <DropdownMenuLabel className="text-[10px] text-slate-400">Respostas rápidas</DropdownMenuLabel>
              {QUICK_REPLIES.map((q) => (
                <DropdownMenuItem key={q} className="text-xs" onClick={() => setBody((b) => (b ? `${b} ${q}` : q))}>
                  {q}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Link de cobrança (área Pagamentos) */}
          <button
            onClick={() => toast.info("Link de cobrança chega com o módulo Pagamentos")}
            title="Link de cobrança"
            className="flex size-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <DollarSign className="size-4" />
          </button>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  onClick={() => setScheduleOpen(true)}
                  className="flex size-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                />
              }
            >
              <Clock className="size-4" />
            </TooltipTrigger>
            <TooltipContent className="text-[10px]">Agendar mensagem</TooltipContent>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button className="ml-1 rounded-md px-2 py-1 text-[11px] font-medium text-indigo-600 hover:bg-indigo-50" />
              }
            >
              Trechos
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              <DropdownMenuLabel className="text-[10px] text-slate-400">
                Respostas rápidas
              </DropdownMenuLabel>
              {snippets.length === 0 && (
                <DropdownMenuItem disabled className="text-xs text-slate-400">
                  Nenhum trecho — crie na aba Trechos
                </DropdownMenuItem>
              )}
              {snippets.map((s) => (
                <DropdownMenuItem
                  key={s.id}
                  className="flex-col items-start text-xs"
                  onClick={() => setBody((b) => (b ? `${b} ${s.content}` : s.content))}
                >
                  <span className="font-semibold">{s.name}</span>
                  <span className="line-clamp-1 text-[10px] text-slate-400">{s.content}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <Button
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={() => send()}
          disabled={sending || uploading}
        >
          <Send className="size-3.5" /> {sending ? "Enviando..." : "Enviar"}
        </Button>
      </div>
      )}
      <ScheduleDialog
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        onSchedule={(iso) => send(iso)}
      />
    </div>
  );
}
