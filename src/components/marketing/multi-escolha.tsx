"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface Opcao {
  value: string;
  label: string;
}

/**
 * Escolha de VÁRIAS opções (listas inteligentes ou tags do público da campanha).
 *
 * Popover com caixas de marcar e busca, e não o `Select`: o do projeto é de
 * valor único (Base UI), e com dezenas de listas o que importa é ver de uma vez
 * o que já está marcado e achar a próxima digitando.
 *
 * ⚠️ O popover NÃO fecha a cada clique: marcar três listas não pode custar três
 * aberturas.
 */
export function MultiEscolha({
  opcoes,
  value,
  onChange,
  placeholder,
  vazio,
}: {
  opcoes: Opcao[];
  value: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
  vazio: string;
}) {
  const [open, setOpen] = useState(false);
  const [busca, setBusca] = useState("");

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return q ? opcoes.filter((o) => o.label.toLowerCase().includes(q)) : opcoes;
  }, [opcoes, busca]);

  const marcados = new Set(value);
  const rotulos = opcoes.filter((o) => marcados.has(o.value)).map((o) => o.label);
  const resumo =
    rotulos.length === 0
      ? placeholder
      : rotulos.length === 1
        ? rotulos[0]
        : `${rotulos.length} selecionadas`;

  const alternar = (v: string) =>
    onChange(marcados.has(v) ? value.filter((x) => x !== v) : [...value, v]);

  return (
    <div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <button
              type="button"
              className={cn(
                "mt-2 flex h-8 w-full items-center justify-between rounded-md border px-2.5 text-xs",
                "bg-white text-left hover:bg-slate-50",
                rotulos.length === 0 && "text-slate-400"
              )}
            />
          }
        >
          <span className="truncate">{resumo}</span>
          <ChevronDown className="size-3.5 shrink-0 text-slate-400" />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-(--anchor-width) min-w-64 p-0">
          <div className="flex items-center gap-2 border-b px-2.5 py-2">
            <Search className="size-3.5 shrink-0 text-slate-400" />
            <Input
              autoFocus
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar..."
              className="h-7 border-0 px-0 text-xs shadow-none focus-visible:ring-0"
            />
          </div>
          <div className="max-h-72 overflow-y-auto p-1">
            {visiveis.length === 0 ? (
              <p className="px-2 py-3 text-center text-xs text-slate-400">{vazio}</p>
            ) : (
              visiveis.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => alternar(o.value)}
                  className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-slate-100"
                >
                  <Checkbox checked={marcados.has(o.value)} className="pointer-events-none mt-px" />
                  <span className="break-words">{o.label}</span>
                </button>
              ))
            )}
          </div>
          {value.length > 0 && (
            <div className="flex justify-between border-t px-2.5 py-1.5 text-[11px] text-slate-500">
              <span>{value.length} marcada(s)</span>
              <button type="button" onClick={() => onChange([])} className="font-semibold hover:text-slate-800">
                Limpar
              </button>
            </div>
          )}
        </PopoverContent>
      </Popover>

      {/* Os nomes marcados ficam à vista: "3 selecionadas" sozinho obrigaria a
          reabrir a lista para conferir para quem a campanha vai sair. */}
      {rotulos.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {opcoes
            .filter((o) => marcados.has(o.value))
            .map((o) => (
              <span
                key={o.value}
                className="inline-flex items-center gap-1 rounded bg-indigo-50 px-1.5 py-0.5 text-[11px] text-indigo-700"
              >
                {o.label}
                <button
                  type="button"
                  onClick={() => alternar(o.value)}
                  aria-label={`Remover ${o.label}`}
                  className="text-indigo-500 hover:text-indigo-800"
                >
                  ×
                </button>
              </span>
            ))}
        </div>
      )}
    </div>
  );
}
