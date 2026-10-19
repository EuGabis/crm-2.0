"use client";

import { useCallback, useRef, useState, type CSSProperties, type PointerEvent } from "react";

const CHAVE = "lito.lembrete.posicao";
type Pos = { x: number; y: number };

function ler(): Pos | null {
  try {
    const v = JSON.parse(localStorage.getItem(CHAVE) ?? "null");
    return v && typeof v.x === "number" && typeof v.y === "number" ? v : null;
  } catch {
    return null;
  }
}

/** Mantém o cartão dentro da janela (tela redimensionada, monitor trocado). */
function limitar(p: Pos, largura: number, altura: number): Pos {
  return {
    x: Math.min(Math.max(0, p.x), Math.max(0, window.innerWidth - largura)),
    y: Math.min(Math.max(0, p.y), Math.max(0, window.innerHeight - altura)),
  };
}

/**
 * Cartão flutuante que a pessoa arrasta pelo cabeçalho (pedido de 2026-10-19:
 * o lembrete cobria a conversa). A posição fica no `localStorage` — por
 * dispositivo, como a sidebar minimizada — e vale para os próximos lembretes.
 * Sem posição salva, o cartão fica no canto padrão (`className` do chamador).
 */
export function useArrastavel() {
  const [pos, setPos] = useState<Pos | null>(() => (typeof window === "undefined" ? null : ler()));
  const inicio = useRef<{ dx: number; dy: number; w: number; h: number } | null>(null);

  const onPointerDown = useCallback((e: PointerEvent<HTMLElement>) => {
    // Botões do cabeçalho (fechar) continuam clicáveis.
    if ((e.target as HTMLElement).closest("button,a")) return;
    const card = (e.currentTarget as HTMLElement).closest("[data-arrastavel]") as HTMLElement | null;
    if (!card) return;
    const r = card.getBoundingClientRect();
    inicio.current = { dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width, h: r.height };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  }, []);

  const onPointerMove = useCallback((e: PointerEvent<HTMLElement>) => {
    const i = inicio.current;
    if (!i) return;
    setPos(limitar({ x: e.clientX - i.dx, y: e.clientY - i.dy }, i.w, i.h));
  }, []);

  const onPointerUp = useCallback(() => {
    if (!inicio.current) return;
    inicio.current = null;
    setPos((p) => {
      try {
        if (p) localStorage.setItem(CHAVE, JSON.stringify(p));
      } catch {
        // armazenamento bloqueado: a posição vale só nesta tela
      }
      return p;
    });
  }, []);

  const style: CSSProperties | undefined = pos
    ? { left: pos.x, top: pos.y, right: "auto" }
    : undefined;

  return {
    style,
    alca: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      className: "cursor-move select-none touch-none",
      title: "Arraste para mover",
    },
  };
}
