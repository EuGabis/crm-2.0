"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";

/**
 * Avisa quando há versão nova do CRM no ar.
 *
 * O CRM fica aberto o dia inteiro; uma aba aberta antes do deploy continua
 * rodando o código ANTIGO até um F5 — e a correção que já está em produção
 * "não funciona" para quem não recarregou (caso do selo frio/quente,
 * 2026-10-16). Compara o commit embutido no build com o de `/api/version`.
 *
 * ⚠️ Aviso com botão, NUNCA recarga automática: quem está no meio de uma
 * mensagem perderia o que digitou.
 */
const BUILD = process.env.NEXT_PUBLIC_BUILD_SHA ?? "local";
const INTERVALO_MS = 5 * 60_000;

export function NovaVersao() {
  const avisado = useRef(false);

  useEffect(() => {
    if (BUILD === "local") return;
    const checar = async () => {
      if (avisado.current || document.visibilityState !== "visible") return;
      try {
        const r = await fetch("/api/version", { cache: "no-store" });
        if (!r.ok) return;
        const { commit } = (await r.json()) as { commit?: string };
        if (!commit || commit === "local" || commit === BUILD) return;
        avisado.current = true;
        toast.info("Há uma versão nova do CRM", {
          description: "Atualize a página para receber as correções.",
          duration: Infinity,
          action: { label: "Atualizar", onClick: () => window.location.reload() },
        });
      } catch {
        // rede caiu: tenta na próxima rodada
      }
    };
    const t = setInterval(checar, INTERVALO_MS);
    const onVis = () => void checar();
    document.addEventListener("visibilitychange", onVis);
    void checar();
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return null;
}
