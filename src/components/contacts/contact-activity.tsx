"use client";

import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  CalendarClock,
  CheckSquare,
  MessageSquare,
  Sparkles,
  Target,
  UserPlus,
} from "lucide-react";
import { useContactActivity, type TipoAtividade } from "@/lib/data/repos/db/contact-activity";

const ICONE: Record<TipoAtividade, typeof Target> = {
  contato_criado: UserPlus,
  conversa_evento: MessageSquare,
  card_criado: Target,
  triagem: Sparkles,
  tarefa: CheckSquare,
  compromisso: CalendarClock,
};

const COR: Record<TipoAtividade, string> = {
  contato_criado: "text-slate-400",
  conversa_evento: "text-indigo-500",
  card_criado: "text-emerald-600",
  triagem: "text-amber-600",
  tarefa: "text-slate-500",
  compromisso: "text-sky-600",
};

/**
 * A linha do tempo do contato — o que aconteceu com ele, em ordem.
 *
 * Pedido do Gabriel (2026-09-16): *"uma janela de visualização das conversas e
 * também de atividades, como quando foi criado um card, para quem foi
 * associado, etc."*
 *
 * ⚠️ **"Para quem foi associado" vem dos EVENTOS DA CONVERSA**, escritos pelo
 * gatilho da 202608281530 — é por isso que esta tela consegue responder isso: o
 * texto ("Atribuída a X · pelo sistema · rodízio do bot") já nasce pronto no
 * banco e é exibido como está. Reescrevê-lo aqui criaria uma segunda redação da
 * mesma coisa, para divergir na primeira mudança.
 */
export function ContactActivity({ contactId }: { contactId: string }) {
  const { itens, loading, erro } = useContactActivity(contactId);

  if (loading) return <p className="py-6 text-center text-xs text-slate-400">Carregando…</p>;
  if (erro)
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        Não foi possível carregar a atividade: {erro}
      </div>
    );

  return (
    <div className="space-y-3">
      {itens.length === 0 ? (
        <p className="py-6 text-center text-xs text-slate-400">
          Nenhuma atividade registrada para este contato.
        </p>
      ) : (
        <ol className="relative space-y-0 border-l pl-4">
          {itens.map((a) => {
            const Icone = ICONE[a.tipo];
            return (
              <li key={a.id} className="relative py-2">
                <span className="absolute -left-[22px] top-2.5 flex size-4 items-center justify-center rounded-full border bg-white">
                  <Icone className={`size-2.5 ${COR[a.tipo]}`} />
                </span>
                <p className="text-xs leading-snug text-slate-700">{a.texto}</p>
                <p className="mt-0.5 text-[10px] text-slate-400">
                  {format(new Date(a.at), "dd/MM/yy 'às' HH:mm", { locale: ptBR })}
                  {a.detalhe && ` · ${a.detalhe}`}
                </p>
              </li>
            );
          })}
        </ol>
      )}

      {/*
        🔴 **A tela DIZ o que ela não sabe.** Mudança de fase e troca de dono do
        card não são gravadas em lugar nenhum do schema — só o estado atual. Uma
        linha do tempo que omitisse isso em silêncio levaria quem lê a concluir
        que o card nunca se moveu, que é uma conclusão errada tirada de uma tela
        que parece completa.
      */}
      <p className="border-t pt-2 text-[10px] leading-relaxed text-slate-400">
        Mostra o que o CRM registra: conversas e suas atribuições, cards criados,
        triagem do bot, tarefas e compromissos.{" "}
        <strong className="font-medium">Mudança de fase do card e troca de dono do card não
        ficam registradas</strong> — o funil guarda só o estado atual.
      </p>
    </div>
  );
}
