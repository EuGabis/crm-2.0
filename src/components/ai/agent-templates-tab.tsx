"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { aiAgentActions } from "@/lib/data/repos/db/ai-agents";

interface Template {
  name: string;
  description: string;
  personality: string;
  goal: string;
}

const AGENT_TEMPLATES: Template[] = [
  {
    name: "SDR de qualificação",
    description:
      "Qualifica leads com perguntas de orçamento, prazo e necessidade antes de passar ao time comercial.",
    personality:
      "Você é um SDR simpático e objetivo do Lito CRM. Faz perguntas de qualificação de forma leve e consultiva, uma de cada vez, sem parecer interrogatório.",
    goal: "Descobrir orçamento, prazo e necessidade do lead e, quando qualificado, encaminhar ao time comercial.",
  },
  {
    name: "Suporte N1",
    description:
      "Responde dúvidas frequentes usando a Base de Conhecimento e transfere casos complexos para humanos.",
    personality:
      "Você é um atendente de suporte paciente e claro do Lito CRM. Explica em passos simples e confirma se resolveu.",
    goal: "Resolver dúvidas comuns rapidamente e transferir para um humano quando o caso for complexo.",
  },
  {
    name: "Recuperação de carrinho",
    description:
      "Aborda contatos que abandonaram o checkout com ofertas e responde objeções em tempo real.",
    personality:
      "Você é um vendedor persuasivo e cordial do Lito CRM. Aborda quem abandonou o checkout com empatia e senso de oportunidade.",
    goal: "Reengajar o contato, responder objeções e levá-lo a concluir a compra.",
  },
  {
    name: "Agendadora de reuniões",
    description:
      "Negocia horários e marca demonstrações direto no calendário conectado, sem intervenção humana.",
    personality:
      "Você é uma assistente de agendamento eficiente e educada do Lito CRM. Propõe horários de forma clara e confirma os detalhes.",
    goal: "Negociar um horário e marcar uma demonstração com o contato.",
  },
];

export function AgentTemplatesTab({ onUsed }: { onUsed: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);

  const use = async (t: Template) => {
    setBusy(t.name);
    const created = await aiAgentActions.create({ name: t.name });
    if (!created.ok || !created.id) {
      setBusy(null);
      return toast.error(created.error ?? "Não foi possível criar o agente");
    }
    const applied = await aiAgentActions.update(created.id, { personality: t.personality, goal: t.goal });
    setBusy(null);
    if (applied) toast.success("Agente criado a partir do modelo");
    else toast.warning("Agente criado, mas não foi possível aplicar o modelo — ajuste no Conversation AI");
    onUsed();
  };

  return (
    <>
      <h1 className="mb-1 text-lg font-bold text-slate-900">Modelos de agente</h1>
      <p className="mb-4 text-xs text-slate-500">
        Comece com um modelo pronto e personalize a personalidade e as metas depois.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {AGENT_TEMPLATES.map((t) => (
          <div key={t.name} className="flex flex-col rounded-xl border bg-white p-4">
            <span className="mb-2 flex size-9 items-center justify-center rounded-lg bg-indigo-50 text-indigo-500">
              <Sparkles className="size-4" />
            </span>
            <p className="text-sm font-semibold text-slate-800">{t.name}</p>
            <p className="mt-1 flex-1 text-xs text-slate-500">{t.description}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3 h-8 text-xs"
              onClick={() => use(t)}
              disabled={busy !== null}
            >
              {busy === t.name ? "Criando..." : "Usar modelo"}
            </Button>
          </div>
        ))}
      </div>
    </>
  );
}
