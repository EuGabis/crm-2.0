"use client";

import { useEffect, useRef, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { OpportunityCard } from "./opportunity-card";
import { formatBRL, stageTotal } from "@/lib/data/repos/opportunities";
import type { Opportunity, Stage, User } from "@/lib/data/types";
import { cn } from "@/lib/utils";

/**
 * Quantos cards a coluna monta de cada vez.
 *
 * 🔴 A coluna montava a fase INTEIRA. Medido em produção: "NOVO LEAD" do funil
 * Controle de Leads tem **1.518 cards** (3.206 no funil). Ninguém rola 1.518
 * cards — mas o navegador pagava por todos eles, e o dnd-kit os re-renderizava
 * a cada pixel de arrasto. Era essa a lentidão relatada ao mover um card.
 *
 * Não é paginação com botão: o sentinela abaixo carrega mais assim que o fim da
 * lista se aproxima, então rolar continua parecendo uma lista inteira. A
 * contagem do cabeçalho sempre mostra o TOTAL da fase — o que está montado é
 * detalhe de desenho, e um número menor ali faria a coluna mentir.
 */
const PAGINA = 30;

export function StageColumn({
  stage,
  opportunities,
  users,
  selected,
  onToggleSelect,
  onToggleStage,
}: {
  stage: Stage;
  opportunities: Opportunity[];
  users: User[];
  selected?: Set<string>;
  onToggleSelect?: (id: string) => void;
  /** Marca/desmarca todos os cards da fase de uma vez. */
  onToggleStage?: (ids: string[], select: boolean) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const ids = opportunities.map((o) => o.id);
  const allSelected = ids.length > 0 && ids.every((id) => selected?.has(id));

  const [limite, setLimite] = useState(PAGINA);
  const fimRef = useRef<HTMLDivElement>(null);
  const visiveis = opportunities.slice(0, limite);
  const restam = opportunities.length - visiveis.length;
  /*
   * ⚠️ O limite NÃO é zerado quando a lista muda (busca, filtro, card movido).
   * Zerar devolveria a rolagem de quem já está lá embaixo para o começo a cada
   * card arrastado — e o `slice` já corta sozinho quando a lista encolhe.
   * Trocar de fase remonta a coluna (a `key` é o id da fase), então ali o
   * limite volta ao início de graça.
   */
  useEffect(() => {
    const el = fimRef.current;
    if (!el || restam <= 0) return;
    // `rootMargin` generoso: carrega ANTES de o fim aparecer, senão a rolagem
    // bate num fundo vazio e só então cresce.
    const obs = new IntersectionObserver(
      (entradas) => entradas[0]?.isIntersecting && setLimite((n) => n + PAGINA),
      { rootMargin: "400px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [restam]);

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="flex h-full w-10 shrink-0 flex-col items-center gap-2 rounded-lg border bg-white py-3"
        style={{ borderTopColor: stage.color, borderTopWidth: 3 }}
      >
        <ChevronRight className="size-3.5 text-slate-400" />
        <span
          className="text-[10px] font-bold text-slate-600"
          style={{ writingMode: "vertical-rl" }}
        >
          {stage.name} · {opportunities.length}
        </span>
      </button>
    );
  }

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex h-full w-[240px] shrink-0 flex-col rounded-lg border bg-slate-100/70",
        isOver && "ring-2 ring-indigo-400"
      )}
      style={{ borderTopColor: stage.color, borderTopWidth: 3 }}
    >
      <div className="flex items-center justify-between gap-1.5 px-2.5 py-2">
        {onToggleStage && ids.length > 0 && (
          <Checkbox
            checked={allSelected}
            onCheckedChange={(v) => onToggleStage(ids, !!v)}
            aria-label={`Selecionar os ${ids.length} leads de ${stage.name}`}
            title="Selecionar todos desta fase"
            className="size-3.5 shrink-0"
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-bold text-slate-700">{stage.name}</p>
          <p className="text-[10px] text-slate-500">
            {opportunities.length} · {formatBRL(stageTotal(opportunities))}
          </p>
        </div>
        <button
          onClick={() => setCollapsed(true)}
          className="text-slate-400 hover:text-slate-600"
        >
          <ChevronLeft className="size-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pb-2 [scrollbar-width:thin]">
        {visiveis.map((o) => (
          <OpportunityCard
            key={o.id}
            opportunity={o}
            owner={users.find((u) => u.id === o.ownerId)}
            selected={selected?.has(o.id)}
            onToggleSelect={onToggleSelect}
          />
        ))}
        {restam > 0 && (
          <div ref={fimRef} className="py-3 text-center text-[10px] text-slate-400">
            carregando mais {Math.min(restam, PAGINA)} de {restam}…
          </div>
        )}
        {opportunities.length === 0 && (
          <p className="py-6 text-center text-[10px] text-slate-400">Solte um card aqui</p>
        )}
      </div>
    </div>
  );
}
