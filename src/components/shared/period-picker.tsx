"use client";

import { useState } from "react";
import { ptBR } from "date-fns/locale";
import { CalendarIcon, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  PERIODO_MAX_DIAS,
  PRESETS,
  deData,
  diasEntre,
  hojeSP,
  longo,
  paraData,
  presetDoPeriodo,
  resolvePreset,
  rotuloDoBotao,
  type Periodo,
  type PresetKey,
} from "@/lib/periodo";
import { cn } from "@/lib/utils";

/**
 * Seletor de período com atalhos e CALENDÁRIO (pedido do Gabriel, 11/09: "poder
 * filtrar por uma data específica, como se eu pudesse selecionar no calendário
 * o período personalizado").
 *
 * Controlado e sem contexto: recebe e devolve `{ de, ate }` em "AAAA-MM-DD" —
 * a mesma moeda da rota e do banco, então não existe conversão de fuso entre a
 * escolha e a consulta (ver `lib/periodo.ts`, onde está a armadilha do dia a
 * menos).
 *
 * ⏳ O painel tem o SEU seletor (`dashboard/date-filter.tsx`), preso ao
 * `DashboardRangeProvider` e com presets próprios ("Trimestre passado"). Este
 * nasceu separado para não mexer no painel por causa de um relatório; quando
 * alguém precisar tocar nos dois, o caminho é o painel passar a usar este.
 */

export function PeriodoPicker({
  periodo,
  onChange,
  maxDias = PERIODO_MAX_DIAS,
  className,
}: {
  periodo: Periodo;
  onChange: (p: Periodo) => void;
  maxDias?: number;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const hoje = hojeSP();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm" className={cn("h-8 gap-2 text-xs", className)} />
        }
      >
        <CalendarIcon className="size-3.5" />
        {rotuloDoBotao(periodo, hoje)}
        <ChevronDown className="size-3" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-3">
        {/*
          ⚠️ O rascunho é semeado por MONTAGEM (`key`), não por um efeito que
          copia a prop quando o popover abre: `setState` síncrono dentro de
          `useEffect` dispara renderização em cascata e o lint acusa. É a mesma
          decisão do diálogo de respostas rápidas — remontar zera de graça.
        */}
        {open && (
          <Conteudo
            key={`${periodo.de}:${periodo.ate}`}
            periodo={periodo}
            hoje={hoje}
            maxDias={maxDias}
            aplicar={(p) => {
              onChange(p);
              setOpen(false);
            }}
            fechar={() => setOpen(false)}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

function Conteudo({
  periodo,
  hoje,
  maxDias,
  aplicar,
  fechar,
}: {
  periodo: Periodo;
  hoje: string;
  maxDias: number;
  aplicar: (p: Periodo) => void;
  fechar: () => void;
}) {
  // Rascunho: só vira filtro quando o usuário clica Aplicar. Sem isso, cada
  // clique no calendário dispararia uma consulta — inclusive o primeiro clique
  // de um intervalo, que ainda não é um intervalo.
  const [draft, setDraft] = useState<Periodo>(periodo);
  const dias = diasEntre(draft.de, draft.ate);
  const passouDoTeto = dias > maxDias;

  const escolherPreset = (key: PresetKey) => {
    if (key === "personalizado") return;
    setDraft(resolvePreset(key, hoje));
  };

  /*
   * ⚠️ O react-day-picker devolve `to` indefinido no PRIMEIRO clique de um
   * intervalo. Tratar isso como "período sem fim" deixaria o rascunho inválido;
   * aqui o dia clicado vira início E fim, que é exatamente o caso de quem quer
   * UMA data específica e clica uma vez só.
   */
  const escolherDias = (sel: { from?: Date; to?: Date } | undefined) => {
    if (!sel?.from) return;
    const de = deData(sel.from);
    const ate = sel.to ? deData(sel.to) : de;
    setDraft(de <= ate ? { de, ate } : { de: ate, ate: de });
  };

  const presetAtual = presetDoPeriodo(draft, hoje);

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row">
        {/*
            Os atalhos ficam em BOTÕES ao lado do calendário, não num menu: são
            o caminho de todo dia, e escondê-los atrás de um segundo clique
            faria o calendário — que é a exceção — parecer o único caminho.
          */}
        <div className="flex shrink-0 flex-row flex-wrap gap-1 sm:w-40 sm:flex-col">
          {PRESETS.filter((p) => p.key !== "personalizado").map((p) => {
            const ativo = presetAtual === p.key;
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => escolherPreset(p.key)}
                aria-pressed={ativo}
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-left text-xs font-medium transition-colors",
                  ativo ? "bg-indigo-500 text-white" : "text-slate-600 hover:bg-slate-100",
                )}
              >
                {p.label}
              </button>
            );
          })}
        </div>
        <Calendar
          mode="range"
          locale={ptBR}
          numberOfMonths={2}
          defaultMonth={paraData(draft.de)}
          selected={{ from: paraData(draft.de), to: paraData(draft.ate) }}
          onSelect={escolherDias}
          /* Dia futuro não tem lead nenhum: oferecê-lo só produziria colunas
               zeradas que parecem queda de volume. */
          disabled={{ after: paraData(hoje) }}
          className="rounded-md border"
        />
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <p className="text-[11px] text-slate-500">
          {draft.de === draft.ate ? (
            <>
              <span className="font-medium text-slate-700">{longo(draft.de)}</span> · 1 dia
            </>
          ) : (
            <>
              <span className="font-medium text-slate-700">{longo(draft.de)}</span> até{" "}
              <span className="font-medium text-slate-700">{longo(draft.ate)}</span> · {dias} dias
            </>
          )}
        </p>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={fechar}>
            Cancelar
          </Button>
          <Button
            size="sm"
            className="h-7 text-xs"
            disabled={passouDoTeto}
            onClick={() => aplicar(draft)}
          >
            Aplicar
          </Button>
        </div>
      </div>
      {/*
          ⚠️ O teto AVISA e trava o Aplicar em vez de encurtar o período sozinho:
          recortar em silêncio mostraria na tela um intervalo diferente do que a
          pessoa acabou de selecionar no calendário.
        */}
      {passouDoTeto && (
        <p className="mt-2 text-[11px] text-amber-600">
          O período não pode passar de {maxDias} dias — escolha um intervalo menor.
        </p>
      )}
    </>
  );
}
