"use client";

import { useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  AlertTriangle,
  ArrowRight,
  ClipboardList,
  Lightbulb,
  Loader2,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useLastHandoffSummary } from "@/lib/data/repos/db/conversations";
import { cn } from "@/lib/utils";

/** Rótulo e cor por tipo de chamado — é a primeira coisa que o atendente lê. */
const TIPO: Record<string, { label: string; classe: string }> = {
  vendas: { label: "Venda em andamento", classe: "bg-emerald-100 text-emerald-700" },
  aluno: { label: "Dúvida de aluno", classe: "bg-sky-100 text-sky-700" },
  cobranca: { label: "Cobrança / financeiro", classe: "bg-amber-100 text-amber-700" },
  suporte: { label: "Suporte", classe: "bg-indigo-100 text-indigo-700" },
  outro: { label: "Outro assunto", classe: "bg-slate-100 text-slate-600" },
};

interface Analise {
  tipo: string;
  tipoMotivo: string;
  situacao: string;
  proximoPasso: string;
  sugestoes: string[];
  atencao: string[];
  usouResumo: boolean;
  mensagensLidas: number;
}

/**
 * Aba "Resumo" da barra lateral da conversa.
 *
 * Junta as duas coisas que ajudam quem está com a conversa aberta: o **resumo do
 * último atendimento** (o que já foi tratado) e a **Lita**, que lê o atendimento
 * inteiro e diz o que fazer agora.
 *
 * ⚠️ O resumo saiu da faixa no topo do thread e veio para cá: como faixa, ele
 * empurrava a conversa para baixo em TODA abertura, mesmo quando o atendente já
 * o tinha lido. Aqui ele fica ao lado das outras informações do contato — no
 * mesmo lugar onde se olha "Resumo pagamentos" — e o thread volta a começar na
 * primeira mensagem.
 */
export function HandoffPanel({ conversationId }: { conversationId: string }) {
  const { resumo } = useLastHandoffSummary(conversationId);
  const [analise, setAnalise] = useState<Analise | null>(null);
  const [carregando, setCarregando] = useState(false);

  const pedirAjuda = async () => {
    setCarregando(true);
    try {
      const res = await fetch("/api/conversations/assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json?.error ?? "Não foi possível consultar a Lita");
        return;
      }
      setAnalise(json);
    } catch {
      toast.error("Falha de conexão");
    } finally {
      setCarregando(false);
    }
  };

  const tipo = analise ? (TIPO[analise.tipo] ?? TIPO.outro) : null;

  return (
    <div className="space-y-3">
      {/* ---- Resumo do último atendimento ---- */}
      <div className="rounded-lg border bg-white">
        <div className="flex items-center gap-1.5 border-b px-3 py-2">
          <ClipboardList className="size-3.5 text-amber-600" />
          <p className="text-[11px] font-bold text-slate-700">Resumo do último atendimento</p>
        </div>
        {resumo ? (
          <div className="px-3 py-2">
            <p className="text-[10px] text-slate-400">
              {resumo.kind === "transferencia" ? "ao transferir" : "ao finalizar"} · {resumo.autor} ·{" "}
              {format(new Date(resumo.createdAt), "d 'de' MMM, HH:mm", { locale: ptBR })}
            </p>
            {/* `whitespace-pre-line`: o resumo pode ter mais de um parágrafo, e no
                HTML quebra de linha conta como espaço. */}
            <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-slate-700">
              {resumo.body}
            </p>
          </div>
        ) : (
          <p className="px-3 py-3 text-[11px] leading-relaxed text-slate-400">
            Ainda não há resumo. Ele é escrito ao finalizar ou transferir a conversa, e fica aqui
            para quem atender esse cliente depois.
          </p>
        )}
      </div>

      {/* ---- Lita ---- */}
      <div className="rounded-lg border bg-white">
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
          <span className="flex items-center gap-1.5">
            <Sparkles className="size-3.5 text-indigo-600" />
            <p className="text-[11px] font-bold text-slate-700">Lita ajuda</p>
          </span>
          {analise && (
            <button
              onClick={() => void pedirAjuda()}
              disabled={carregando}
              className="text-[10px] font-medium text-indigo-600 hover:underline disabled:opacity-50"
            >
              analisar de novo
            </button>
          )}
        </div>

        {!analise && !carregando && (
          <div className="px-3 py-3">
            <p className="mb-2 text-[11px] leading-relaxed text-slate-500">
              A Lita lê o atendimento inteiro — com a transcrição dos áudios e o resumo anterior —
              identifica se é venda, dúvida de aluno ou financeiro, e sugere o próximo passo.
            </p>
            <Button size="sm" className="h-8 w-full gap-1.5 text-xs" onClick={() => void pedirAjuda()}>
              <Sparkles className="size-3.5" /> Pedir ajuda da Lita
            </Button>
          </div>
        )}

        {carregando && (
          <div className="flex items-center gap-2 px-3 py-6 text-xs text-slate-400">
            <Loader2 className="size-3.5 animate-spin" /> lendo o atendimento...
          </div>
        )}

        {analise && !carregando && (
          <div className="space-y-2.5 px-3 py-3">
            <div>
              <span
                className={cn(
                  "inline-block rounded-full px-2 py-0.5 text-[10px] font-bold",
                  tipo!.classe
                )}
              >
                {tipo!.label}
              </span>
              {analise.tipoMotivo && (
                <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
                  {analise.tipoMotivo}
                </p>
              )}
            </div>

            {analise.situacao && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                  Situação
                </p>
                <p className="text-xs leading-relaxed text-slate-700">{analise.situacao}</p>
              </div>
            )}

            {/* O próximo passo ganha destaque porque é a única coisa que o
                atendente precisa decidir agora — o resto é apoio. */}
            {analise.proximoPasso && (
              <div className="rounded-md bg-indigo-50 px-2.5 py-2">
                <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-indigo-600">
                  <ArrowRight className="size-3" /> Próximo passo
                </p>
                <p className="mt-0.5 text-xs font-medium leading-relaxed text-indigo-900">
                  {analise.proximoPasso}
                </p>
              </div>
            )}

            {analise.sugestoes.length > 0 && (
              <div>
                <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                  <Lightbulb className="size-3" /> Sugestões
                </p>
                <ul className="mt-0.5 space-y-1">
                  {analise.sugestoes.map((s) => (
                    <li key={s} className="flex gap-1.5 text-xs leading-relaxed text-slate-700">
                      <span className="mt-1.5 size-1 shrink-0 rounded-full bg-slate-300" />
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {analise.atencao.length > 0 && (
              <div className="rounded-md bg-amber-50 px-2.5 py-2">
                <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-amber-700">
                  <AlertTriangle className="size-3" /> Pontos de atenção
                </p>
                <ul className="mt-0.5 space-y-1">
                  {analise.atencao.map((a) => (
                    <li key={a} className="flex gap-1.5 text-xs leading-relaxed text-amber-900">
                      <span className="mt-1.5 size-1 shrink-0 rounded-full bg-amber-400" />
                      {a}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Dizer no que ela se baseou é o que permite ao atendente calibrar a
                confiança: análise de 4 mensagens sem resumo vale menos que a de
                60 com o histórico do repasse. */}
            <p className="border-t pt-2 text-[10px] text-slate-400">
              Baseado em {analise.mensagensLidas} mensagem
              {analise.mensagensLidas === 1 ? "" : "s"}
              {analise.usouResumo ? " e no resumo anterior" : ", sem resumo anterior"} · confira
              antes de responder.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
