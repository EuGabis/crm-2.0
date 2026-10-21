"use client";

import { useState } from "react";
import { ChevronDown, Plus, Search, Tag as TagIcon } from "lucide-react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { tagActions, useContactTags } from "@/lib/data/repos/db/tags";
import { cn } from "@/lib/utils";

/**
 * Escolher ETIQUETAS de uma lista curada.
 *
 * Substitui os três CAMPOS DE TEXTO LIVRE que o CRM tinha (composer, formulário
 * do contato, ação em massa). Digitar de memória é o que produzia "INTERESSADO
 * PP", "Interessado PP" e "interessado pp" como três etiquetas diferentes — e
 * ninguém conseguia filtrar por nenhuma delas com confiança.
 *
 * ⚠️ **Um componente para os quatro lugares**, incluindo o filtro da caixa de
 * entrada. Duas implementações divergiriam na primeira mudança, e o filtro
 * deixaria de casar com o que foi marcado — que é justamente o defeito que ele
 * existe para evitar.
 *
 * O valor são os NOMES, não ids: é assim que a etiqueta é gravada em
 * `contacts.tags` e é assim que as listas inteligentes e as campanhas já leem.
 */
export function TagPicker({
  value,
  onChange,
  placeholder = "Etiquetas",
  className,
  align = "start",
  permiteCriar = true,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  className?: string;
  align?: "start" | "end";
  /** Desligado no FILTRO da caixa: filtrar por etiqueta inexistente não acha nada. */
  permiteCriar?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const { tags, loaded } = useContactTags();

  const busca = term.trim().toLowerCase();
  const visiveis = busca ? tags.filter((t) => t.name.toLowerCase().includes(busca)) : tags;
  /*
   * "+ Criar" aparece quando a busca não acha a etiqueta EXATA (pedido de
   * 2026-10-21: vendedores criam). Exata e sem diferenciar maiúsculas — o
   * catálogo é único por lower(name). Criada, já fica marcada.
   */
  const [criando, setCriando] = useState(false);
  const podeCriar = permiteCriar && !!busca && loaded && !tags.some((t) => t.name.trim().toLowerCase() === busca);
  const criar = async () => {
    const nome = term.trim();
    setCriando(true);
    const r = await tagActions.create(nome);
    setCriando(false);
    if (!r.ok) return toast.error(r.erro ?? "Não foi possível criar a etiqueta");
    toast.success(`Etiqueta "${nome}" criada`);
    setTerm("");
    onChange([...value, nome]);
  };

  /*
   * ⚠️ Tudo aqui compara SEM diferenciar maiúsculas, porque o catálogo é único
   * por `lower(name)`: um contato marcado como "interessado pp" está marcado com
   * a MESMA etiqueta que o catálogo escreve "INTERESSADO PP". Comparando texto
   * cru, o checkbox aparecia desmarcado numa etiqueta que já estava no contato —
   * e clicar acrescentaria a segunda grafia.
   */
  const marcada = (nome: string) =>
    value.some((v) => v.trim().toLowerCase() === nome.trim().toLowerCase());

  const alternar = (nome: string) => {
    onChange(
      marcada(nome)
        ? value.filter((v) => v.trim().toLowerCase() !== nome.trim().toLowerCase())
        : [...value, nome]
    );
  };

  /*
   * ⚠️ O RÓTULO conta só o que está no catálogo. `value` é `contacts.tags` cru,
   * que traz junto o carimbo da importação — sem este recorte, o botão de um
   * contato sem etiqueta nenhuma dizia "2 etiquetas" e o de uma etiqueta só
   * mostrava o nome do arquivo importado.
   */
  const conhecidas = new Set(tags.map((t) => t.name.trim().toLowerCase()));
  const escolhidas = value.filter((v) => conhecidas.has(v.trim().toLowerCase()));

  const rotulo =
    escolhidas.length === 0
      ? placeholder
      : escolhidas.length === 1
        ? escolhidas[0]
        : `${escolhidas.length} etiquetas`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className={cn(
              "flex h-8 w-full items-center justify-between gap-1.5 rounded-md border px-2.5 text-xs",
              "bg-white text-left hover:bg-slate-50",
              escolhidas.length === 0 && "text-slate-400",
              className
            )}
          />
        }
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <TagIcon className="size-3.5 shrink-0" />
          <span className="truncate">{rotulo}</span>
        </span>
        <ChevronDown className="size-3.5 shrink-0 text-slate-400" />
      </PopoverTrigger>
      <PopoverContent align={align} className="w-64 p-0">
        <div className="border-b p-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
            <Input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Buscar"
              className="h-8 pl-7 text-xs"
            />
          </div>
        </div>

        {podeCriar && (
          <button
            type="button"
            disabled={criando}
            onClick={() => void criar()}
            className="flex w-full items-center gap-1.5 border-b px-3 py-2 text-left text-xs font-medium text-indigo-600 hover:bg-indigo-50 disabled:opacity-50"
          >
            <Plus className="size-3.5 shrink-0" />
            <span className="truncate">Criar etiqueta &quot;{term.trim()}&quot;</span>
          </button>
        )}
        {/* Altura limitada + rolagem: são 21 etiquetas hoje e a lista cresce. */}
        <div className="max-h-64 overflow-y-auto p-1 [scrollbar-width:thin]">
          {!loaded ? (
            <p className="px-2 py-3 text-xs text-slate-400">Carregando etiquetas...</p>
          ) : visiveis.length === 0 ? (
            /* ⚠️ Distingue "não há etiqueta nenhuma" de "a busca não achou" — os
               dois levam a ações diferentes (pedir ao admin × limpar a busca). */
            <p className="px-2 py-3 text-xs text-slate-400">
              {tags.length === 0
                ? "Nenhuma etiqueta cadastrada. Digite o nome acima para criar."
                : `Nada encontrado para "${term.trim()}".`}
            </p>
          ) : (
            visiveis.map((t) => {
              const ativa = marcada(t.name);
              return (
                <label
                  key={t.id}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-slate-50",
                    ativa && "bg-indigo-50/60"
                  )}
                >
                  <Checkbox
                    checked={ativa}
                    onCheckedChange={() => alternar(t.name)}
                    className="size-3.5"
                  />
                  <span className="min-w-0 flex-1 break-words">{t.name}</span>
                </label>
              );
            })
          )}
        </div>

        {escolhidas.length > 0 && (
          <div className="border-t p-1">
            <button
              type="button"
              /* ⚠️ Limpa só as ETIQUETAS, preservando o que não é do catálogo.
                 Com `onChange([])`, limpar a seleção apagaria do contato o
                 carimbo da importação — dado que a tela nem mostra, e que as
                 listas inteligentes usam. Desmarcar não pode apagar o
                 invisível. */
              onClick={() => onChange(value.filter((v) => !conhecidas.has(v.trim().toLowerCase())))}
              className="w-full rounded px-2 py-1.5 text-left text-xs text-slate-500 hover:bg-slate-50"
            >
              Limpar seleção ({escolhidas.length})
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
