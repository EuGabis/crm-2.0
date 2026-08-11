"use client";

import { Bot, Eye, Plus, Search, User, Users } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const SAVED_VIEWS = ["ORGANIZAR", "LEADS LUCAS", "CALL DEMO", "QUENTE 🔥"];

function RailButton({
  icon: Icon,
  label,
  onClick,
  active,
}: {
  icon: typeof Search;
  label: string;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            onClick={onClick}
            className={`flex size-8 items-center justify-center rounded-md ${
              active ? "bg-indigo-100 text-indigo-600" : "text-slate-400 hover:bg-slate-100"
            }`}
          />
        }
      >
        <Icon className="size-4" />
      </TooltipTrigger>
      <TooltipContent side="right" className="text-[11px]">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

export function ViewsRail({ onNew }: { onNew?: () => void }) {
  return (
    <div className="flex h-full w-12 shrink-0 flex-col items-center gap-1 border-r bg-white py-2">
      <button
        onClick={onNew}
        title="Nova conversa"
        className="mb-1 flex size-8 items-center justify-center rounded-md bg-indigo-500 text-white hover:bg-indigo-600"
      >
        <Plus className="size-4" />
      </button>
      <RailButton icon={Search} label="Buscar conversa" onClick={() => toast.info("Busca global de conversas em breve")} />
      <RailButton icon={User} label="Atribuídas a mim" onClick={() => toast.info("Filtro por atendente em breve")} />
      <RailButton icon={Users} label="Caixa de entrada do grupo" active />
      <RailButton icon={Bot} label="Conversas com bot" onClick={() => toast.info("Filtro de conversas com IA em breve")} />
      <Popover>
        <PopoverTrigger
          render={
            <button className="flex size-8 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100" />
          }
        >
          <Eye className="size-4" />
        </PopoverTrigger>
        <PopoverContent side="right" align="start" className="w-56 p-2">
          <p className="mb-1 px-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">
            Visualizações
          </p>
          <div className="mb-2 flex items-center gap-1.5 rounded-md border px-2">
            <Search className="size-3 text-slate-400" />
            <Input
              placeholder="Pesquisar"
              className="h-6 border-0 p-0 text-xs shadow-none focus-visible:ring-0"
            />
          </div>
          <button
            onClick={() => toast.info("Criação de visualizações em breve")}
            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold text-indigo-600 hover:bg-indigo-50"
          >
            <Plus className="size-3" /> Criar visualização
          </button>
          {SAVED_VIEWS.map((v) => (
            <button
              key={v}
              onClick={() => toast.info(`Visualização "${v}" aplicada (simulado)`)}
              className="block w-full rounded-md px-2 py-1 text-left text-xs text-slate-700 hover:bg-slate-50"
            >
              {v}
            </button>
          ))}
        </PopoverContent>
      </Popover>
    </div>
  );
}
