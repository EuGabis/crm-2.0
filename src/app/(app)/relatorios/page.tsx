"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { SubNav } from "@/components/layout/subnav";
import { GoogleAdsReport } from "@/components/reports/google-ads-report";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/data/repos/opportunities";
import { usePipelineDb } from "@/lib/data/repos/db/pipeline";
import { useMyMembership } from "@/lib/data/repos/db/team";

const EXAMPLES = [
  "Qual o tempo médio de resposta de cada atendente?",
  "Quem tem mais leads ganhos no período?",
  "Quantas conversas estão aguardando distribuição?",
  "Compare o desempenho da equipe de vendas.",
];

/** Aba "Análise IA": admin pergunta em linguagem natural e a IA responde sobre os
 *  dados reais do sistema (rota /api/relatorios/analise). */
function AnaliseIA() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const ask = async (q?: string) => {
    const pergunta = (q ?? question).trim();
    if (!pergunta) {
      toast.error("Escreva uma pergunta");
      return;
    }
    setQuestion(pergunta);
    setLoading(true);
    setAnswer(null);
    try {
      const res = await fetch("/api/relatorios/analise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: pergunta }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json?.error ?? "Não foi possível analisar");
        return;
      }
      setAnswer(json.answer ?? "");
    } catch {
      toast.error("Falha de conexão");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-1 flex items-center gap-2">
        <Sparkles className="size-4 text-indigo-600" />
        <h1 className="text-lg font-bold text-slate-900">Análise com IA</h1>
      </div>
      <p className="mb-4 text-xs text-slate-500">
        Pergunte qualquer coisa sobre a operação — a IA analisa os dados reais do sistema
        (equipe, tempos de resposta, conversas e leads dos últimos 30 dias) e responde.
      </p>

      <div className="rounded-xl border bg-white p-3">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void ask();
          }}
          placeholder="Ex.: qual o tempo médio de resposta que o Alberto está tendo com os leads?"
          rows={3}
          className="w-full resize-none border-0 p-1 text-sm text-slate-800 outline-none placeholder:text-slate-400"
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[10px] text-slate-400">Ctrl/⌘ + Enter para enviar</span>
          <Button size="sm" className="h-8 gap-1.5 text-xs" disabled={loading} onClick={() => void ask()}>
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            {loading ? "Analisando..." : "Analisar"}
          </Button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            onClick={() => void ask(ex)}
            disabled={loading}
            className="rounded-full border bg-white px-2.5 py-1 text-[11px] text-slate-600 hover:border-indigo-300 hover:text-indigo-700 disabled:opacity-50"
          >
            {ex}
          </button>
        ))}
      </div>

      {loading && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border bg-white p-4 text-xs text-slate-500">
          <Loader2 className="size-4 animate-spin" /> Analisando os dados do sistema...
        </div>
      )}
      {answer && !loading && (
        <div className="mt-4 rounded-xl border bg-white p-4">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-indigo-500">Resposta</p>
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{answer}</div>
        </div>
      )}
    </div>
  );
}

interface AgenteRow {
  userId: string;
  nome: string;
  conversas_atribuidas: number;
  tempo_medio_resposta: string;
  templates_enviados_30d: number;
  ganhos: number;
  perdidos: number;
  receita_ganha: number;
}

/** Desempenho por agente com dados REAIS (rota /api/relatorios/agentes). */
function AgentesReport() {
  const [rows, setRows] = useState<AgenteRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const res = await fetch("/api/relatorios/agentes");
        const json = await res.json().catch(() => ({}));
        if (!active) return;
        if (!res.ok) {
          setError(json?.error ?? "Não foi possível carregar");
          return;
        }
        setRows(json.agentes ?? []);
      } catch {
        if (active) setError("Falha de conexão");
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return (
    <>
      <h1 className="mb-1 text-lg font-bold text-slate-900">Desempenho por agente</h1>
      <p className="mb-4 text-xs text-slate-500">
        Dados reais dos últimos 30 dias — conversas, tempo de resposta e resultados.
      </p>
      {error && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-700">
          {error}
        </div>
      )}
      {!rows && !error && (
        <div className="flex items-center gap-2 rounded-xl border bg-white p-4 text-xs text-slate-500">
          <Loader2 className="size-4 animate-spin" /> Carregando...
        </div>
      )}
      {rows && (
        <div className="overflow-x-auto rounded-xl border bg-white">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b text-[11px] text-slate-400">
                {["Atendente", "Conversas", "Tempo médio de resposta", "Templates (30d)", "Ganhos", "Perdidos", "Receita ganha"].map((h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-2.5 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.userId} className="border-b last:border-0">
                  <td className="px-4 py-2.5 font-medium text-slate-800">{a.nome}</td>
                  <td className="px-4 py-2.5">{a.conversas_atribuidas}</td>
                  <td className="px-4 py-2.5">{a.tempo_medio_resposta}</td>
                  <td className="px-4 py-2.5">{a.templates_enviados_30d}</td>
                  <td className="px-4 py-2.5 text-emerald-600">{a.ganhos}</td>
                  <td className="px-4 py-2.5 text-slate-500">{a.perdidos}</td>
                  <td className="px-4 py-2.5">{formatBRL(a.receita_ganha)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
                    Sem dados de equipe ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/** Atribuição por fonte — sobre as oportunidades REAIS do funil. */
function AtribuicaoReport() {
  const { opportunities } = usePipelineDb();
  const attribution = useMemo(() => {
    const bySource = new Map<string, { leads: number; revenue: number; won: number }>();
    for (const o of opportunities) {
      const cur = bySource.get(o.source) ?? { leads: 0, revenue: 0, won: 0 };
      cur.leads += 1;
      if (o.status === "won") {
        cur.won += 1;
        cur.revenue += o.value;
      }
      bySource.set(o.source, cur);
    }
    const totalRevenue = [...bySource.values()].reduce((s, v) => s + v.revenue, 0) || 1;
    return [...bySource.entries()]
      .map(([source, v]) => ({ source, ...v, totalRevenue }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [opportunities]);

  return (
    <>
      <h1 className="mb-1 text-lg font-bold text-slate-900">Relatório de atribuição</h1>
      <p className="mb-4 text-xs text-slate-500">
        De onde vêm seus leads e qual fonte gera mais receita (dados reais do CRM)
      </p>
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b text-[11px] text-slate-400">
              {["Fonte", "Leads", "Ganhas", "Receita", "% da receita"].map((h) => (
                <th key={h} className="px-4 py-2.5 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {attribution.map((a) => (
              <tr key={a.source} className="border-b last:border-0">
                <td className="px-4 py-2.5 font-medium text-slate-800">{a.source}</td>
                <td className="px-4 py-2.5">{a.leads}</td>
                <td className="px-4 py-2.5 text-emerald-600">{a.won}</td>
                <td className="px-4 py-2.5">{formatBRL(a.revenue)}</td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-24 rounded-full bg-slate-100">
                      <div
                        className="h-2 rounded-full bg-indigo-500"
                        style={{ width: `${Math.round((a.revenue / a.totalRevenue) * 100)}%` }}
                      />
                    </div>
                    {Math.round((a.revenue / a.totalRevenue) * 100)}%
                  </div>
                </td>
              </tr>
            ))}
            {attribution.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                  Nenhuma oportunidade ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function RelatoriosPage() {
  const { isAdmin } = useMyMembership();
  // Só abas com dados REAIS. Análise IA e Agentes são de gestão (admin).
  const tabs = isAdmin
    ? [{ label: "Análise IA" }, { label: "Agentes" }, { label: "Atribuição" }, { label: "Google Ads" }]
    : [{ label: "Atribuição" }, { label: "Google Ads" }];
  const [tab, setTab] = useState(isAdmin ? "Análise IA" : "Atribuição");
  const activeTab = tabs.some((t) => t.label === tab) ? tab : tabs[0].label;

  return (
    <div>
      <SubNav tabs={tabs} active={activeTab} onChange={setTab} />
      <div className="p-6">
        {activeTab === "Análise IA" && isAdmin && <AnaliseIA />}
        {activeTab === "Agentes" && isAdmin && <AgentesReport />}
        {activeTab === "Atribuição" && <AtribuicaoReport />}
        {activeTab === "Google Ads" && <GoogleAdsReport />}
      </div>
    </div>
  );
}
