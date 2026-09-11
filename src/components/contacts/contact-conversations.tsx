"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { format, isSameDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Ban, CalendarDays, ExternalLink, MessageSquareText } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ChannelIcon } from "@/components/shared/channel-icon";
import { LegendaMidia, MediaContent, PipelineEvent } from "@/components/inbox/thread";
import {
  useContactConversations,
  type ConversaDoContato,
} from "@/lib/data/repos/db/contact-conversations";
import { useDbTeam } from "@/lib/data/repos/db/contacts";
import { useWhatsappChannels } from "@/lib/data/repos/db/whatsapp";
import type { Message } from "@/lib/data/types";
import { cn } from "@/lib/utils";

/**
 * "Visualizar conversa" na tela do contato — uma entrada por conversa, para o
 * caso de ele ter falado por mais de um número (medido: 158 contatos neste
 * banco, e em TODOS eles a quantidade de conversas é igual à de números
 * distintos, ou seja a separação é exatamente o número).
 *
 * É LEITURA, não atendimento. O fio aparece inteiro e sem nenhuma ação sobre as
 * mensagens — responder, transferir, finalizar, editar e apagar continuam só na
 * caixa de entrada, que é onde o atendente tem o contexto todo. Por isso o balão
 * daqui é próprio e não o `MessageBubble` do inbox: aquele carrega
 * responder/editar/apagar, e o botão de responder escreve na store do composer
 * de uma conversa que nem está aberta.
 *
 * ⚠️ Mas a MÍDIA é a mesma peça do inbox (`MediaContent`/`LegendaMidia`), e o
 * evento também (`PipelineEvent`): duas renderizações de imagem, áudio e
 * arquivo divergiriam na primeira mudança — e a do inbox já resolve URL
 * assinada, player com velocidade e transcrição.
 */

function nomeDe(id: string | null | undefined, team: { id: string; name: string }[]) {
  if (!id) return null;
  return team.find((u) => u.id === id)?.name ?? null;
}

/** "Cibelle", "Cibelle e Alberto", "Cibelle, Alberto e mais 2". */
function juntar(nomes: string[]) {
  if (nomes.length === 0) return "";
  if (nomes.length === 1) return nomes[0];
  if (nomes.length === 2) return `${nomes[0]} e ${nomes[1]}`;
  return `${nomes.slice(0, 2).join(", ")} e mais ${nomes.length - 2}`;
}

/**
 * Como a conversa se chama na lista.
 *
 * ⚠️ A ordem saiu da medida, não do gosto: `assigned_to` é nulo em 66% das
 * conversas deste banco, então rotular pelo RESPONSÁVEL deixaria dois terços
 * como "com ninguém". Quem ESCREVEU está gravado em 100% das saídas humanas
 * desde setembro — e é isso que o pedido chama de "a conversa com a Cibelle".
 * No caso que o originou, o Alberto atendeu e transferiu para a Cibelle: as
 * duas aparecem, o que o responsável de hoje sozinho não diria.
 */
function comQuem(conv: ConversaDoContato, team: { id: string; name: string }[]) {
  const nomes = conv.participantes.map((id) => nomeDe(id, team) ?? "Carregando...");
  if (nomes.length > 0) return `com ${juntar(nomes)}`;
  if (conv.autorDesconhecido) return "atendida (autor não registrado)";
  const resp = nomeDe(conv.assignedTo, team);
  // "Só o bot respondeu" vem ANTES do responsável: quem está com a conversa não
  // é quem falou com o cliente, e é essa a pergunta aqui. O responsável segue
  // junto quando existe — ver a nota em `soBot`.
  if (conv.soBot) return resp ? `só o bot respondeu · atribuída a ${resp}` : "só o bot respondeu";
  if (resp) return `atribuída a ${resp}`;
  return "sem atendente";
}

/**
 * Título do diálogo. ⚠️ Não é o `comQuem` da lista: lá as saídas descrevem o
 * estado ("só o bot respondeu · atribuída a Daniel"), e emendar isso em
 * "Conversa ..." daria um título sem português. Sem gente identificada, quem
 * nomeia a conversa é o NÚMERO, que é o que de fato a separa das outras.
 */
function tituloDaConversa(
  conv: ConversaDoContato,
  team: { id: string; name: string }[],
  numero: string
) {
  const nomes = conv.participantes.map((id) => nomeDe(id, team) ?? "Carregando...");
  return nomes.length > 0 ? `Conversa com ${juntar(nomes)}` : `Conversa · ${numero}`;
}

function Estado({ conv }: { conv: ConversaDoContato }) {
  const [texto, cor] = conv.archivedAt
    ? ["Arquivada", "bg-slate-100 text-slate-600"]
    : conv.closedAt
      ? ["Finalizada", "bg-emerald-100 text-emerald-700"]
      : ["Aberta", "bg-indigo-100 text-indigo-700"];
  return (
    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold", cor)}>
      {texto}
    </span>
  );
}

/** Pílula de dia — o fio aqui atravessa meses, e "15:57" sozinho não situa. */
function SeparadorDeDia({ at }: { at: string }) {
  return (
    <div className="my-3 flex justify-center">
      <span className="flex items-center gap-1.5 rounded-full border bg-white px-3 py-1 text-[10px] font-medium text-slate-500">
        <CalendarDays className="size-3" />
        {format(new Date(at), "d 'de' MMMM 'de' yyyy", { locale: ptBR })}
      </span>
    </div>
  );
}

function Balao({
  message,
  autor,
  contatoNome,
}: {
  message: Message;
  autor: string | null;
  contatoNome: string;
}) {
  if (message.type === "event") return <PipelineEvent message={message} />;
  const out = message.direction === "out";
  /*
   * ⚠️ O NOME de quem enviou é metade do motivo desta tela existir: a conversa
   * passa por várias mãos, e sem ele o fio não diz quem falou o quê. No inbox
   * ele é dispensável — lá você está dentro da conversa e sabe com quem está.
   */
  const emCima = message.internal
    ? "Comentário interno"
    : out
      ? (autor ?? (message.automated ? "Automático" : "Atendente"))
      : contatoNome;

  return (
    <div className={cn("mb-2 flex", out ? "justify-end" : "justify-start")}>
      <div className={cn("flex max-w-[78%] flex-col", out ? "items-end" : "items-start")}>
        <span className="mb-0.5 px-1 text-[10px] font-semibold text-slate-500">{emCima}</span>
        <div
          className={cn(
            "max-w-full overflow-hidden break-words rounded-2xl px-3.5 py-2 text-[13px]",
            message.internal
              ? "border border-amber-200 bg-amber-50 text-amber-900"
              : out
                ? "rounded-br-sm bg-indigo-500 text-white"
                : "msg-in rounded-bl-sm bg-slate-100 text-slate-800"
          )}
        >
          {message.deletedAt ? (
            <span
              className={cn(
                "flex items-center gap-1.5 text-xs italic",
                out && !message.internal ? "text-indigo-200" : "text-slate-400"
              )}
            >
              <Ban className="size-3.5 shrink-0" aria-hidden />
              Esta mensagem foi apagada
            </span>
          ) : message.type === "audio" ||
            message.type === "image" ||
            message.type === "video" ||
            message.type === "file" ? (
            <>
              <MediaContent message={message} out={out && !message.internal} />
              <LegendaMidia message={message} out={out && !message.internal} />
            </>
          ) : (
            <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">{message.body}</span>
          )}
          <p
            className={cn(
              "mt-1 text-right text-[9px]",
              message.internal ? "text-amber-500" : out ? "text-indigo-200" : "text-slate-400"
            )}
          >
            {format(new Date(message.at), "HH:mm")}
            {message.editedAt && !message.deletedAt && <span className="ml-1 italic">editada</span>}
          </p>
        </div>
      </div>
    </div>
  );
}

function Fio({ conv, contatoNome }: { conv: ConversaDoContato; contatoNome: string }) {
  const team = useDbTeam();
  if (conv.mensagens.length === 0) {
    /*
     * ⚠️ Vazio aqui significa vazio MESMO, e por isso o texto pode afirmar.
     * As policies de SELECT de `conversations` e `messages` têm as mesmas
     * condições por conversa (conferido no banco), então quem enxerga a
     * conversa enxerga as mensagens dela — não existe "a lista mostra e o fio
     * esconde". Conversa sem nenhuma mensagem existe de verdade: nasce assim em
     * "Nova conversa" e no rodízio, antes da primeira palavra.
     */
    return (
      <p className="py-10 text-center text-sm text-slate-500">
        Esta conversa ainda não tem mensagens.
      </p>
    );
  }
  return (
    <div>
      {conv.mensagens.map((m, i) => {
        const anterior = conv.mensagens[i - 1];
        const novoDia = !anterior || !isSameDay(new Date(anterior.at), new Date(m.at));
        return (
          <div key={m.id}>
            {novoDia && <SeparadorDeDia at={m.at} />}
            <Balao message={m} autor={nomeDe(m.createdBy, team)} contatoNome={contatoNome} />
          </div>
        );
      })}
    </div>
  );
}

export function ContactConversations({
  contactId,
  contatoNome,
}: {
  contactId: string;
  contatoNome: string;
}) {
  const { conversas, loading, erro } = useContactConversations(contactId);
  const team = useDbTeam();
  const { channels } = useWhatsappChannels();
  const [abertaId, setAbertaId] = useState<string | null>(null);
  const aberta = useMemo(
    () => conversas.find((c) => c.id === abertaId) ?? null,
    [conversas, abertaId]
  );

  const numeroDe = (conv: ConversaDoContato) => {
    const canal = channels.find((c) => c.id === conv.channelId);
    if (canal) return canal.name;
    return conv.channel === "whatsapp" ? "WhatsApp" : conv.channel;
  };

  const periodo = (conv: ConversaDoContato) => {
    if (!conv.primeira || !conv.ultima) return "sem mensagens";
    const de = new Date(conv.primeira);
    const ate = new Date(conv.ultima);
    const fmt = (d: Date) => format(d, "dd/MM/yy", { locale: ptBR });
    return isSameDay(de, ate) ? fmt(de) : `${fmt(de)} a ${fmt(ate)}`;
  };

  const contagem = (conv: ConversaDoContato) =>
    `${conv.mensagens.length} ${conv.mensagens.length === 1 ? "mensagem" : "mensagens"}`;

  return (
    <div className="rounded-xl border bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-700">
        Conversas{conversas.length > 0 ? ` (${conversas.length})` : ""}
      </h2>

      {loading ? (
        <p className="text-sm text-slate-500">Carregando conversas...</p>
      ) : erro ? (
        // O motivo vai para a tela: "não carregou" sem código nem mensagem é o
        // que já custou rodadas de investigação neste projeto.
        <p className="text-sm text-rose-600">Não foi possível carregar: {erro}</p>
      ) : conversas.length === 0 ? (
        <p className="text-sm text-slate-500">
          Este contato ainda não tem conversa. Use &quot;Abrir conversa&quot; para começar uma.
        </p>
      ) : (
        <ul className="space-y-2">
          {conversas.map((conv) => (
            <li key={conv.id} className="rounded-lg border p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-sm font-medium text-slate-800">
                    <ChannelIcon channel={conv.channel} size={14} />
                    <span className="truncate">{numeroDe(conv)}</span>
                  </p>
                  <p className="mt-0.5 truncate text-xs text-slate-600">{comQuem(conv, team)}</p>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    {periodo(conv)} · {contagem(conv)}
                  </p>
                </div>
                <Estado conv={conv} />
              </div>
              <div className="mt-2 flex items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5 text-xs"
                  onClick={() => setAbertaId(conv.id)}
                >
                  <MessageSquareText className="size-3.5" />
                  Visualizar conversa
                </Button>
                {/*
                  Link de verdade, e não um botão que navega: é o que devolve
                  Ctrl+clique, botão do meio e "abrir em nova guia" — o mesmo
                  motivo pelo qual o "Abrir conversa" do Relatório virou <Link>.
                */}
                <Link
                  href={`/conversas?c=${conv.id}`}
                  className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline"
                >
                  Abrir na caixa <ExternalLink className="size-3" />
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!aberta} onOpenChange={(v) => !v && setAbertaId(null)}>
        <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {aberta ? tituloDaConversa(aberta, team, numeroDe(aberta)) : "Conversa"}
            </DialogTitle>
            <DialogDescription>
              {aberta
                ? `${contatoNome} · ${numeroDe(aberta)} · ${periodo(aberta)} · ${contagem(aberta)}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="-mx-1 flex-1 overflow-y-auto px-1">
            {aberta && <Fio conv={aberta} contatoNome={contatoNome} />}
          </div>
          <p className="border-t pt-2 text-[11px] text-slate-400">
            Somente leitura. Para responder, use &quot;Abrir na caixa&quot;.
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
}
