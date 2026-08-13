"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Bot, Sparkles, Workflow, Zap } from "lucide-react";
import { toast } from "sonner";
import { KpiCard } from "@/components/shared/kpi-card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { brand } from "@/lib/config/brand";
import { aiActions, useAiLogs, useAiUsage } from "@/lib/data/repos/db/ai";

const SHORTCUTS = [
  {
    title: "Agentes de IA",
    description: "Configure bots de conversa, IA de voz e a base de conhecimento.",
    href: "/agentes-ia",
    icon: Bot,
  },
  {
    title: "Automações com IA",
    description: "Adicione etapas de IA aos seus fluxos: classificar, responder e atualizar campos.",
    href: "/automacoes",
    icon: Zap,
  },
  {
    title: "Workflows AI",
    description: "Monte jornadas completas que combinam gatilhos, ações e decisões de IA.",
    href: "/automacoes",
    icon: Workflow,
  },
];

export default function AiStudioPage() {
  const [prompt, setPrompt] = useState("");
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const usage = useAiUsage();
  const { logs } = useAiLogs(8);

  const generate = async () => {
    if (!prompt.trim()) {
      toast.error("Escreva o que você quer gerar");
      return;
    }
    setLoading(true);
    setAnswer("");
    const res = await aiActions.generate({ prompt: prompt.trim(), feature: "playground" });
    setLoading(false);
    if (res.ok) setAnswer(res.text ?? "");
    else toast.error(res.error ?? "Não foi possível gerar");
  };

  return (
    <div className="p-6">
      <h1 className="mb-1 text-lg font-bold text-slate-900">AI Studio</h1>
      <p className="mb-4 text-xs text-slate-500">
        Central de inteligência artificial do {brand.name}: acompanhe resultados e acesse as
        ferramentas de IA.
      </p>

      <div className="mb-5 grid gap-3 md:grid-cols-3">
        <KpiCard
          label="Gerações no mês"
          value={usage.ready ? usage.callsThisMonth.toLocaleString("pt-BR") : "—"}
        />
        <KpiCard
          label="Tokens no mês"
          value={usage.ready ? usage.tokensThisMonth.toLocaleString("pt-BR") : "—"}
        />
        <KpiCard label="Modelo" value="OpenAI" hint="Configurável em OPENAI_MODEL" />
      </div>

      <div className="mb-5 grid gap-3 md:grid-cols-3">
        {SHORTCUTS.map((s) => (
          <Link
            key={s.title}
            href={s.href}
            className="group flex flex-col rounded-xl border bg-white p-4 transition-colors hover:border-indigo-300"
          >
            <span className="mb-2 flex size-9 items-center justify-center rounded-lg bg-indigo-50 text-indigo-500">
              <s.icon className="size-4" />
            </span>
            <p className="text-sm font-semibold text-slate-800">{s.title}</p>
            <p className="mt-1 flex-1 text-xs text-slate-500">{s.description}</p>
            <span className="mt-3 flex items-center gap-1 text-xs font-medium text-indigo-600 group-hover:gap-1.5">
              Acessar <ArrowRight className="size-3.5 transition-all" />
            </span>
          </Link>
        ))}
      </div>

      <div className="max-w-2xl rounded-xl border bg-white p-5">
        <div className="mb-3 flex items-center gap-2">
          <span className="flex size-9 items-center justify-center rounded-lg bg-indigo-50 text-indigo-500">
            <Sparkles className="size-4" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-slate-700">Construa usando IA</h2>
            <p className="text-[11px] text-slate-400">
              Descreva o que você quer automatizar e a IA monta o primeiro rascunho.
            </p>
          </div>
        </div>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Descreva sua ideia</Label>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Ex.: escreva um e-mail curto convidando leads para uma aula experimental de aviação"
              className="min-h-20 text-xs"
            />
          </div>
          <Button size="sm" className="h-8 text-xs" onClick={generate} disabled={loading}>
            <Sparkles className="size-3.5" /> {loading ? "Gerando..." : "Gerar"}
          </Button>
          {answer && (
            <div className="mt-3 whitespace-pre-wrap rounded-lg border bg-slate-50 p-3 text-xs text-slate-700">
              {answer}
            </div>
          )}
        </div>
      </div>

      {logs.length > 0 && (
        <div className="mt-5 max-w-2xl">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Últimas gerações</h2>
          <div className="divide-y rounded-xl border bg-white">
            {logs.map((l) => (
              <div key={l.id} className="px-4 py-2 text-xs">
                <p className="truncate font-medium text-slate-700">{l.prompt}</p>
                <p className="text-[10px] text-slate-400">
                  {l.feature} · {l.model} · {l.promptTokens + l.completionTokens} tokens
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
