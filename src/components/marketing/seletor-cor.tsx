"use client";

import { useState, type ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { corValida } from "@/lib/email/design";
import { cn } from "@/lib/utils";

/** Paleta base de sugestões — as do Brand Board entram na frente. */
export const CORES_BASE = [
  "#0f172a", "#334155", "#64748b", "#cbd5e1", "#f1f5f9", "#ffffff",
  "#6366f1", "#0369a1", "#0891b2", "#059669", "#16a34a", "#ca8a04",
  "#d97706", "#ea580c", "#dc2626", "#db2777", "#9333ea", "#131826",
];

/**
 * Escolha de cor: amostras (marca + base), o seletor nativo do navegador e o
 * campo hex — quem tem o código da cor da marca cola direto. Hex inválido não
 * é aplicado (o template só aceita hex, e um valor torto viraria a cor padrão
 * sem ninguém entender por quê).
 */
export function SeletorCor({
  value,
  onChange,
  sugestoes = [],
  limpar,
  trigger,
  titulo,
}: {
  value: string | null;
  onChange: (cor: string) => void;
  sugestoes?: string[];
  /** Quando existe, mostra "Sem cor" (ex.: tirar a cor de um trecho). */
  limpar?: () => void;
  /** Gatilho próprio (ex.: botão da barra do editor); sem ele, amostra + hex. */
  trigger?: ReactNode;
  titulo?: string;
}) {
  const [open, setOpen] = useState(false);
  const [hex, setHex] = useState(value ?? "");
  const cores = [...new Set([...sugestoes.filter(corValida).map((c) => c.toLowerCase()), ...CORES_BASE])];

  const aplicar = (c: string) => {
    onChange(c.toLowerCase());
    setHex(c.toLowerCase());
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setHex(value ?? "");
      }}
    >
      <PopoverTrigger
        render={
          trigger ? (
            <button type="button" className="flex size-7 items-center justify-center rounded text-slate-600 hover:bg-slate-100" />
          ) : (
            <button
              type="button"
              className="flex h-8 w-full items-center gap-2 rounded-md border bg-white px-2 text-xs hover:bg-slate-50"
            />
          )
        }
      >
        {trigger ?? (
          <>
            <span className="size-4 shrink-0 rounded border" style={{ backgroundColor: value ?? "transparent" }} />
            <span className="truncate font-mono text-slate-600">{value ?? "—"}</span>
          </>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60">
        {titulo && <p className="text-xs font-semibold text-slate-700">{titulo}</p>}
        <div className="grid grid-cols-6 gap-1.5">
          {cores.slice(0, 24).map((c) => (
            <button
              key={c}
              type="button"
              title={c}
              onClick={() => {
                aplicar(c);
                setOpen(false);
              }}
              className={cn(
                "size-7 rounded border transition hover:scale-110",
                value?.toLowerCase() === c && "ring-2 ring-indigo-500 ring-offset-1",
              )}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={corValida(hex) && hex.length === 7 ? hex : "#000000"}
            onChange={(e) => aplicar(e.target.value)}
            className="h-8 w-10 cursor-pointer rounded border bg-white p-0.5"
            aria-label="Escolher cor"
          />
          <input
            value={hex}
            onChange={(e) => {
              const v = e.target.value.trim();
              setHex(v);
              if (corValida(v)) onChange(v.toLowerCase());
            }}
            placeholder="#000000"
            className={cn(
              "h-8 min-w-0 flex-1 rounded-md border px-2 font-mono text-xs",
              hex && !corValida(hex) && "border-red-300 text-red-600",
            )}
          />
        </div>
        {limpar && (
          <button
            type="button"
            onClick={() => {
              limpar();
              setOpen(false);
            }}
            className="text-left text-xs text-slate-500 hover:underline"
          >
            Sem cor
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
