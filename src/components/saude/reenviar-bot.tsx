"use client";

import { useState } from "react";
import { Loader2, RotateCw, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/shared/confirm";

interface Previa {
  conversas: number;
  mensagens: number;
  conversasComFalha: number;
  pulos: Record<string, number>;
  amostra: { contato: string; telefone: string; mensagens: string[] }[];
}

/**
 * Reenvio das mensagens do fluxo automático (bot) que falharam.
 * Primeiro a PRÉVIA, depois o envio — mensagem enviada não tem desfazer.
 */
export function ReenviarBot() {
  const confirm = useConfirm();
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const verPrevia = async () => {
    setCarregando(true);
    try {
      const res = await fetch("/api/whatsapp/reenviar-bot", { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      setPrevia(j);
    } catch (e) {
      toast.error(`Não foi possível montar a prévia: ${e instanceof Error ? e.message : e}`);
    } finally {
      setCarregando(false);
    }
  };

  const enviar = async () => {
    if (!previa) return;
    const ok = await confirm({
      title: `Reenviar ${previa.mensagens} mensagem(ns) para ${previa.conversas} contato(s)?`,
      description: "As mensagens saem pelo WhatsApp e não podem ser desfeitas.",
      confirmLabel: "Reenviar",
    });
    if (!ok) return;
    setEnviando(true);
    let total = 0;
    let erros = 0;
    try {
      // Rodadas de até 40 s até acabar (a rota tem limite de tempo).
      for (let rodada = 0; rodada < 20; rodada++) {
        const res = await fetch("/api/whatsapp/reenviar-bot", { method: "POST" });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
        total += j.enviadas;
        erros += j.totalErros;
        if (j.erros?.length) console.warn("[reenvio do bot]", j.erros);
        if (!j.restantes || j.conversas === 0) break;
      }
      if (erros) {
        toast.warning(`${total} reenviada(s); ${erros} não foram (o motivo fica no balão de cada conversa).`, {
          duration: 9000,
        });
      } else toast.success(`${total} mensagem(ns) reenviada(s).`);
      await verPrevia();
    } catch (e) {
      toast.error(`Reenvio interrompido: ${e instanceof Error ? e.message : e}`);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <section className="rounded-xl border bg-white">
      <header className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Mensagens do fluxo automático que falharam</h2>
          <p className="text-[11px] text-slate-500">
            Últimas 24h · só o que o cliente ainda não recebeu, com a janela de 24h aberta
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-8 shrink-0 gap-1.5 text-xs"
          onClick={verPrevia}
          disabled={carregando || enviando}
        >
          {carregando ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCw className="size-3.5" />}
          {previa ? "Atualizar prévia" : "Ver prévia"}
        </Button>
      </header>
      {previa && (
        <div className="space-y-3 p-4">
          <p className="text-xs text-slate-700">
            <strong>{previa.mensagens}</strong> mensagem(ns) para <strong>{previa.conversas}</strong> contato(s).{" "}
            <span className="text-slate-500">
              Ficam de fora: {previa.pulos["janela fechada"] ?? 0} com a janela de 24h fechada (só template) e{" "}
              {previa.pulos["conversa seguiu depois da falha"] ?? 0} em que a conversa já seguiu.
            </span>
          </p>
          {previa.amostra.length > 0 && (
            <ul className="max-h-64 space-y-1.5 overflow-auto rounded-lg border bg-slate-50 p-2">
              {previa.amostra.map((a, i) => (
                <li key={i} className="text-[11px] text-slate-600">
                  <span className="font-semibold text-slate-800">{a.contato}</span> · {a.telefone}
                  <span className="block whitespace-pre-line text-slate-500">— {a.mensagens.join("\n— ")}</span>
                </li>
              ))}
            </ul>
          )}
          <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={enviar} disabled={enviando || previa.mensagens === 0}>
            {enviando ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
            {enviando ? "Reenviando..." : "Reenviar agora"}
          </Button>
        </div>
      )}
    </section>
  );
}
