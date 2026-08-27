"use client";

import { useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  AlertTriangle,
  Archive,
  CalendarDays,
  Check,
  CheckCheck,
  CheckCircle2,
  CornerUpLeft,
  Download,
  FileText,
  Loader2,
  Mail,
  Pause,
  Play,
  Star,
  Trash2,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { HandoffSummaryDialog } from "./handoff-summary-dialog";
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
import { contactName } from "@/lib/data/repos/contacts";
import { useDbContact } from "@/lib/data/repos/db/contacts";
import {
  conversationActions,
  useConversation,
  useConvStore,
  useMessages,
  useMessagesLoading,
  useReplyStore,
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

  // Transferência para OUTRA pessoa passa pelo resumo primeiro. Assumir para si
  // ou devolver para a caixa do grupo não pede: não há "próximo atendente" a
  // quem contar o que aconteceu.
  const [pendente, setPendente] = useState<{ userId: string; nome: string } | null>(null);

  const set = async (userId: string | null, resumo?: string) => {
    if (resumo !== undefined && resumo.trim()) {
      // Grava ANTES do assign: depois de transferir eu posso perder a
      // visibilidade da conversa. A função é SECURITY DEFINER, mas a ordem
      // também mantém o resumo acima do evento "transferida para X" no thread.
      await conversationActions.saveHandoffSummary(conversation.id, "transferencia", resumo);
    }
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
            <DropdownMenuItem
              key={m.userId}
              className="text-xs"
              onClick={() => setPendente({ userId: m.userId, nome: m.name })}
            >
              {m.name}
            </DropdownMenuItem>
          ))}
        {conversation.assignedTo && (
          <DropdownMenuItem className="text-xs text-slate-500" onClick={() => void set(null)}>
            Remover responsável
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
      <HandoffSummaryDialog
        open={pendente !== null}
        conversationId={pendente ? conversation.id : null}
        kind="transferencia"
        destino={pendente?.nome}
        onCancel={() => setPendente(null)}
        onConfirm={async (resumo) => {
          const alvo = pendente;
          setPendente(null);
          if (alvo) await set(alvo.userId, resumo);
        }}
      />
    </DropdownMenu>
  );
}

/** Resumo curto de uma mensagem para a prévia da citação (texto ou mídia). */
function quoteSnippet(m: Message): string {
  if (m.type === "image") return "🖼️ Imagem";
  if (m.type === "video") return "🎬 Vídeo";
  if (m.type === "audio") return "🎧 Áudio";
  if (m.type === "file") return `📎 ${m.mediaName ?? "Arquivo"}`;
  const t = (m.body ?? "").replace(/\s+/g, " ").trim();
  return t.length > 90 ? `${t.slice(0, 90)}…` : t || "Mensagem";
}

/**
 * Texto amigável para uma mensagem que falhou no envio.
 *
 * O `error_detail` do servidor pode trazer um dump longo de diagnóstico
 * (`... · Media upload error · #131053 · [diag] ...`) — útil pra investigar,
 * ruim pro atendente. Aqui vira uma frase clara; o dump completo continua no
 * `title` do balão (aparece ao passar o mouse). O caso de áudio (#131053, que a
 * Meta recusa nesta conta) ganha uma mensagem específica com o que fazer.
 */
function textoDeFalha(m: Message): string {
  const d = m.errorDetail ?? "";
  if (m.type === "audio" && (/131053/.test(d) || /media upload error/i.test(d))) {
    return "Não foi possível enviar o áudio por este número (limitação da conta na Meta). Envie por texto ou use outro canal.";
  }
  // Demais erros: só a 1ª frase, sem a cauda de diagnóstico.
  const limpo = d.split("·")[0].split("[diag]")[0].trim();
  return limpo ? `Não foi entregue: ${limpo}` : "Não foi entregue.";
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
/**
 * Velocidades do player. Sem 0,5x de propósito: em áudio de atendimento a
 * necessidade é sempre ouvir MAIS RÁPIDO — o cliente que mandou três minutos de
 * áudio, não o que falou rápido demais.
 */
/**
 * Velocidades do player. Sem 0,5x de propósito: em áudio de atendimento a
 * necessidade é sempre ouvir MAIS RÁPIDO — o cliente que mandou três minutos de
 * áudio, não o que falou rápido demais.
 *
 * ⚠️ A escolha é DE CADA ÁUDIO, e não uma preferência guardada. A primeira
 * versão salvava em `localStorage` (o padrão da sidebar minimizável) e o efeito
 * era o oposto do esperado: acelerar um áudio acelerava todos os outros da
 * conversa de uma vez. Aqui cada balão nasce em 1× e só muda o que a pessoa
 * mexeu — ela está decidindo sobre AQUELE áudio, não configurando o CRM.
 */
const VELOCIDADES = [1, 1.25, 1.5, 2] as const;

function AudioPlayer({ url, duration, out }: { url: string | null; duration?: string; out: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [pct, setPct] = useState(0);
  const [velocidade, setVelocidade] = useState<number>(1);

  const trocarVelocidade = () => {
    const proxima = VELOCIDADES[(VELOCIDADES.indexOf(velocidade as 1) + 1) % VELOCIDADES.length];
    setVelocidade(proxima);
    // ⚠️ `playbackRate` tem que ser aplicado ao ELEMENTO: não é atributo
    // controlado pelo React e volta a 1 se só o estado mudar. Aplicado já aqui
    // para a troca valer no meio da reprodução, sem precisar pausar.
    if (audioRef.current) audioRef.current.playbackRate = proxima;
  };

  return (
    <div className="flex items-center gap-2">
      <audio
        ref={audioRef}
        src={url ?? undefined}
        preload="none"
        // A taxa é aplicada no play porque o elemento só existe de verdade a
        // partir dele: definir antes de haver mídia carregada não persiste.
        onPlay={(e) => {
          e.currentTarget.playbackRate = velocidade;
          setPlaying(true);
        }}
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
      <button
        onClick={trocarVelocidade}
        disabled={!url}
        title="Velocidade de reprodução"
        className={cn(
          "shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold tabular-nums disabled:opacity-50",
          velocidade === 1
            ? out
              ? "text-indigo-100 hover:bg-white/15"
              : "text-slate-400 hover:bg-slate-100"
            : out
              ? "bg-white/25 text-white"
              : "bg-indigo-100 text-indigo-700"
        )}
      >
        {/* "1,25×" e não "1.25x": o CRM é todo pt-BR. */}
        {velocidade.toLocaleString("pt-BR")}×
      </button>
    </div>
  );
}

/**
 * Legenda de imagem, vídeo ou arquivo — o texto que veio JUNTO com a mídia.
 *
 * ⚠️ O balão renderizava a mídia e DESCARTAVA o `message.body`: quem mandava uma
 * foto escrevendo "tento clicar e aparece essa informação" via só a foto, e a
 * pergunta desaparecia da conversa (17 imagens e 1 vídeo neste banco). O texto
 * sempre esteve gravado — o webhook guarda `caption` em `body` —, só não era
 * exibido.
 *
 * ⚠️ Por tipo, porque `body` NÃO significa a mesma coisa em todos:
 * - `audio`: é a DURAÇÃO ("1:59"), consumida pelo player. Mostrar aqui repetiria
 *   o tempo embaixo da onda.
 * - `file`: no que o atendente ENVIA, o composer grava o nome do arquivo; no que
 *   o cliente MANDA, é a legenda. Como o nome já aparece no próprio bloco do
 *   arquivo, só mostro quando o texto difere de `mediaName` — senão o nome
 *   apareceria duas vezes.
 * - `image` / `video`: é sempre legenda.
 */
function LegendaMidia({ message, out }: { message: Message; out: boolean }) {
  const texto = (message.body ?? "").trim();
  if (!texto || message.type === "audio") return null;
  if (message.type === "file" && texto === (message.mediaName ?? "").trim()) return null;

  return (
    <p
      className={cn(
        "mt-1.5 whitespace-pre-wrap text-sm [overflow-wrap:anywhere]",
        out ? "text-white" : "text-slate-800"
      )}
    >
      {texto}
    </p>
  );
}

/** Conteúdo de mensagens de mídia: imagem, áudio ou arquivo. */
/**
 * Pedidos de transcrição em SÉRIE, com teto por carregamento de página.
 *
 * Abrir uma conversa cheia de áudio pendente dispararia uma requisição por
 * balão, todas de uma vez. Em série o servidor atende uma por vez, e o teto
 * evita a rajada numa conversa com dezenas de áudios — o que sobrar fica para a
 * fila do tick, que é justamente o mecanismo para o histórico.
 */
let filaTranscricao: Promise<void> = Promise.resolve();
const jaPedido = new Set<string>();
let pedidosFeitos = 0;
const TETO_POR_PAGINA = 12;

function pedirTranscricao(
  messageId: string,
  aoTerminar: (r: { texto?: string; status?: string; erro?: string }) => void
): boolean {
  if (jaPedido.has(messageId) || pedidosFeitos >= TETO_POR_PAGINA) return false;
  jaPedido.add(messageId);
  pedidosFeitos += 1;
  filaTranscricao = filaTranscricao.then(async () => {
    try {
      const res = await fetch("/api/messages/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        aoTerminar({ status: "falhou", erro: json?.error });
        return;
      }
      aoTerminar({ texto: json.texto ?? undefined, status: json.status, erro: json.erro });
    } catch {
      aoTerminar({ status: "falhou", erro: "Falha de conexão" });
    }
  });
  return true;
}

/**
 * O texto da transcrição, cortado em 2 linhas com "ver mais".
 *
 * Um áudio de dois minutos vira um parágrafo que ocupa mais espaço que a
 * conversa inteira: o balão empurra tudo para fora da tela e quem só quer
 * acompanhar o fio perde o fio. Duas linhas dão o assunto; o resto é sob
 * demanda.
 *
 * ⚠️ O botão só aparece quando o texto REALMENTE passa de duas linhas, e isso é
 * medido no elemento (`scrollHeight > clientHeight`), não estimado por contagem
 * de caracteres: a largura do balão muda com a janela, e um "ver mais" que não
 * revela nada é pior que não ter botão.
 */
function TranscricaoTexto({ texto, out }: { texto: string; out: boolean }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [expandido, setExpandido] = useState(false);
  const [temMais, setTemMais] = useState(false);

  useEffect(() => {
    const medir = () => {
      const el = ref.current;
      if (!el) return;
      // Enquanto expandido não há corte para medir — a resposta anterior vale.
      if (expandido) return;
      // +1 absorve o arredondamento de altura de linha fracionária, que faria
      // todo texto de exatamente duas linhas parecer cortado.
      setTemMais(el.scrollHeight > el.clientHeight + 1);
    };
    // `requestAnimationFrame`: medir precisa do layout já calculado, e assim o
    // `setState` sai do corpo síncrono do efeito (que dispara cascata).
    const id = requestAnimationFrame(medir);
    // A largura do balão muda com a janela: o que cabia em duas linhas pode
    // passar a não caber.
    window.addEventListener("resize", medir);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener("resize", medir);
    };
  }, [texto, expandido]);

  return (
    <div
      className={cn(
        "border-l-2 pl-2",
        out ? "border-white/30" : "border-slate-300"
      )}
    >
      <p
        ref={ref}
        className={cn(
          // `whitespace-pre-line` é o que faz as quebras aparecerem: o texto
          // vem do banco com uma linha em branco entre os parágrafos e, no
          // HTML, quebra de linha conta como espaço — sem isto tudo volta a
          // ser o bloco corrido que era o problema.
          "whitespace-pre-line text-[11px] leading-relaxed",
          !expandido && "line-clamp-2",
          out ? "text-white/80" : "text-slate-500"
        )}
      >
        {texto}
      </p>
      {(temMais || expandido) && (
        <button
          onClick={() => setExpandido((v) => !v)}
          className={cn(
            "mt-0.5 text-[10px] font-semibold hover:underline",
            out ? "text-white/70" : "text-indigo-600"
          )}
        >
          {expandido ? "ver menos" : "ver mais"}
        </button>
      )}
    </div>
  );
}

/**
 * Transcrição do áudio, embaixo do player.
 *
 * A fila do tick transcreve tudo sozinha (migração 0085), então o normal é o
 * texto já estar aqui quando alguém abre a conversa. O botão cobre os dois casos
 * em que esperar o próximo minuto incomoda: o áudio que acabou de chegar e o que
 * falhou.
 *
 * Estado local em vez de recarregar a conversa: só este balão muda, e um reload
 * do thread saltaria o scroll de quem está lendo.
 */
function Transcricao({ message, out }: { message: Message; out: boolean }) {
  // ⚠️ O valor do BANCO tem prioridade sobre o estado local, e não o contrário.
  // A primeira versão fazia `useState(message.transcription)`: o `useState` só
  // usa o argumento na PRIMEIRA montagem, então quando a transcrição chegava
  // pelo Realtime (o inbox já assina UPDATE de `messages`) o componente
  // continuava mostrando o valor congelado — era exatamente por isso que só
  // aparecia depois de recarregar a página. O estado local ficou só como ponte
  // para a resposta do clique, enquanto o Realtime não chega.
  const [local, setLocal] = useState<{ texto?: string; status?: string } | null>(null);
  const [carregando, setCarregando] = useState(false);

  const texto = message.transcription ?? local?.texto ?? null;
  const status = message.transcriptionStatus ?? local?.status;

  const aplicar = (r: { texto?: string; status?: string; erro?: string }) => {
    setCarregando(false);
    if (r.texto) {
      setLocal({ texto: r.texto, status: "ok" });
      return;
    }
    setLocal({ status: r.status ?? "falhou" });
    if (r.status === "ignorado") {
      // Áudio sem fala. Dizer isso é melhor que deixar o botão ali sugerindo
      // que uma nova tentativa resolveria.
      toast.info(r.erro ?? "Nenhuma fala reconhecida neste áudio");
    } else if (r.status === "falhou") {
      toast.error(r.erro ?? "Não foi possível transcrever");
    }
  };

  // Áudio que ainda está na fila: pede a transcrição AGORA, sem esperar o tick.
  // O tick roda a cada minuto e existe para o histórico; quem está com a
  // conversa aberta não deveria esperar um minuto pelo áudio que acabou de
  // chegar.
  useEffect(() => {
    if (texto || status !== "pendente") return;
    // Sem `setCarregando` aqui: `pendente` já desenha "transcrevendo o
    // áudio...", então o estado seria redundante — e `setState` no corpo de um
    // efeito dispara renderização em cascata (a regra do React reclama disso).
    pedirTranscricao(message.id, aplicar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message.id, status, texto]);

  const pedir = async () => {
    setCarregando(true);
    // Botão manual: sai da mesma fila, para não concorrer com o automático.
    jaPedido.delete(message.id);
    if (!pedirTranscricao(message.id, aplicar)) setCarregando(false);
  };

  if (texto) {
    return <TranscricaoTexto texto={texto} out={out} />;
  }

  // Enquanto está na fila, nada de botão: clicar não adiantaria e o texto chega
  // no próximo tique.
  if (status === "pendente" || carregando) {
    return (
      <p className={cn("text-[10px] italic", out ? "text-white/60" : "text-slate-400")}>
        transcrevendo o áudio...
      </p>
    );
  }

  if (status === "ignorado") {
    return (
      <p className={cn("text-[10px] italic", out ? "text-white/60" : "text-slate-400")}>
        sem fala reconhecida
      </p>
    );
  }

  return (
    <button
      onClick={pedir}
      className={cn(
        "flex items-center gap-1 text-[10px] font-medium hover:underline",
        out ? "text-white/70" : "text-indigo-600"
      )}
    >
      <FileText className="size-3" />
      {status === "falhou" ? "Tentar transcrever de novo" : "Transcrever áudio"}
    </button>
  );
}

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
    return (
      <div className="space-y-1.5">
        <AudioPlayer url={url} duration={message.body || undefined} out={out} />
        <Transcricao message={message} out={out} />
      </div>
    );
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

function MessageBubble({
  message,
  conversationId,
  quoted,
  contactFirstName,
}: {
  message: Message;
  conversationId: string;
  quoted?: Message | null;
  contactFirstName?: string;
}) {
  if (message.type === "event") return <PipelineEvent message={message} />;
  const isOut = message.direction === "out";
  const replyBtn = (
    <button
      onClick={() => useReplyStore.getState().setReply(conversationId, message)}
      title="Responder a esta mensagem"
      className="flex size-6 shrink-0 items-center justify-center self-center rounded-full text-slate-400 opacity-0 transition hover:bg-slate-200 hover:text-slate-600 group-hover:opacity-100"
    >
      <CornerUpLeft className="size-3.5" />
    </button>
  );
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
          ? message.errorDetail
            ? `Falhou: ${message.errorDetail}`
            : "Falhou ao enviar"
          : "Enviado";
  return (
    <div className={cn("group flex items-center gap-1", isOut ? "justify-end" : "justify-start")}>
      {isOut && replyBtn}
      <div
        className={cn(
          "max-w-[70%] overflow-hidden break-words rounded-2xl px-3.5 py-2 text-[13px]",
          message.internal
            ? "border border-amber-200 bg-amber-50 text-amber-900"
            : isOut
              ? "rounded-br-sm bg-indigo-500 text-white"
              : "msg-in rounded-bl-sm bg-slate-100 text-slate-800"
        )}
      >
        {message.internal && (
          <p className="mb-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-600">
            Comentário interno
          </p>
        )}
        {quoted && (
          <div
            className={cn(
              "mb-1.5 rounded-md border-l-2 px-2 py-1 text-[11px]",
              isOut
                ? "border-white/60 bg-white/15 text-indigo-50"
                : "border-indigo-400 bg-black/5 text-slate-600"
            )}
          >
            <span className="block font-semibold">
              {quoted.direction === "in" ? contactFirstName ?? "Contato" : "Você"}
            </span>
            <span className="block truncate opacity-90">{quoteSnippet(quoted)}</span>
          </div>
        )}
        {message.scheduleStatus && <ScheduleTag message={message} />}
        {message.type === "audio" ||
        message.type === "image" ||
        message.type === "video" ||
        message.type === "file" ? (
          <>
            <MediaContent message={message} out={isOut && !message.internal} />
            <LegendaMidia message={message} out={isOut && !message.internal} />
          </>
        ) : (
          <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">{message.body}</span>
        )}
        {/*
          ⚠️ O motivo da falha vai DENTRO do balão, não só no title do "falhou".
          A conduta muda por completo com o motivo — "janela de 24h fechada" pede
          um template, "formato recusado" pede outro arquivo — e um tooltip que
          exige descobrir que há algo para passar o mouse em cima não comunica
          isso. Antes o balão dizia apenas "falhou", e nem o motivo era gravado.
        */}
        {isOut && message.status === "failed" && (
          <p
            title={message.errorDetail ?? undefined}
            className="mt-1 flex gap-1 rounded-md bg-rose-500/25 px-2 py-1 text-[10px] leading-snug text-rose-50"
          >
            <AlertTriangle className="mt-px size-3 shrink-0" aria-hidden />
            <span className="[overflow-wrap:anywhere]">{textoDeFalha(message)}</span>
          </p>
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
      {!isOut && replyBtn}
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

  const applyStatus = async (resumo?: string) => {
    if (!conversation || !confirmStatus) return;
    setStatusBusy(true);
    // O resumo vai ANTES de fechar: a nota pertence ao atendimento que está
    // sendo encerrado, e o Realtime já a coloca no thread.
    if (resumo?.trim()) {
      // Sem recarregar nada aqui: o resumo agora vive na aba lateral, que busca
      // ao ser aberta. Recarregar de dentro do thread seria estado morto.
      await conversationActions.saveHandoffSummary(conversation.id, "finalizacao", resumo);
    }
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
          {/* Finalizar passa pelo resumo; arquivar mantém a confirmação simples —
              arquivar é tirar da vista, não encerrar um atendimento, então não
              há o que contar para o próximo. */}
          <HandoffSummaryDialog
            open={confirmStatus === "finalizar"}
            conversationId={confirmStatus === "finalizar" ? conversationId : null}
            kind="finalizacao"
            onCancel={() => setConfirmStatus(null)}
            onConfirm={(resumo) => applyStatus(resumo)}
          />
          <Dialog
            open={confirmStatus === "arquivar"}
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
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-slate-50 p-4 [scrollbar-width:thin]"
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
              <MessageBubble
                message={m}
                conversationId={conversationId}
                quoted={m.replyTo ? messages.find((x) => x.id === m.replyTo) ?? null : null}
                contactFirstName={contact.firstName}
              />
            </div>
          );
        })}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}
