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
  Pencil,
  Plus,
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
import { RespostaRapidaDialog } from "./resposta-rapida-dialog";
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
import { TagPicker } from "@/components/contacts/tag-picker";
import { useMyMembership } from "@/lib/data/repos/db/team";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Channel, Message } from "@/lib/data/types";
import { cn } from "@/lib/utils";

const CHANNELS: Channel[] = ["whatsapp", "sms", "email"];

/**
 * Envio de áudio ligado/desligado.
 *
 * ⚠️ A Cloud API da Meta recusa TODO áudio desta conta (WABA) com #131053 —
 * confirmado nos três números, em Ogg e MP4, com o arquivo chegando íntegro à
 * Meta (round-trip idêntico). Texto/templates funcionam; áudio não. Enquanto a
 * Meta não resolver, o microfone fica desligado para ninguém gravar em vão.
 * Religar = mudar para `true` (uma linha) quando a Meta consertar.
 */
/*
 * ⚠️ **Religado em 02/09/2026.** Foi desligado em 27/08 porque a Meta recusava
 * todo áudio gravado (#131053) e o atendente só via "falhou" — prometer um botão
 * que nunca entrega é pior que não ter o botão.
 *
 * O motivo deixou de existir: a causa era o MP4 FRAGMENTADO que o
 * `MediaRecorder` produz, e a gravação agora sai em MP3 (ver `to-mp3.ts`), o
 * único formato que temos PROVA de ser entregue nesta conta — MP3 anexado do
 * computador foi entregue e lido em 02/09 14:55, no mesmo minuto em que um MP4
 * gravado foi recusado.
 *
 * Se voltar a falhar, o balão traz o motivo e o botão "Enviar como arquivo"
 * continua como saída.
 */
const ENVIO_DE_AUDIO_LIBERADO = true;

const EMOJIS = "😀 😁 😂 🤣 😊 😍 😘 😎 🤩 🥳 👍 👏 🙏 💪 🔥 🎉 ✅ ❤️ 💜 💙 ⭐ ✨ 📌 📎 📅 ⏰ 💰 📞 💬 👋".split(" ");

/*
 * ⚠️ A lista FIXA de respostas rápidas saiu daqui (migração 202609011821, que
 * moveu as 5 frases para `snippets`). O composer tinha DOIS menus, os dois
 * chamados "Respostas rápidas": este, fixo no código, e o botão "Trechos", que
 * lê o banco e é editável. Duas listas com o mesmo nome, uma editável e a outra
 * não, é o que fez pedirem "quero editar as respostas rápidas" olhando para a
 * que não dava. Agora existe UMA, e ela é editável no próprio menu.
 */

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
  // Áudio: liberado globalmente OU para admin (que pode testar o envio enquanto
  // o recurso está desligado para os atendentes).
  const { isAdmin } = useMyMembership();
  const audioLiberado = ENVIO_DE_AUDIO_LIBERADO || isAdmin;
  const [channel, setChannel] = useState<Channel>("whatsapp");
  const [internal, setInternal] = useState(false);
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState("");
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  /*
   * Anexos aguardando confirmação — mostra a prévia e só envia no Enviar.
   *
   * 🔴 Era UM arquivo (`pendingImage`), alimentado só pelo Ctrl+V. Virou FILA
   * porque o clipe passou a aceitar vários e o composer passou a aceitar
   * arrastar, e três caminhos com comportamentos diferentes seriam três coisas
   * para o atendente decorar.
   *
   * ⚠️ **Arrastar NÃO envia na hora**, e é o cuidado central desta mudança:
   * mídia enviada vai para o celular do cliente e não tem desfazer. Um arrasto é
   * fácil de fazer sem querer — bem mais que abrir o seletor e escolher —, e com
   * vários arquivos ninguém consegue conferir o que saiu depois de sair. A fila
   * é a confirmação, e é também o que o WhatsApp Web faz.
   */
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  /*
   * ⚠️ O `URL.createObjectURL` só vale para IMAGEM. Criar para PDF/vídeo geraria
   * um blob que nada consome e que ficaria vazando até a aba fechar — o
   * `revoke` abaixo é por isso que existe.
   */
  const previas = useMemo(
    () =>
      pendingFiles.map((f) => ({
        file: f,
        url: f.type.startsWith("image/") ? URL.createObjectURL(f) : null,
      })),
    [pendingFiles]
  );
  useEffect(() => {
    return () => {
      for (const p of previas) if (p.url) URL.revokeObjectURL(p.url);
    };
  }, [previas]);
  // Realce da área ao arrastar por cima.
  const [arrastando, setArrastando] = useState(false);
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
  /** Resposta rápida em edição. `id` vazio = criando. `null` = diálogo fechado. */
  const [editando, setEditando] = useState<{ id: string; name: string; content: string } | null>(
    null
  );
  const conversation = useConversation(conversationId);
  const contactId = conversation?.contactId ?? null;
  const { contact, refresh: recarregarContato } = useDbContact(contactId);
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

  /**
   * Manda UM arquivo: grava no inbox e, no WhatsApp, entrega ao cliente.
   *
   * ⚠️ Devolve resultado em vez de só avisar na tela. Em lote, cinco arquivos
   * dariam até dez toasts empilhados e o atendente não leria nenhum — quem
   * chama junta tudo num aviso só. `emLote` silencia os avisos individuais; o
   * MOTIVO da falha continua voltando, senão o resumo diria "2 falharam" sem
   * dizer por quê, que é o defeito que este projeto já pagou caro no áudio.
   */
  const uploadFile = async (
    file: File,
    caption?: string,
    opts?: { emLote?: boolean }
  ): Promise<{ ok: boolean; motivo?: string }> => {
    const soLote = opts?.emLote === true;
    const falhar = (motivo: string) => {
      if (!soLote) toast.error(motivo);
      return { ok: false, motivo };
    };
    // Conversa finalizada/arquivada: mídia também não sai (clipe e colar).
    if (conversation?.closedAt || conversation?.archivedAt) {
      return falhar("Reabra a conversa (ou envie um template) para enviar mídia.");
    }
    const isImg = file.type.startsWith("image/");
    const EXT_VIDEO = [".mp4", ".3gp", ".3gpp", ".mov", ".webm", ".mkv"];
    const isVideo = file.type.startsWith("video/");
    const name = file.name.toLowerCase();
    const isDoc =
      file.type === "application/pdf" ||
      name.endsWith(".pdf") ||
      file.type.includes("wordprocessingml") ||
      name.endsWith(".docx");
    /*
     * ⚠️ **Anexar áudio é ADIÇÃO, não mudança**: até aqui o clipe recusava
     * qualquer arquivo de som ("Aceito imagem, vídeo, PDF ou DOCX"), então não
     * existe comportamento anterior para regredir.
     *
     * E é o TESTE DECISIVO que faltava depois de treze rodadas. O áudio gravado
     * pelo microfone sai do `MediaRecorder` como **MP4 fragmentado**
     * (`frag=true` no diagnóstico) — o `moov` vem quase vazio e as amostras
     * moram nos fragmentos `moof`, que é o desenho de streaming. Um arquivo
     * escolhido do computador é PROGRESSIVO. Se ele for aceito pela Meta e o
     * gravado não, a fragmentação está provada como causa; se os dois forem
     * recusados, a conta é que não envia áudio, e aí é o painel da Meta.
     *
     * Serve de saída prática também: dá para gravar no celular e anexar.
     */
    /*
     * ⚠️ **A EXTENSÃO decide antes do mime, e o áudio é testado ANTES do vídeo.**
     * Um `.m4a` costuma ser tipado pelo navegador como `video/mp4` (é o mesmo
     * contêiner), e com `isVideo` na frente ele saía como `type: "video"` — a
     * Meta respondia "No video stream found in given video file" (visto em
     * 02/09 14:54, arquivo `audio-2s.m4a.mp4`). Áudio-só num contêiner MP4 é
     * áudio, não vídeo.
     */
    const EXT_AUDIO = [".mp3", ".m4a", ".aac", ".ogg", ".opus", ".amr", ".wav"];
    const isAudio =
      EXT_AUDIO.some((e) => name.endsWith(e)) ||
      (file.type.startsWith("audio/") && !EXT_VIDEO.some((e) => name.endsWith(e)));
    if (!isImg && !isVideo && !isDoc && !isAudio) {
      // Em lote o nome do arquivo entra no resumo — sem ele, "1 falhou" num
      // arrasto de oito arquivos não diz QUAL recusar.
      return falhar(`${file.name}: aceito imagem, vídeo, áudio, PDF ou DOCX`);
    }
    // Áudio ANTES de vídeo — ver o aviso em `isAudio`.
    const kind = isImg ? "image" : isAudio ? "audio" : isVideo ? "video" : "file";
    // ⚠️ Quem liga/desliga `uploading` é `enviarArquivos`: aqui dentro, num lote
    // de cinco, o clipe piscaria entre habilitado e desabilitado cinco vezes.
    const res = await conversationActions.sendMedia(conversationId, {
      file,
      kind,
      channel,
    });
    if (res.ok) {
      // ⚠️ "Enviada" aqui é no INBOX. A entrega ao cliente é a chamada abaixo, e
      // o toast de sucesso dela vem depois — foi um defeito real dizer "enviado"
      // antes de tentar entregar.
      if (!soLote)
        toast.success(
          isImg
            ? "Imagem no inbox"
            : isVideo
              ? "Vídeo no inbox"
              : isAudio
                ? "Áudio no inbox"
                : "Arquivo no inbox"
        );
      if (
        isWhatsapp &&
        res.messageId &&
        res.mediaPath &&
        (kind === "image" || kind === "video" || kind === "file" || kind === "audio")
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
          /*
           * ⚠️ Isto é FALHA, e no lote precisa contar como tal. A mensagem ficou
           * no inbox mas NÃO chegou ao cliente — tratá-la como sucesso faria o
           * resumo dizer "5 arquivos enviados" com dois nunca entregues, que é
           * exatamente a mentira que este projeto já corrigiu no áudio ("gravar
           * no inbox não é entregar").
           */
          return falhar(
            wa.needsTemplate
              ? "Janela de 24h fechada — envie um template antes."
              : wa.error ?? `${file.name}: ficou no inbox, mas falhou ao enviar no WhatsApp.`
          );
        }
      }
      return { ok: true };
    }
    return falhar(res.error ?? `${file.name}: não foi possível enviar`);
  };

  /**
   * Teto de anexos por vez.
   *
   * ⚠️ Não é desempenho: cada arquivo é um upload MAIS um envio pela Cloud API,
   * e os dois contam no limite diário do número. Arrastar uma pasta de fotos sem
   * querer queimaria a cota do número e derrubaria as mensagens de verdade do
   * resto do dia. Dez cobre o uso real com folga.
   */
  const MAX_ANEXOS = 10;

  /** Põe arquivos na fila (clipe, arrastar, colar) sem enviar nada ainda. */
  const enfileirar = (novos: File[]) => {
    if (!novos.length) return;
    if (internal) {
      toast.info("Nota interna não leva anexo — desmarque a nota para enviar mídia.");
      return;
    }
    if (blockedClosed) {
      toast.error("Reabra a conversa (ou envie um template) para enviar mídia.");
      return;
    }
    /*
     * ⚠️ Fora da janela de 24h o clipe nem é DESENHADO (a barra inteira some),
     * mas a área de soltar é a raiz do composer e continua alcançável. Sem esta
     * guarda o arquivo entraria numa fila que a Cloud API vai recusar, e o
     * atendente só descobriria no erro do Enviar.
     */
    if (blocked) {
      toast.error("Fora da janela de 24h — envie um template para retomar.");
      return;
    }
    setPendingFiles((atuais) => {
      const cabem = MAX_ANEXOS - atuais.length;
      if (cabem <= 0) {
        toast.info(`Máximo de ${MAX_ANEXOS} arquivos por vez.`);
        return atuais;
      }
      if (novos.length > cabem) {
        toast.info(`Máximo de ${MAX_ANEXOS} por vez — os demais ficaram de fora.`);
      }
      return [...atuais, ...novos.slice(0, cabem)];
    });
  };

  /**
   * Envia a fila, UM DE CADA VEZ.
   *
   * ⚠️ **Em série, não em paralelo** — mesma decisão do disparo de template em
   * lote: a rota valida canal, janela de 24h e limite diário por chamada, e em
   * rajada o limite devolveria 429 para metade da lista sem controle nenhum. Em
   * série as mensagens também chegam ao cliente na ordem em que foram escolhidas.
   *
   * ⚠️ **A legenda vai só no PRIMEIRO.** A Cloud API tem uma legenda por mídia;
   * repetir o texto em cada uma mandaria a mesma frase cinco vezes ao cliente.
   */
  const enviarArquivos = async (arquivos: File[], caption?: string) => {
    if (!arquivos.length) return;
    setUploading(true);
    const falhas: string[] = [];
    let enviados = 0;
    for (let i = 0; i < arquivos.length; i++) {
      const r = await uploadFile(arquivos[i], i === 0 ? caption : undefined, {
        emLote: arquivos.length > 1,
      });
      if (r.ok) enviados++;
      else falhas.push(r.motivo ?? `${arquivos[i].name}: falhou`);
    }
    setUploading(false);
    // Um arquivo já avisou por conta própria, com o texto específico do tipo.
    if (arquivos.length === 1) return;
    if (!falhas.length) {
      toast.success(`${enviados} arquivos no inbox`);
      return;
    }
    toast.error(
      `${enviados} de ${arquivos.length} enviados. ${falhas.slice(0, 3).join(" · ")}` +
        (falhas.length > 3 ? ` · e mais ${falhas.length - 3}` : "")
    );
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
         * ⚠️ **A gravação sai em MP3, e isso está PROVADO, não deduzido.** O
         * `MediaRecorder` emite MP4 FRAGMENTADO; o farejador de mídia da Meta não
         * identifica o arquivo e devolve #131053. O teste que fechou, em 02/09:
         * no mesmo número e no mesmo minuto, o MP4 gravado foi recusado e um MP3
         * anexado do computador foi ENTREGUE E LIDO.
         *
         * ⚠️ Transcodifica SEMPRE, qualquer que seja o formato gravado. A primeira
         * versão disto (42b4580, revertida) convertia só o ramo Ogg, por causa da
         * hipótese "esta conta recusa todo Ogg" — errada, o Ogg entregou 191 vezes
         * até 26/08. Deixar o MP4 passar direto manteria o caminho que falha.
         *
         * ⚠️ **Import DINÂMICO**: o lamejs só é baixado por quem grava áudio, e
         * não entra no pacote de quem apenas abre a conversa.
         *
         * Falhando a conversão, manda o original — melhor tentar do que travar a
         * gravação que a pessoa acabou de fazer.
         */
        let file: File;
        try {
          const { audioParaMp3 } = await import("@/lib/whatsapp/to-mp3");
          file = await audioParaMp3(bruto, secs);
        } catch (e) {
          console.warn("[audio] falha ao converter para MP3, enviando o original:", e);
          file = new File([bruto], `audio-${secs}s.${fmt.ext}`, { type: mimeArquivo });
        }
        /*
         * Mesma inspeção que a rota faz nos bytes (`lib/whatsapp/audio.ts`), aqui
         * só para avisar antes da viagem — a decisão de recusar é do servidor,
         * que é quem grava o motivo no balão.
         *
         * ⚠️ A versão anterior desta checagem tinha um furo: era
         * `if (canais !== null && canais > 1)`, então "não achei o cabeçalho
         * OpusHead" (null) passava CALADO, indistinguível de mono — um arquivo
         * WebM ou WAV não disparava aviso nenhum. `inspecionarAudio` nomeia esse
         * caso em vez de devolver ausência de resultado.
         */
        // Roda no arquivo FINAL (já em MP3 quando a conversão deu certo).
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

  /**
   * Aplica ao contato o CONJUNTO de etiquetas escolhido no seletor.
   *
   * ⚠️ Era um campo de texto livre ("Ex.: quente"), e digitar de memória é o que
   * produzia "QUENTE", "Quente" e "quente" como três etiquetas diferentes —
   * nenhuma delas confiável para filtrar depois. Agora a lista é o catálogo
   * (202609091600) e o vendedor só escolhe.
   */
  const aplicarEtiquetas = async (proximas: string[]) => {
    if (!contactId) return;
    const atuais = contact?.tags ?? [];
    const juntar = proximas.filter((t) => !atuais.includes(t));
    const tirar = atuais.filter((t) => !proximas.includes(t));
    // Em série: são um ou dois cliques por vez, e cada chamada relê o contato no
    // banco — em paralelo, duas escritas partiriam do mesmo estado e uma
    // sobrescreveria a outra.
    for (const t of juntar) {
      if (!(await dbContactActions.addTag([contactId], t))) {
        toast.error(`Não foi possível marcar "${t}"`);
        recarregarContato();
        return;
      }
    }
    for (const t of tirar) {
      if (!(await dbContactActions.removeTag([contactId], t))) {
        toast.error(`Não foi possível desmarcar "${t}"`);
        recarregarContato();
        return;
      }
    }
    /*
     * ⚠️ Sem isto o checkbox NÃO marca. `addTag` atualiza a store, e o contato
     * daqui não vem da store — o inbox não a carrega. A escrita ia para o banco
     * e a tela ficava igual, que foi o relato de "não consigo selecionar".
     */
    recarregarContato();
  };

  const send = async (scheduledFor?: string) => {
    // Conversa finalizada/arquivada: não envia mensagem (só nota interna ou template).
    if (blockedClosed) {
      toast.error("Reabra a conversa (ou envie um template) para responder.");
      return;
    }
    // Anexos na fila: o Enviar manda todos (o texto vira legenda do primeiro).
    if (pendingFiles.length && !internal && !scheduledFor) {
      const arquivos = pendingFiles;
      const caption = body;
      // Limpa ANTES de enviar: o envio em série leva segundos, e a fila na tela
      // convidaria a clicar em Enviar de novo e mandar tudo duas vezes.
      setPendingFiles([]);
      setBody("");
      await enviarArquivos(arquivos, caption);
      return;
    }
    /*
     * ⚠️ Conversa de WhatsApp sem número: a versão anterior BLOQUEAVA aqui com
     * "Cadastre um canal de WhatsApp em Canais de atendimento" — numa empresa
     * que tinha três canais cadastrados. A mensagem culpava a configuração por
     * um defeito nosso: em 01/09/2026 o código que ordena por `principal` foi ao
     * ar antes da migração da coluna, a escolha de canal falhou e `open()` criou
     * a conversa com o campo nulo.
     *
     * Agora tenta ESCOLHER o número antes de desistir, e só reclama quando
     * realmente não há nenhum disponível — aí a mensagem é verdadeira.
     */
    if (conversation?.channel === "whatsapp" && !conversation?.channelId && !internal && !scheduledFor) {
      const canal = await conversationActions.ensureChannel(conversationId);
      if (!canal) {
        toast.error(
          "Esta conversa não tem número de WhatsApp associado, e não encontrei um disponível para o seu setor. Fale com um administrador."
        );
        return;
      }
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

  /*
   * ⚠️ `dataTransfer.types` inclui "Files" SÓ quando o que vem é arquivo.
   * Arrastar texto selecionado da própria conversa também dispara `dragover`, e
   * sem essa checagem o composer piscaria a moldura de anexo para uma seleção de
   * texto — e o `preventDefault` roubaria o arrasto de texto do navegador.
   */
  const temArquivo = (e: React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");

  return (
    <div
      className={cn(
        "relative border-t bg-white p-3",
        internal && "bg-amber-50/60",
        arrastando && "bg-indigo-50/70 outline-2 outline-dashed outline-indigo-400 -outline-offset-4"
      )}
      onDragOver={(e) => {
        if (!temArquivo(e)) return;
        // Sem o preventDefault o navegador ABRE o arquivo numa aba, e o drop
        // nunca chega até aqui — é o padrão que faz "arrastar não funcionar".
        e.preventDefault();
        if (!arrastando) setArrastando(true);
      }}
      onDragLeave={(e) => {
        // ⚠️ `dragleave` dispara ao passar sobre cada FILHO. Sem conferir para
        // onde o ponteiro foi, a moldura piscaria o arrasto inteiro.
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setArrastando(false);
      }}
      onDrop={(e) => {
        if (!temArquivo(e)) return;
        e.preventDefault();
        setArrastando(false);
        enfileirar(Array.from(e.dataTransfer.files));
      }}
    >
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
      {pendingFiles.length > 0 && (
        <div className="mb-2 rounded-lg border border-indigo-200 bg-indigo-50/60 p-2">
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold text-slate-700">
              {pendingFiles.length === 1
                ? "1 arquivo para enviar"
                : `${pendingFiles.length} arquivos para enviar`}
            </p>
            <button
              onClick={() => setPendingFiles([])}
              className="ml-auto rounded px-1.5 py-0.5 text-[11px] font-medium text-slate-500 hover:bg-white hover:text-slate-700"
            >
              Descartar todos
            </button>
          </div>
          {/* ⚠️ Rola na horizontal no próprio container: dez anexos empurrariam
              o campo de texto para fora da tela numa barra lateral estreita. */}
          <div className="mt-1.5 flex gap-2 overflow-x-auto pb-1">
            {previas.map((p, i) => (
              <div
                key={`${p.file.name}-${i}`}
                className="relative flex w-24 shrink-0 flex-col items-center gap-1 rounded-md border bg-white p-1.5"
                title={p.file.name}
              >
                {p.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.url} alt="" className="h-12 w-full rounded object-cover" />
                ) : (
                  <div className="flex h-12 w-full items-center justify-center rounded bg-slate-100">
                    <Paperclip className="size-4 text-slate-400" />
                  </div>
                )}
                {/* `truncate` + `w-full`: nome longo não pode esticar o cartão. */}
                <span className="w-full truncate text-center text-[10px] text-slate-600">
                  {p.file.name}
                </span>
                <button
                  onClick={() => setPendingFiles((atuais) => atuais.filter((_, j) => j !== i))}
                  title="Remover"
                  className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full border bg-white text-slate-500 shadow-sm hover:bg-slate-100 hover:text-slate-700"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {pendingFiles.length > 1 ? (
              <>
                Escreva uma legenda abaixo (opcional — ela vai no{" "}
                <strong>primeiro</strong> arquivo) e clique em <strong>Enviar</strong>.
              </>
            ) : (
              <>
                Adicione uma legenda no campo abaixo (opcional) e clique em{" "}
                <strong>Enviar</strong>.
              </>
            )}
          </p>
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
          // Não envia direto: entra na fila e espera o Enviar. Colar duas vezes
          // agora ACUMULA, em vez de a segunda imagem substituir a primeira em
          // silêncio — que era o comportamento com um arquivo só.
          enfileirar([file]);
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

          {/* Anexo (imagem, vídeo, áudio, PDF ou DOCX) — vários de uma vez */}
          <input
            ref={fileRef}
            multiple
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/3gpp,audio/mpeg,audio/mp4,audio/aac,audio/ogg,audio/amr,.mp3,.m4a,.aac,.ogg,.opus,.amr,application/pdf,.pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="hidden"
            onChange={(e) => {
              // ⚠️ `FileList` não é array — sem o `Array.from` o `.length` existe
              // mas `map`/`slice` não, e a fila quebraria em runtime.
              enfileirar(Array.from(e.target.files ?? []));
              // Zera para o mesmo arquivo poder ser escolhido de novo depois.
              e.target.value = "";
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            title="Anexar arquivos (imagem, vídeo, áudio, PDF ou DOCX) — dá para escolher vários"
            className="flex size-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
          >
            {uploading ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />}
          </button>

          {/* Áudio (gravação pelo microfone) */}
          <button
            onClick={() =>
              audioLiberado
                ? startRec()
                : toast.info(
                    "Gravação de áudio indisponível (a Meta recusa áudio nesta conta). Você pode anexar um arquivo de áudio pelo clipe."
                  )
            }
            disabled={uploading}
            title={
              audioLiberado
                ? isAdmin && !ENVIO_DE_AUDIO_LIBERADO
                  ? "Gravar áudio (liberado só para admin — em teste)"
                  : "Gravar áudio"
                : "Áudio temporariamente indisponível (limitação da Meta)"
            }
            className={cn(
              "flex size-7 items-center justify-center rounded-md disabled:opacity-50",
              audioLiberado
                ? "text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                : "cursor-not-allowed text-slate-300"
            )}
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
            <PopoverContent align="start" className="w-64 p-3">
              <Label className="text-xs">Etiquetas do contato</Label>
              <div className="mt-1.5">
                <TagPicker
                  value={contact?.tags ?? []}
                  onChange={(t) => void aplicarEtiquetas(t)}
                  placeholder="Escolher etiquetas"
                />
              </div>
            </PopoverContent>
          </Popover>

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
          {/*
            Menu ÚNICO de respostas rápidas — antes eram dois com o mesmo nome.
            Cada item insere o texto; o lápis abre a edição sem fechar o
            atendimento, e "Nova resposta rápida" cria dali mesmo. Antes, criar
            exigia sair da conversa e ir na aba Trechos, e editar não existia.
          */}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  title="Respostas rápidas"
                  className="ml-1 flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-indigo-600 hover:bg-indigo-50"
                />
              }
            >
              <Zap className="size-3.5" /> Respostas rápidas
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72">
              <DropdownMenuLabel className="text-[10px] text-slate-400">
                Clique para inserir no texto
              </DropdownMenuLabel>
              {snippets.length === 0 && (
                <DropdownMenuItem disabled className="text-xs text-slate-400">
                  Nenhuma resposta rápida ainda
                </DropdownMenuItem>
              )}
              {snippets.map((s) => (
                <div key={s.id} className="flex items-start gap-1 px-1">
                  <DropdownMenuItem
                    className="min-w-0 flex-1 flex-col items-start text-xs"
                    onClick={() => setBody((b) => (b ? `${b} ${s.content}` : s.content))}
                  >
                    <span className="font-semibold">{s.name}</span>
                    <span className="line-clamp-2 text-[10px] text-slate-400">{s.content}</span>
                  </DropdownMenuItem>
                  {/*
                    ⚠️ Fora do DropdownMenuItem, e é por isso que o botão vive num
                    <div> irmão: clicar dentro do item fecharia o menu E inseriria
                    o texto no campo, que é o oposto de "editar".
                  */}
                  <button
                    type="button"
                    title={`Editar "${s.name}"`}
                    onClick={() => setEditando(s)}
                    className="mt-1 flex size-6 shrink-0 items-center justify-center rounded text-slate-300 hover:bg-slate-100 hover:text-slate-600"
                  >
                    <Pencil className="size-3" />
                  </button>
                </div>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-xs font-medium text-indigo-600"
                onClick={() => setEditando({ id: "", name: "", content: body.trim() })}
              >
                <Plus className="size-3.5" /> Nova resposta rápida
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {/* Montado só quando há item, e com `key`: é o que garante campos
              limpos a cada abertura sem precisar de efeito. */}
          {editando && (
            <RespostaRapidaDialog
              key={editando.id || "novo"}
              item={editando}
              onOpenChange={(o) => !o && setEditando(null)}
            />
          )}
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
