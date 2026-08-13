"use client";

import { useState } from "react";
import { FileText, Mic } from "lucide-react";
import { SubNav } from "@/components/layout/subnav";
import { ConversationAiTab } from "@/components/ai/conversation-ai-tab";
import { ContentAiTab } from "@/components/ai/content-ai-tab";
import { AgentTemplatesTab } from "@/components/ai/agent-templates-tab";
import { AiLogsTab } from "@/components/ai/ai-logs-tab";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { brand } from "@/lib/config/brand";

const TABS = [
  { label: "Conversation AI" },
  { label: "Começando" },
  { label: "IA de voz" },
  { label: "Base de Conhecimento" },
  { label: "Modelos de agente" },
  { label: "Content AI" },
  { label: "Logs" },
];

const COMPARISON = [
  { metric: "Chamadas perdidas", human: "62%", ai: "<3%" },
  { metric: "Chats sem resposta", human: "78%", ai: "0%" },
  { metric: "Disponibilidade", human: "8h/dia", ai: "24x7" },
  { metric: "Tempo de resposta", human: "~34min", ai: "<1s" },
  { metric: "Conversão de leads", human: "23%", ai: "48%" },
];

export default function AgentesIaPage() {
  const [tab, setTab] = useState("Conversation AI");

  return (
    <div>
      <SubNav tabs={TABS} active={tab} onChange={setTab} />
      <div className="p-6">
        {tab === "Conversation AI" && <ConversationAiTab />}

        {tab === "Começando" && (
          <div className="mx-auto max-w-3xl">
            <div className="mb-6 text-center">
              <Badge className="mb-3 bg-indigo-100 text-indigo-700">Agentes de IA do {brand.shortName}</Badge>
              <h1 className="text-lg font-bold text-slate-900">Sua IA de atendimento 24/7</h1>
              <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">
                Compare o desempenho de um time humano com um agente de IA do {brand.name} e
                comece a atender cada lead em segundos.
              </p>
            </div>
            <div className="rounded-xl border bg-white">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b text-[11px] text-slate-400">
                    <th className="px-4 py-2.5 font-medium">Métrica</th>
                    <th className="px-4 py-2.5 font-medium">Agente Humano</th>
                    <th className="px-4 py-2.5 font-medium">Agente de IA</th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON.map((row) => (
                    <tr key={row.metric} className="border-b last:border-0">
                      <td className="px-4 py-2.5 font-medium text-slate-800">{row.metric}</td>
                      <td className="px-4 py-2.5 text-slate-500">{row.human}</td>
                      <td className="px-4 py-2.5">
                        <Badge className="bg-emerald-100 text-emerald-700">{row.ai}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-5 text-center">
              <Button size="sm" className="h-8 text-xs" onClick={() => setTab("Conversation AI")}>
                Começar
              </Button>
            </div>
          </div>
        )}

        {tab === "IA de voz" && (
          <div className="mx-auto max-w-lg rounded-xl border border-dashed bg-white p-8 text-center">
            <span className="mx-auto mb-3 flex size-10 items-center justify-center rounded-lg bg-indigo-50 text-indigo-500">
              <Mic className="size-5" />
            </span>
            <h1 className="text-lg font-bold text-slate-900">IA de voz — em breve</h1>
            <p className="mx-auto mt-1 max-w-sm text-xs text-slate-500">
              Um agente que atende ligações por telefone e agenda compromissos por voz. Precisa de um
              provedor de voz conectado — chega numa próxima etapa.
            </p>
          </div>
        )}

        {tab === "Base de Conhecimento" && (
          <div className="mx-auto max-w-lg rounded-xl border border-dashed bg-white p-8 text-center">
            <span className="mx-auto mb-3 flex size-10 items-center justify-center rounded-lg bg-indigo-50 text-indigo-500">
              <FileText className="size-5" />
            </span>
            <h1 className="text-lg font-bold text-slate-900">Base de Conhecimento — em breve</h1>
            <p className="mx-auto mt-1 max-w-sm text-xs text-slate-500">
              Em breve você poderá subir PDFs e URLs para a IA responder com base nas informações da sua
              empresa (RAG). Estamos preparando essa etapa.
            </p>
          </div>
        )}

        {tab === "Modelos de agente" && <AgentTemplatesTab onUsed={() => setTab("Conversation AI")} />}

        {tab === "Content AI" && <ContentAiTab />}

        {tab === "Logs" && <AiLogsTab />}
      </div>
    </div>
  );
}
