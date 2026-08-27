"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Clock,
  CornerUpLeft,
  Lock,
  DollarSign,
  Eye,
  LayoutTemplate,
  Loader2,
  Mic,
  Paperclip,
  Send,
  Smile,
  Square,
  Tag,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { inspecionarAudio, resumoDaInspecao } from "@/lib/whatsapp/audio";
import { audioParaMp3 } from "@/lib/whatsapp/to-mp3";
import OpusMediaRecorder from "opus-media-recorder";
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
import {
  conversationActions,
  useConversation,
  useMessages,
  useReplyStore,
  useReplyTarget,
  useSnippets,
  useTemplateIntentStore,
} from "@/lib/data/repos/db/conversations";
import { whatsappActions } from "@/lib/data/repos/db/whatsapp";
import { TemplatePicker } from "@/components/whatsapp/template-picker";
import { dbContactActions, useDbContact } from "@/lib/data/repos/db/contacts";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Channel, Message } from "@/lib/data/types";
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

/** Resumo de uma mensagem para a prévia da citação (texto ou rótulo de mídia). */
function msgSnippet(m: Message): string {
  if (m.type === "image") return "🖼️ Imagem";
  if (m.type === "video") return "🎬 Vídeo";
  if (m.type === "audio") return "🎧 Áudio";
  if (m.type === "file") return `📎 ${m.mediaName ?? "Arquivo"}`;
  const t = (m.body ?? "").replace(/\s+/g, " ").trim();
  return t.length > 120 ? `${t.slice(0, 120)}…` : t || "Mensagem";
}

/**
 * Devolve o microfone garantidamente em UM canal.
 *
 * ⚠️ **A Cloud API do WhatsApp aceita `audio/ogg` só com OPUS e só MONO.** Áudio
 * estéreo passa no upload (a Meta responde 200 e devolve id de mensagem) e é
 * rejeitado depois, no processamento: o webhook de status volta com
 * `errors[0].title = "Media upload error"` (código 131053). Foi o que apareceu
 * no balão depois que o motivo passou a ser gravado.
 *
 * ⚠️ **O `opus-media-recorder` tira o número de canais do MICROFONE**, não de
 * opção nossa — em `start()` ele faz
 * `channelCount = track.getSettings().channelCount || 1` e monta o
 * `ScriptProcessor` com esse valor. Então quem tem microfone/headset que
 * reporta 2 canais gravava Opus estéreo, e a Meta descartava. É a explicação de
 * "ALGUNS usuários": dependia do aparelho, não do CRM.
 *
 * Duas camadas, porque a primeira não é garantia:
 *   1. pedir mono na constraint (`channelCount: 1`) — a maioria dos navegadores
 *      atende, e aí não há trabalho extra;
 *   2. se o track AINDA reportar mais de um canal, misturar para mono no Web
 *      Audio. `{ exact: 1 }` na constraint resolveria em uma linha, mas lança
 *      `OverconstrainedError` no aparelho que não sabe abrir em mono — e aí o
 *      atendente perde a gravação inteira em vez de perder um canal.
 *
 * Mono também é o certo para recado de voz por si só: metade dos bytes, e voz
 * captada por um microfone não tem informação estéreo nenhuma para preservar.
 */
/**
 * Formato em que o áudio será gravado.
 *
 * ⚠️ **MP4/AAC vem primeiro, e a razão é dura de engolir: a Cloud API do
 * WhatsApp não processa o Ogg/Opus que o `opus-media-recorder` produz.** Foram
 * NOVE rodadas provando que o arquivo está bom: mono, `pre-skip` conforme a RFC
 * 7845, OpusTags, EOS, CRC de todas as páginas conferindo, sem truncamento,
 * granule coerente. A Meta recusa com #131053 de todo jeito.
 *
 * A prova de que o problema não é nosso veio ao enviar por `link`, com a Meta
 * baixando o arquivo direto do Storage: o multipart saiu do caminho, nós não
 * declaramos mimetype nenhum, **e a mensagem de erro voltou idêntica** — palavra
 * por palavra, inclusive a parte sobre mimetype. Ou seja, aquele texto é modelo
 * fixo da Meta, não medição, e usá-lo como pista foi o que custou as rodadas.
 *
 * `audio/mp4` (AAC) é formato de primeira classe na lista da Cloud API, o
 * `MediaRecorder` NATIVO do Chrome 111+ e do Safari grava nele, e isso tira da
 * jogada o encoder WebAssembly de terceiro — que é o único componente que
 * sobrou como suspeito.
 *
 * O Ogg/Opus fica como reserva para navegador sem suporte a MP4: é o que existia
 * e continua tocando no inbox, mesmo que a Meta o recuse.
 */
function formatoDeGravacao():
  | { tipo: "mp4"; mime: string; ext: string }
  | { tipo: "ogg"; mime: string; ext: string } {
  const nativo = typeof MediaRecorder !== "undefined";
  // A ordem importa: a primeira que o navegador suportar ganha.
  const candidatos = ["audio/mp4", "audio/mp4;codecs=mp4a.40.2", "audio/aac"];
  if (nativo) {
    for (const c of candidatos) {
      if (MediaRecorder.isTypeSupported(c)) return { tipo: "mp4", mime: c, ext: "m4a" };
    }
  }
  return { tipo: "ogg", mime: "audio/ogg", ext: "ogg" };
}

async function microfoneMono(): Promise<{ stream: MediaStream; encerrar: () => void }> {
  const bruto = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: { ideal: 1 }, sampleRate: { ideal: 48000 } },
  });
  const canais = bruto.getAudioTracks()[0]?.getSettings().channelCount;
  // `undefined` conta como mono: é o que o próprio opus-media-recorder assume
  // (`|| 1`), então concordar com ele evita uma remixagem desnecessária.
  if (canais === undefined || canais <= 1) {
    return { stream: bruto, encerrar: () => bruto.getTracks().forEach((t) => t.stop()) };
  }

  const ctx = new AudioContext();
  const destino = ctx.createMediaStreamDestination();
  // `channelCount 1` + "explicit"/"speakers": o nó recebe N canais e entrega 1,
  // somando — é a mistura que se quer, e não o descarte de um dos lados.
  destino.channelCount = 1;
  destino.channelCountMode = "explicit";
  destino.channelInterpretation = "speakers";
  ctx.createMediaStreamSource(bruto).connect(destino);
  return {
    stream: destino.stream,
    encerrar: () => {
      bruto.getTracks().forEach((t) => t.stop());
      destino.stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
    },
  };
}

export function Composer({ conversationId }: { conversationId: string }) {
  const [channel, setChannel] = useState<Channel>("whatsapp");
  const [internal, setInternal] = useState(false);
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState("");
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [uploading, setUploading] = useState(false);
  // Imagem colada (Ctrl+V) aguardando confirmação — mostra a prévia e só envia
  // no botão Enviar (usando o texto como legenda).
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const pendingUrl = useMemo(
    () => (pendingImage ? URL.createObjectURL(pendingImage) : null),
    [pendingImage]
  );
  useEffect(() => {
    return () => {
      if (pendingUrl) URL.revokeObjectURL(pendingUrl);
    };
  }, [pendingUrl]);
  const [recording, setRecording] = useState(false);
  const [recSecs, setRecSecs] = useState(0);
  const [templateOpen, setTemplateOpen] = useState(false);
  // Diferencia "abri porque quis" de "abri porque a janela de 24h fechou" — o
  // texto do seletor muda.
  const [templateForced, setTemplateForced] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // opus-media-recorder não tem types próprios (módulo declarado como `any`
  // em src/types/opus-media-recorder.d.ts) — a API é compatível com MediaRecorder.
  const recorderRef = useRef<InstanceType<typeof OpusMediaRecorder> | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelRef = useRef(false);
  const snippets = useSnippets();
  const conversation = useConversation(conversationId);
  const contactId = conversation?.contactId ?? null;
  const { contact } = useDbContact(contactId);
  const isWhatsapp = conversation?.channel === "whatsapp" && !!conversation?.channelId;
  // Responder (citação): mensagem marcada na bolha para esta conversa.
  const replyTarget = useReplyTarget(conversationId);
  const clearReply = useReplyStore((s) => s.clearReply);
  // Trocar de conversa descarta um alvo de citação pendente (não vaza entre elas).
  useEffect(() => {
    clearReply();
  }, [conversationId, clearReply]);

  // "Enviar template" vindo do relatório (janela de 24h fechada): abre o seletor
  // de template ao entrar na conversa.
  const templateIntentConv = useTemplateIntentStore((s) => s.conversationId);
  useEffect(() => {
    if (templateIntentConv && templateIntentConv === conversationId) {
      useTemplateIntentStore.getState().consume(conversationId);
      setTemplateForced(true);
      setTemplateOpen(true);
    }
  }, [conversationId, templateIntentConv]);
  const messages = useMessages(conversationId);

  /**
   * Janela de 24h do WhatsApp: fora dela a Meta só aceita template aprovado.
   *
   * Antes o CRM só descobria isso DEPOIS de a pessoa escrever e clicar em
   * enviar — a rota respondia 409 e o seletor de template abria por cima, com o
   * texto digitado perdido. Agora o estado é calculado aqui e o campo já nasce
   * bloqueado, com o caminho certo à mão.
   *
   * A conta é sobre a última mensagem DE ENTRADA (nota interna e mensagem nossa
   * não reabrem janela nenhuma). Sem nenhuma entrada, a janela nunca foi aberta.
   * Só vale para conversa de WhatsApp com canal conectado — nos outros canais
   * essa regra não existe.
   */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    // A janela expira com a tela aberta; sem isto o campo seguiria liberado.
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const lastInboundAt = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.direction === "in" && !m.internal) return m.at;
    }
    return null;
  }, [messages]);

  const WINDOW_MS = 24 * 60 * 60 * 1000;
  const windowClosed =
    isWhatsapp && (!lastInboundAt || now - new Date(lastInboundAt).getTime() > WINDOW_MS);
  // Nota interna não sai do CRM: continua livre com a janela fechada.
  const blocked = windowClosed && !internal;
  // Conversa finalizada/arquivada: não dá pra mandar mensagem (o cliente precisa
  // reabrir, ou manda-se um template — que reabre e atribui a quem enviou).
  // Nota interna continua liberada (não sai do CRM).
  const isClosed = !!conversation?.closedAt || !!conversation?.archivedAt;
  const blockedClosed = isClosed && !internal;

  const fmtSecs = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  const uploadFile = async (file: File, caption?: string) => {
    // Conversa finalizada/arquivada: mídia também não sai (clipe e colar).
    if (conversation?.closedAt || conversation?.archivedAt) {
      toast.error("Reabra a conversa (ou envie um template) para enviar mídia.");
      return;
    }
    const isImg = file.type.startsWith("image/");
    const isVideo = file.type.startsWith("video/");
    const name = file.name.toLowerCase();
    const isDoc =
      file.type === "application/pdf" ||
      name.endsWith(".pdf") ||
      file.type.includes("wordprocessingml") ||
      name.endsWith(".docx");
    if (!isImg && !isVideo && !isDoc) {
      toast.error("Aceito imagem, vídeo, PDF ou DOCX");
      return;
    }
    const kind = isImg ? "image" : isVideo ? "video" : "file";
    setUploading(true);
    const res = await conversationActions.sendMedia(conversationId, {
      file,
      kind,
      channel,
    });
    setUploading(false);
    if (res.ok) {
      toast.success(isImg ? "Imagem enviada" : isVideo ? "Vídeo enviado" : "Arquivo enviado");
      if (
        isWhatsapp &&
        res.messageId &&
        res.mediaPath &&
        (kind === "image" || kind === "video" || kind === "file")
      ) {
        const wa = await whatsappActions.sendMedia({
          conversationId,
          channelId: conversation?.channelId,
          messageId: res.messageId,
          mediaPath: res.mediaPath,
          mime: res.mime,
          // "file" no CRM = "document" na Cloud API (com o nome do arquivo).
          kind: kind === "file" ? "document" : kind,
          filename: kind === "file" ? file.name : undefined,
          caption: caption?.trim() || undefined,
        });
        if (!wa.ok) {
          toast.error(
            wa.needsTemplate
              ? "Janela de 24h fechada — envie um template antes."
              : wa.error ?? "A mídia ficou no inbox, mas falhou ao enviar no WhatsApp."
          );
        }
      }
    } else {
      toast.error(res.error ?? "Não foi possível enviar");
    }
  };

  const startRec = async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      toast.error("Gravação de áudio não é suportada neste navegador");
      return;
    }
    // Fora do try: se a construção do gravador estourar depois de o microfone
    // abrir, o `catch` ainda precisa fechá-lo — senão o indicador de gravação do
    // navegador fica aceso sem nada gravando.
    let encerrar: (() => void) | null = null;
    try {
      const mic = await microfoneMono();
      const stream = mic.stream;
      encerrar = mic.encerrar;
      const fmt = formatoDeGravacao();
      /*
       * ⚠️ O mime GRAVADO no arquivo é sempre a forma sem parâmetro
       * (`audio/mp4`), mesmo quando o `isTypeSupported` só aceitou a forma com
       * codec (`audio/mp4;codecs=mp4a.40.2`). A lista de tipos aceitos da Cloud
       * API não tem parâmetro, e essa distinção já custou rodadas de
       * investigação — o servidor limpa de novo, mas não é motivo para sujar
       * aqui.
       */
      const mimeArquivo = fmt.tipo === "mp4" ? "audio/mp4" : "audio/ogg";
      const mr =
        fmt.tipo === "mp4"
          ? new MediaRecorder(stream, { mimeType: fmt.mime })
          : new OpusMediaRecorder(
              stream,
              { mimeType: fmt.mime },
              {
                encoderWorkerFactory: () =>
                  new Worker("/opus-media-recorder/encoderWorker.umd.js"),
                OggOpusEncoderWasmPath: "/opus-media-recorder/OggOpusEncoder.wasm",
              }
            );
      chunksRef.current = [];
      cancelRef.current = false;
      mr.ondataavailable = (e: BlobEvent) => {
        if (e.data.size) chunksRef.current.push(e.data);
      };
      mr.onstop = async () => {
        encerrar?.(); // para o microfone E fecha o AudioContext da remixagem
        if (timerRef.current) clearInterval(timerRef.current);
        setRecording(false);
        if (cancelRef.current) return;
        const secs = Math.max(1, Math.round((Date.now() - startedRef.current) / 1000));
        const bruto = new Blob(chunksRef.current, { type: mimeArquivo });

        /*
         * ⚠️ **Chrome grava Ogg/Opus e ESTA conta da Meta recusa todo Ogg/Opus**
         * (#131053), mesmo arquivo impecável e recebido IDÊNTICO — imagem/vídeo
         * passam pelo mesmo caminho, então é o formato do áudio. O Chrome não
         * grava mp4/aac, então transcodificamos Ogg → **MP3** aqui (audio/mpeg,
         * aceito universalmente). Só o ramo Ogg transcodifica; mp4/aac (Safari)
         * já é aceito e vai direto. Se a transcodificação falhar, manda o Ogg
         * mesmo — melhor tentar do que travar.
         */
        let file: File;
        if (fmt.tipo === "ogg") {
          try {
            file = await audioParaMp3(bruto, secs);
          } catch (e) {
            console.warn("[audio] falha ao transcodificar para MP3, enviando Ogg:", e);
            file = new File([bruto], `audio-${secs}s.ogg`, { type: "audio/ogg" });
          }
        } else {
          file = new File([bruto], `audio-${secs}s.${fmt.ext}`, { type: mimeArquivo });
        }

        /*
         * Mesma inspeção que a rota faz nos bytes (`lib/whatsapp/audio.ts`), aqui
         * só para avisar antes da viagem — a decisão de recusar é do servidor,
         * que é quem grava o motivo no balão. Roda no arquivo FINAL (já em MP3
         * quando transcodificou).
         */
        const insp = inspecionarAudio(await file.arrayBuffer());
        if (!insp.aceitavel) {
          console.warn(`[audio] ${insp.motivo} — ${resumoDaInspecao(insp)}`);
          toast.warning(insp.motivo);
        }
        setUploading(true);
        const res = await conversationActions.sendMedia(conversationId, {
          file,
          kind: "audio",
          channel,
          duration: fmtSecs(secs),
        });
        setUploading(false);
        if (res.ok) {
          // ⚠️ O "Áudio enviado" ficava AQUI, antes de tentar a entrega — o
          // atendente lia "enviado" e só depois via o erro, ou nem via se o
          // toast já tinha sumido. Gravar no inbox não é entregar ao cliente:
          // o sucesso só é anunciado depois que a Cloud API aceitou.
          if (isWhatsapp && res.messageId && res.mediaPath) {
            const wa = await whatsappActions.sendMedia({
              conversationId,
              channelId: conversation?.channelId,
              messageId: res.messageId,
              mediaPath: res.mediaPath,
              mime: res.mime,
              kind: "audio",
            });
            if (wa.ok) toast.success("Áudio enviado");
            else {
              toast.error(
                wa.needsTemplate
                  ? "Janela de 24h fechada — envie um template antes."
                  : wa.error ?? "O áudio ficou no inbox, mas falhou ao enviar no WhatsApp.",
                // O motivo agora fica gravado e aparece no próprio balão, então
                // o toast pode sumir sem levar a informação embora.
                { description: "O motivo ficou registrado na mensagem, no fio da conversa." }
              );
            }
          } else {
            toast.success("Áudio enviado");
          }
        } else {
          toast.error(res.error ?? "Não foi possível enviar o áudio");
        }
      };
      startedRef.current = Date.now();
      mr.start();
      recorderRef.current = mr;
      setRecSecs(0);
      setRecording(true);
      timerRef.current = setInterval(() => setRecSecs((s) => s + 1), 1000);
    } catch {
      encerrar?.();
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
    // Conversa finalizada/arquivada: não envia mensagem (só nota interna ou template).
    if (blockedClosed) {
      toast.error("Reabra a conversa (ou envie um template) para responder.");
      return;
    }
    // Imagem colada aguardando: o Enviar manda a imagem (texto = legenda).
    if (pendingImage && !internal && !scheduledFor) {
      const file = pendingImage;
      const caption = body;
      setPendingImage(null);
      setBody("");
      await uploadFile(file, caption);
      return;
    }
    if (conversation?.channel === "whatsapp" && !conversation?.channelId && !internal && !scheduledFor) {
      toast.error("Cadastre um canal de WhatsApp em Canais de atendimento para enviar.");
      return;
    }
    // WhatsApp real: envia pela Cloud API. Envio OTIMISTA — a mensagem aparece na
    // hora (não espera o round-trip); ao voltar, troca pela real (ou desfaz).
    if (isWhatsapp && !internal && !scheduledFor) {
      const text = body.trim();
      if (!text) {
        toast.error("Escreva uma mensagem antes de enviar");
        return;
      }
      const replyId = replyTarget?.id;
      const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const optimistic: Message = {
        id: tempId,
        conversationId,
        direction: "out",
        type: "text",
        channel: "whatsapp",
        body: text,
        at: new Date().toISOString(),
        status: "sent",
        replyTo: replyId,
      };
      // Mostra na hora e libera o campo para a próxima mensagem.
      setBody("");
      clearReply();
      conversationActions.pushOptimistic(optimistic);
      const res = await whatsappActions.send({
        conversationId,
        channelId: conversation?.channelId,
        text,
        replyTo: replyId,
      });
      conversationActions.dropOptimistic(tempId);
      if (res.ok) {
        conversationActions.pushSent(res.message);
      } else if (res.needsTemplate) {
        setBody(text); // devolve o texto para o usuário
        setTemplateForced(true);
        setTemplateOpen(true);
      } else {
        setBody(text);
        toast.error(res.error ?? "Não foi possível enviar");
      }
      return;
    }
    const text = channel === "email" && subject ? `[${subject}] ${body}` : body;
    if (!text.trim()) {
      toast.error("Escreva uma mensagem antes de enviar");
      return;
    }
    setSending(true);
    const res = await conversationActions.send(conversationId, {
      direction: "out",
      type: "text",
      channel,
      body: text.trim(),
      internal: internal || undefined,
      scheduledFor,
      replyTo: replyTarget?.id,
    });
    setSending(false);
    if (!res.ok) {
      // Mostra o motivo real (RLS, coluna, FK) em vez do genérico "tente novamente".
      toast.error(res.error ?? "Não foi possível enviar — tente novamente");
      return;
    }
    setBody("");
    setSubject("");
    clearReply();
    if (scheduledFor) {
      toast.success("Mensagem agendada — acompanhe na aba Agendadas");
      // Agendar sem canal conectado é permitido (dá tempo de conectar até lá),
      // mas o disparo falha se continuar assim — melhor avisar agora.
      if (channel === "whatsapp" && !internal && !conversation?.channelId) {
        toast.warning(
          "Sem canal de WhatsApp conectado, o disparo vai falhar. Cadastre em Canais de atendimento."
        );
      }
      return;
    }
    toast.success(
      internal
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
      {blockedClosed && (
        <div className="mb-2 rounded-lg border border-slate-300 bg-slate-100 p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
            <Lock className="size-3.5" />{" "}
            {conversation?.archivedAt ? "Conversa arquivada" : "Conversa finalizada"}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
            Não dá para responder com a conversa{" "}
            {conversation?.archivedAt ? "arquivada" : "finalizada"}.{" "}
            <strong>Reabra</strong> para retomar o atendimento, ou envie um{" "}
            <strong>template</strong> — que reabre a conversa e a atribui a você.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 text-xs"
              onClick={async () => {
                const ok = conversation?.archivedAt
                  ? await conversationActions.archive(conversationId, false)
                  : await conversationActions.close(conversationId, false);
                ok
                  ? toast.success("Conversa reaberta")
                  : toast.error("Não foi possível reabrir");
              }}
            >
              <Lock className="size-3.5" /> Reabrir
            </Button>
            <Button
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => {
                setTemplateForced(true);
                setTemplateOpen(true);
              }}
            >
              <LayoutTemplate className="size-3.5" /> Enviar template
            </Button>
            <button
              onClick={() => setInternal(true)}
              className="text-[11px] font-semibold text-slate-500 hover:underline"
            >
              Escrever comentário interno
            </button>
          </div>
        </div>
      )}
      {blocked && !isClosed && (
        <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-900">
            <Lock className="size-3.5" /> Janela de 24h fechada
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-amber-800">
            {lastInboundAt
              ? `A última mensagem deste contato chegou ${formatDistanceToNow(
                  new Date(lastInboundAt),
                  { locale: ptBR, addSuffix: true },
                )}.`
              : "Este contato ainda não enviou nenhuma mensagem por este número."}{" "}
            Fora das 24h o WhatsApp só permite retomar a conversa com um{" "}
            <strong>template aprovado</strong>. Ao enviar, a janela reabre quando o
            cliente responder.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => {
                setTemplateForced(true);
                setTemplateOpen(true);
              }}
            >
              <LayoutTemplate className="size-3.5" /> Enviar template
            </Button>
            <button
              onClick={() => setInternal(true)}
              className="text-[11px] font-semibold text-amber-800 hover:underline"
            >
              Escrever comentário interno
            </button>
          </div>
        </div>
      )}
      {replyTarget && (
        <div className="mb-2 flex items-stretch gap-2 rounded-lg border border-indigo-200 bg-indigo-50/70 p-2">
          <span className="w-1 shrink-0 rounded-full bg-indigo-400" />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-indigo-600">
              <CornerUpLeft className="size-3" />
              Respondendo a{" "}
              {replyTarget.direction === "in" ? contact?.firstName ?? "contato" : "você"}
            </p>
            <p className="mt-0.5 truncate text-xs text-slate-600">{msgSnippet(replyTarget)}</p>
          </div>
          <button
            onClick={clearReply}
            title="Cancelar resposta"
            className="flex size-6 shrink-0 items-center justify-center self-center rounded-md text-slate-400 hover:bg-slate-200 hover:text-slate-600"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}
      {pendingImage && pendingUrl && (
        <div className="mb-2 flex items-start gap-3 rounded-lg border border-indigo-200 bg-indigo-50/60 p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={pendingUrl}
            alt="Prévia"
            className="max-h-28 max-w-[160px] rounded-md border object-contain"
          />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-slate-700">Imagem colada</p>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Adicione uma legenda no campo abaixo (opcional) e clique em{" "}
              <strong>Enviar</strong>.
            </p>
          </div>
          <button
            onClick={() => setPendingImage(null)}
            title="Descartar imagem"
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-200 hover:text-slate-600"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}
      <Textarea
        value={body}
        disabled={blocked || blockedClosed}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
        onPaste={(e) => {
          // Colar um print (Ctrl+V) manda como imagem no WhatsApp. Só intercepta
          // se o clipboard tiver imagem e não estiver em nota interna; texto cola
          // normal. Envio de mídia não vale para nota interna nem conversa fechada.
          if (internal || blockedClosed) return;
          const items = Array.from(e.clipboardData?.items ?? []);
          const imgItem = items.find((it) => it.type.startsWith("image/"));
          if (!imgItem) return;
          const blob = imgItem.getAsFile();
          if (!blob) return;
          e.preventDefault();
          const ext = (imgItem.type.split("/")[1] || "png").replace("jpeg", "jpg");
          const file = new File([blob], `print.${ext}`, { type: imgItem.type });
          // Não envia direto: mostra a prévia e espera o Enviar.
          setPendingImage(file);
        }}
        placeholder={
          blockedClosed
            ? "Conversa finalizada — reabra para responder"
            : blocked
              ? "Fora da janela de 24h — envie um template para retomar"
              : internal
                ? "Escreva uma nota interna (o lead não vê)"
                : `Digite uma mensagem (${channelLabel(channel)})`
        }
        className="min-h-16 resize-none text-sm disabled:cursor-not-allowed disabled:bg-slate-50"
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
      {!recording && !blocked && !blockedClosed && (
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

          {/* Anexo (imagem, vídeo, PDF ou DOCX) */}
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/3gpp,application/pdf,.pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
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
            title="Anexar imagem, vídeo, PDF ou DOCX"
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

          {/* Template aprovado — atalho direto. Antes o seletor só abria
              sozinho quando a janela de 24h já tinha fechado (erro 409 do
              envio); mandar template por escolha, dentro da janela, não tinha
              caminho nenhum. */}
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  onClick={() => {
                    if (!isWhatsapp) {
                      toast.info(
                        "Templates são do WhatsApp — esta conversa não está num canal conectado."
                      );
                      return;
                    }
                    setTemplateForced(false);
                    setTemplateOpen(true);
                  }}
                  className={cn(
                    "flex size-7 items-center justify-center rounded-md hover:bg-slate-100 hover:text-slate-600",
                    isWhatsapp ? "text-slate-400" : "text-slate-300"
                  )}
                />
              }
            >
              <LayoutTemplate className="size-4" />
            </TooltipTrigger>
            <TooltipContent className="text-[10px]">Enviar template</TooltipContent>
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
          disabled={sending || uploading || blockedClosed}
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
      <TemplatePicker
        open={templateOpen}
        onOpenChange={setTemplateOpen}
        outsideWindow={templateForced}
        channelId={conversation?.channelId ?? null}
        contactName={contact?.firstName}
        onPick={async (tpl) => {
          setSending(true);
          const res = await whatsappActions.send({
            conversationId,
            channelId: conversation?.channelId,
            template: tpl,
          });
          setSending(false);
          if (res.ok) toast.success("Template enviado");
          else toast.error(res.error ?? "Falha ao enviar template");
        }}
      />
    </div>
  );
}
