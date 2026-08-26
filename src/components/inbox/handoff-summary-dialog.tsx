"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Resumo do atendimento, pedido ao finalizar ou transferir a conversa.
 *
 * O problema que resolve: o que aconteceu no atendimento fica só na cabeça de
 * quem atendeu. Quem assume a conversa depois — ou atende o mesmo cliente quando
 * ele volta semanas mais tarde — precisaria rolar tudo para descobrir o que já
 * foi tratado.
 *
 * ⚠️ **É opcional.** "Finalizar sem resumo" é um botão de verdade, não um
 * caminho escondido: com ~150 finalizações por mês, obrigar a escrever produziria
 * uma fileira de "ok" e "resolvido" — campo preenchido e sem informação, que é
 * pior que vazio porque dá aparência de histórico.
 *
 * O que torna o opcional viável é o RASCUNHO: a IA escreve a partir das
 * mensagens (incluindo a transcrição dos áudios) e a pessoa só revisa. O caminho
 * mais fácil passa a ser deixar o resumo, não pulá-lo.
 */
export function HandoffSummaryDialog({
  open,
  conversationId,
  kind,
  destino,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  conversationId: string | null;
  kind: "finalizacao" | "transferencia";
  /** Nome de quem vai receber a conversa, quando é transferência. */
  destino?: string | null;
  /** Recebe o texto (vazio = seguir sem resumo). */
  onConfirm: (resumo: string) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [texto, setTexto] = useState("");
  const [gerando, setGerando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  // Guarda de qual conversa o rascunho é: sem isto, abrir o diálogo numa segunda
  // conversa reaproveitaria o texto da primeira. É `useRef` e não estado porque
  // só serve para NÃO repetir a geração — mudar esse valor não precisa
  // redesenhar nada, e `setState` no corpo do efeito dispara cascata.
  const rascunhoDe = useRef<string | null>(null);

  const gerar = async (id: string) => {
    rascunhoDe.current = id;
    setGerando(true);
    setTexto("");
    try {
      const res = await fetch("/api/conversations/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Falha na IA não pode travar a finalização: o campo continua editável e
        // a pessoa escreve à mão (ou segue sem resumo).
        toast.info(json?.error ?? "Não foi possível gerar o rascunho — escreva à mão");
        return;
      }
      setTexto(json.resumo ?? "");
    } catch {
      toast.info("Sem conexão para gerar o rascunho — escreva à mão");
    } finally {
      setGerando(false);
    }
  };

  useEffect(() => {
    if (!open || !conversationId || rascunhoDe.current === conversationId) return;
    void gerar(conversationId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, conversationId]);

  const confirmar = async (comResumo: boolean) => {
    setSalvando(true);
    await onConfirm(comResumo ? texto.trim() : "");
    setSalvando(false);
    rascunhoDe.current = null;
  };

  const finalizando = kind === "finalizacao";

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !salvando) {
          rascunhoDe.current = null;
          onCancel();
        }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {finalizando ? "Finalizar conversa" : "Transferir conversa"}
          </DialogTitle>
        </DialogHeader>

        <p className="text-xs leading-relaxed text-slate-500">
          {finalizando ? (
            <>
              Deixe um resumo do que foi tratado. Ele aparece no topo da conversa para quem
              atender esse cliente da próxima vez — inclusive se ele voltar a chamar meses
              depois.
            </>
          ) : (
            <>
              Deixe um resumo para{" "}
              <strong className="text-slate-700">{destino ?? "quem vai assumir"}</strong> — é o
              que essa pessoa vai ler antes de responder, sem precisar rolar a conversa inteira.
            </>
          )}
        </p>

        <div className="rounded-lg border bg-white">
          <div className="flex items-center justify-between border-b px-3 py-1.5">
            <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-indigo-500">
              <Sparkles className="size-3" />
              {gerando ? "escrevendo rascunho..." : "rascunho da IA · revise antes de salvar"}
            </span>
            <button
              onClick={() => conversationId && void gerar(conversationId)}
              disabled={gerando || !conversationId}
              className="text-[10px] font-medium text-indigo-600 hover:underline disabled:opacity-50"
            >
              Gerar de novo
            </button>
          </div>
          {gerando ? (
            <div className="flex items-center gap-2 px-3 py-6 text-xs text-slate-400">
              <Loader2 className="size-3.5 animate-spin" /> lendo a conversa...
            </div>
          ) : (
            <textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              rows={5}
              placeholder="Ex.: cliente pediu valores do curso, enviei a tabela e o PDF. Ficou de responder até sexta."
              className="w-full resize-none border-0 bg-transparent p-3 text-sm text-slate-800 outline-none placeholder:text-slate-400"
            />
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" size="sm" className="text-xs" disabled={salvando} onClick={onCancel}>
            Cancelar
          </Button>
          {/* Pular é um botão visível, não um X no canto: o resumo é opcional e
              esconder a saída faria a pessoa escrever qualquer coisa para
              conseguir finalizar. */}
          <Button
            variant="outline"
            size="sm"
            className="text-xs"
            disabled={salvando || gerando}
            onClick={() => void confirmar(false)}
          >
            {finalizando ? "Finalizar sem resumo" : "Transferir sem resumo"}
          </Button>
          <Button
            size="sm"
            className="gap-1.5 text-xs"
            disabled={salvando || gerando || !texto.trim()}
            onClick={() => void confirmar(true)}
          >
            {salvando && <Loader2 className="size-3.5 animate-spin" />}
            {finalizando ? "Salvar e finalizar" : "Salvar e transferir"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
