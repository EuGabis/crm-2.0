"use client";

import { useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { contactName } from "@/lib/data/repos/contacts";
import { useContactsByIds, useContactsSearch } from "@/lib/data/repos/db/contacts-search";
import { cn } from "@/lib/utils";

/**
 * Escolher um contato entre 41 mil.
 *
 * Os seletores do CRM eram um `<Select>` com `contacts.slice(0, 50)`: com 365
 * contatos passava (quase todo mundo aparecia); com 41 mil, mostrar os 50 mais
 * recentes é o mesmo que não ter seletor — o contato procurado quase nunca está
 * lá, e não havia como chegar nele.
 *
 * Aqui a lista vem do banco conforme se digita (a mesma `search_contacts` da
 * tela de Contatos, com o debounce dela). O contato JÁ ESCOLHIDO é resolvido
 * por id à parte: ele precisa aparecer no botão mesmo sem estar entre os
 * resultados da busca atual.
 */
export function ContactPicker({
  value,
  onChange,
  placeholder = "Selecione um contato",
  className,
}: {
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const { rows, total, loading } = useContactsSearch({
    query: term,
    conditions: [],
    sort: null,
    page: 0,
    pageSize: 20,
  });
  const selected = useContactsByIds([value]).get(value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className={cn(
              "flex h-8 w-full items-center justify-between rounded-md border px-2.5 text-xs",
              "bg-white text-left hover:bg-slate-50",
              !value && "text-slate-400",
              className
            )}
          />
        }
      >
        <span className="truncate">
          {selected ? contactName(selected) : value ? "Carregando..." : placeholder}
        </span>
        <ChevronDown className="size-3.5 shrink-0 text-slate-400" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[--anchor-width] min-w-64 p-0">
        <div className="flex items-center gap-2 border-b px-2.5 py-2">
          <Search className="size-3.5 shrink-0 text-slate-400" />
          <Input
            autoFocus
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Buscar por nome, e-mail ou telefone"
            className="h-7 border-0 px-0 text-xs shadow-none focus-visible:ring-0"
          />
        </div>
        <div className="max-h-64 overflow-y-auto py-1">
          {loading && rows.length === 0 && (
            <p className="px-3 py-4 text-center text-xs text-slate-400">Buscando...</p>
          )}
          {!loading && rows.length === 0 && (
            <p className="px-3 py-4 text-center text-xs text-slate-400">
              {term ? "Nenhum contato encontrado" : "Nenhum contato cadastrado"}
            </p>
          )}
          {rows.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                onChange(c.id);
                setOpen(false);
              }}
              className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs hover:bg-slate-50"
            >
              <span className="min-w-0">
                <span className="block truncate font-medium text-slate-700">{contactName(c)}</span>
                <span className="block truncate text-[10px] text-slate-400">
                  {c.email || c.phone || "—"}
                </span>
              </span>
              {value === c.id && <Check className="size-3.5 shrink-0 text-indigo-600" />}
            </button>
          ))}
          {/* Diz que a lista está cortada. Sem isto, "não achei" e "tem mais,
              refine a busca" ficam indistinguíveis. */}
          {total > rows.length && (
            <p className="border-t px-3 py-1.5 text-[10px] text-slate-400">
              Mostrando {rows.length} de {total.toLocaleString("pt-BR")} — refine a busca
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
