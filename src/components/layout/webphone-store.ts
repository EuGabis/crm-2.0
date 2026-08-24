"use client";

import { create } from "zustand";

/**
 * Estado do teclado do webphone (Configurações → Telefonia).
 *
 * Já foi um popover da barra superior acionado de longe — do card do funil e do
 * cabeçalho da conversa —, e o estado é global por causa disso. O popover saiu
 * em 2026-08-24 (prometia ligação e não completava nenhuma) e esses dois botões
 * passaram a abrir o discador do aparelho, então hoje só o próprio painel lê
 * daqui. `open`/`setOpen`/`callContact` continuam aqui para o dia em que houver
 * provedor de voz e o painel voltar a ser chamado de fora.
 */
interface WebphoneState {
  open: boolean;
  number: string;
  /** Nome de quem está sendo chamado, quando a ligação partiu de um contato. */
  target: string | null;
  setOpen: (open: boolean) => void;
  setNumber: (number: string) => void;
  press: (key: string) => void;
  backspace: () => void;
  /** Abre o webphone já com o número do contato no visor. */
  callContact: (phone: string, name?: string) => void;
}

export const useWebphone = create<WebphoneState>((set) => ({
  open: false,
  number: "",
  target: null,
  setOpen: (open) => set({ open }),
  setNumber: (number) => set({ number }),
  press: (key) => set((s) => ({ number: s.number + key })),
  backspace: () => set((s) => ({ number: s.number.slice(0, -1) })),
  callContact: (phone, name) =>
    set({ open: true, number: formatDigits(phone), target: name ?? null }),
}));

/** Mantém só dígitos e o + inicial — o visor do teclado é numérico. */
function formatDigits(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits ? `+${digits}` : "";
}
