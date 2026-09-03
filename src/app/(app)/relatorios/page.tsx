"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Download, Loader2, MessageSquare, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { SubNav } from "@/components/layout/subnav";
import { TOOLTIP_STYLE } from "@/components/dashboard/opportunity-widgets";
import { GoogleAdsReport } from "@/components/reports/google-ads-report";
import { ServiceSlaReport } from "@/components/reports/service-sla-report";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatBRL } from "@/lib/data/repos/opportunities";
import { usePipelineDb } from "@/lib/data/repos/db/pipeline";
import { useMyMembership } from "@/lib/data/repos/db/team";
import { useAiAnalyses } from "@/lib/data/repos/db/ai";
import { cn } from "@/lib/utils";
import { useIsSupervisor } from "@/lib/data/repos/db/sector";
import { SectorReport } from "@/components/relatorios/sector-report";

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
  // Qual análise está aberta: `null` = a que acabou de ser feita. Guardar o id
  // (e não só o texto) é o que permite destacar a linha correspondente na lista.
  const [abertaId, setAbertaId] = useState<string | null>(null);
  const { analises, recarregar } = useAiAnalyses();

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
      setAbertaId(json.id ?? null);
      // A rota é quem grava o registro, então o client não fica sabendo do
      // insert: sem isto a análise que acabou de sair só apareceria na lista
      // depois de um F5.
      recarregar();
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

      {/* Histórico. A análise responde sobre um retrato dos dados que muda a cada
          consulta, então reler o que foi perguntado (e o que a IA respondeu na
          época) é a única forma de comparar dois momentos — antes isso se perdia
          ao trocar de pergunta. */}
      {analises.length > 0 && (
        <div className="mt-6">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Suas análises anteriores
          </p>
          <div className="divide-y overflow-hidden rounded-xl border bg-white">
            {analises.map((a) => {
              const aberta = abertaId === a.id;
              return (
                <button
                  key={a.id}
                  onClick={() => {
                    // Reabrir a mesma linha fecha, para a lista voltar a caber
                    // na tela sem precisar rolar até o fim da resposta.
                    if (aberta) {
                      setAbertaId(null);
                      setAnswer(null);
                      return;
                    }
                    setAbertaId(a.id);
                    setQuestion(a.prompt);
                    setAnswer(a.response);
                  }}
                  className={cn(
                    "flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-slate-50",
                    aberta && "bg-indigo-50/60"
                  )}
                >
                  <MessageSquare
                    className={cn(
                      "mt-0.5 size-3.5 shrink-0",
                      aberta ? "text-indigo-600" : "text-slate-300"
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-slate-700">
                      {a.prompt}
                    </span>
                    <span className="block truncate text-[10px] text-slate-400">
                      {format(new Date(a.createdAt), "d 'de' MMM, HH:mm", { locale: ptBR })}
                      {" · "}
                      {a.response.slice(0, 70)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

interface AgenteRow {
  userId: string;
  nome: string;
  conversas_atribuidas: number;
  /**
   * MEDIANA da espera útil até a primeira resposta HUMANA, já formatada.
   *
   * ⚠️ Trocou de `tempo_medio_resposta` para `resposta_tipica` de propósito: o
   * campo antigo era média de tempo CORRIDO, descartava tudo acima de 24h e não
   * contava quem nunca foi respondido — o AGENTS.md chama isso de "ficção em
   * quatro camadas". Manter o nome antigo com o cálculo novo faria o próximo
   * leitor achar que é média.
   */
  resposta_tipica: string;
  respostas_medidas: number;
  /** Conversas dele em que o cliente NUNCA recebeu resposta humana. */
  nao_respondidas: number;
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
        Conversas, resposta e templates dos últimos 30 dias. ⚠️ Ganhos, perdidos e receita são
        o ACUMULADO do atendente — recortar em 30 dias mostraria zero para quem fechou no mês
        passado.
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
                {[
                  "Atendente",
                  "Conversas",
                  // ⚠️ "Resposta típica" e não "Tempo médio": agora é MEDIANA de
                  // minutos ÚTEIS. Neste banco a média era 675 min contra
                  // mediana de 14 — o rótulo errado faria a coluna mentir.
                  "Resposta típica",
                  "Sem resposta",
                  "Templates (30d)",
                  "Ganhos",
                  "Perdidos",
                  "Receita ganha",
                ].map((h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-2.5 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.userId} className="border-b last:border-0">
                  <td className="px-4 py-2.5 font-medium text-slate-800">{a.nome}</td>
                  <td className="px-4 py-2.5">{a.conversas_atribuidas}</td>
                  <td className="px-4 py-2.5" title={`Mediana de ${a.respostas_medidas} respostas, em minutos de expediente`}>
                    {a.resposta_tipica}
                  </td>
                  {/*
                    ⚠️ Conversa sem NENHUMA resposta humana fica em vermelho
                    quando existe. Sem esta coluna, a mediana premia quem abandona
                    o atendimento: quem nunca respondeu não entra no cálculo, e o
                    pior caso fica invisível.
                  */}
                  <td className={cn("px-4 py-2.5", a.nao_respondidas > 0 && "font-semibold text-red-600")}>
                    {a.nao_respondidas}
                  </td>
                  <td className="px-4 py-2.5">{a.templates_enviados_30d}</td>
                  <td className="px-4 py-2.5 text-emerald-600">{a.ganhos}</td>
                  <td className="px-4 py-2.5 text-slate-500">{a.perdidos}</td>
                  <td className="px-4 py-2.5">{formatBRL(a.receita_ganha)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-slate-400">
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

/** Abas válidas para o `?tab=` da URL. */
interface LinhaDia {
  dia: string;
  entraram: number;
  qualificados: number;
  frios: number;
  semClassificacao: number;
  pontosMedio: number | null;
}

/**
 * Paleta dos três desfechos, **validada** com o verificador de daltonismo
 * (`dataviz/scripts/validate_palette.js`), não escolhida a olho.
 *
 * Passa as seis checagens no tema claro E no escuro (superfície `#16181f`):
 * faixa de luminosidade, piso de croma, separação em deuteranopia (ΔE 23,6),
 * piso de visão normal (ΔE 28,1) e contraste ≥ 3:1.
 *
 * ⚠️ **Tritan ΔE 6,6 cai na faixa 6–8**, que é legal SÓ com codificação
 * secundária. Daí três coisas aqui não serem enfeite: a **legenda com rótulo**,
 * o **vão de 2px entre as fatias** do empilhado e a **tabela** abaixo. Sem elas
 * a paleta reprovaria.
 *
 * ⚠️ E o primeiro candidato REPROVOU: `#94a3b8` (slate-400) para "frio" lê como
 * cinza (croma 0,035) e não se sustenta como série num empilhado. Azul é o
 * mapeamento semântico de "frio" e tem croma de verdade — medido, não achado.
 */
const CORES_DESFECHO = {
  qualificados: "#059669",
  frios: "#6366f1",
  semClassificacao: "#d97706",
} as const;

const SERIES = [
  { key: "qualificados" as const, rotulo: "Qualificados", cor: CORES_DESFECHO.qualificados },
  { key: "frios" as const, rotulo: "Frios", cor: CORES_DESFECHO.frios },
  {
    key: "semClassificacao" as const,
    rotulo: "Não concluíram",
    cor: CORES_DESFECHO.semClassificacao,
  },
];

/**
 * Leads que entraram por dia, e quantos o bot qualificou.
 *
 * A régua é a do fluxo **Triagem Comercial**: o nó `score` soma os pesos de
 * `objetivo` e `conhece_lito` e, com **soma ≥ 9**, o lead é `quente`.
 *
 * ⚠️ **Três desfechos e não dois.** "Entraram" menos "qualificados" NÃO é
 * "desqualificados": quem abandona a triagem antes das duas perguntas não recebe
 * nota nenhuma. Somar esses com os frios inventaria reprovação onde houve
 * desistência — e as condutas são opostas (frio recebe conteúdo; quem desistiu
 * precisa ser retomado).
 */
function LeadsDoDiaReport() {
  const [dias, setDias] = useState(30);
  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Leads do dia</h1>
          <p className="text-xs text-slate-500">
            Entrada e qualificação pela Triagem Comercial — o lead é{" "}
            <b>qualificado quando a soma das respostas chega a 9</b>.
          </p>
        </div>
        <Select value={String(dias)} onValueChange={(v) => v && setDias(Number(v))}>
          <SelectTrigger className="h-8 w-[150px] text-xs">
            <SelectValue>{dias} dias</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {[7, 15, 30, 60, 90].map((d) => (
              <SelectItem key={d} value={String(d)} className="text-xs">
                {d} dias
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {/*
        ⚠️ Remontado por `key` ao trocar o período, e não limpando o estado
        dentro do efeito: `setState` síncrono no corpo de um `useEffect` causa
        renderização em cascata (o lint acusa). A `key` zera o estado de graça.
      */}
      <LeadsDoDiaPainel key={dias} dias={dias} />
    </>
  );
}

function LeadsDoDiaPainel({ dias }: { dias: number }) {
  const [dados, setDados] = useState<{ linhas: LinhaDia[]; total: LinhaDia } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [baixando, setBaixando] = useState(false);

  useEffect(() => {
    let ativo = true;
    void (async () => {
      try {
        // `flow=triagem` é a Triagem Comercial — é ela que tem nó de pontuação.
        const res = await fetch(`/api/relatorios/leads-diarios?dias=${dias}&flow=triagem`);
        const json = await res.json().catch(() => ({}));
        if (!ativo) return;
        if (!res.ok) {
          setErro(json?.error ?? "Não foi possível carregar");
          return;
        }
        setDados(json);
      } catch {
        if (ativo) setErro("Falha de conexão");
      }
    })();
    return () => {
      ativo = false;
    };
  }, [dias]);

  /*
   * O gráfico vai do mais ANTIGO para o mais recente; a tabela é o contrário, e
   * está certo: tabela se lê de cima, linha do tempo se lê da esquerda.
   */
  const serie = useMemo(
    () =>
      (dados?.linhas ?? [])
        .slice()
        .reverse()
        .map((l) => ({
          rotulo: format(new Date(`${l.dia}T12:00:00`), "dd/MM", { locale: ptBR }),
          qualificados: l.qualificados,
          frios: l.frios,
          semClassificacao: l.semClassificacao,
        })),
    [dados]
  );

  if (erro) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-700">
        {erro}
      </div>
    );
  }
  if (!dados) {
    return (
      <div className="rounded-xl border bg-white px-4 py-3 text-xs text-slate-400">
        Carregando...
      </div>
    );
  }

  const t = dados.total;
  const classificados = t.qualificados + t.frios;
  const taxa = classificados > 0 ? Math.round((t.qualificados / classificados) * 100) : null;

  const baixar = async () => {
    setBaixando(true);
    try {
      // Import dinâmico: o exceljs (~940 KB) só é baixado por quem clica.
      const { baixarRelatorioLeadsXlsx } = await import("@/lib/reports/leads-xlsx");
      await baixarRelatorioLeadsXlsx({ linhas: dados.linhas, total: t, dias, limiar: 9 });
    } catch {
      toast.error("Não foi possível gerar a planilha");
    } finally {
      setBaixando(false);
    }
  };

  return (
    <>
      {/* ---------- Faixa de números ---------- */}
      <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border bg-white p-4">
          <p className="text-[11px] font-medium text-slate-500">Entraram</p>
          <p className="text-2xl font-bold tabular-nums text-slate-900">{t.entraram}</p>
          <p className="text-[11px] text-slate-400">nos últimos {dias} dias</p>
        </div>
        {SERIES.map((s) => (
          <div key={s.key} className="rounded-xl border bg-white p-4">
            {/*
              ⚠️ O rótulo usa token de TEXTO, nunca a cor da série — a marca
              colorida ao lado é que carrega a identidade. Texto na cor da série
              perde contraste e some no dark.
            */}
            <p className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
              <span aria-hidden className="size-2 rounded-full" style={{ background: s.cor }} />
              {s.rotulo}
            </p>
            <p className="text-2xl font-bold tabular-nums text-slate-900">{t[s.key]}</p>
            <p className="text-[11px] text-slate-400">
              {t.entraram > 0
                ? `${Math.round((t[s.key] / t.entraram) * 100)}% de quem entrou`
                : "—"}
            </p>
          </div>
        ))}
      </div>

      {/* ---------- Taxa + download ---------- */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white px-4 py-3">
        {/*
          ⚠️ A taxa é sobre os CLASSIFICADOS, não sobre quem entrou. Dividir pelos
          que entraram faria a taxa cair sempre que mais gente desistisse — o que
          é problema de fluxo, não de qualidade do lead.
        */}
        <p className="text-xs text-slate-500">
          {taxa != null ? (
            <>
              <b className="text-base tabular-nums text-slate-900">{taxa}%</b> dos leads
              classificados foram qualificados ({t.qualificados} de {classificados}). Os{" "}
              {t.semClassificacao} que não concluíram a triagem ficam fora dessa conta.
            </>
          ) : (
            "Nenhum lead classificado no período."
          )}
        </p>
        <Button
          variant="outline"
          size="sm"
          className="h-8 shrink-0 gap-1.5 text-xs"
          onClick={() => void baixar()}
          disabled={baixando}
        >
          <Download className="size-3.5" />
          {baixando ? "Gerando..." : "Baixar planilha"}
        </Button>
      </div>

      {/* ---------- Gráfico ---------- */}
      <div className="mb-4 rounded-xl border bg-white p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-xs font-bold text-slate-700">Entrada e desfecho por dia</p>
          {/*
            Legenda SEMPRE presente com 3 séries — identidade nunca fica só na
            cor. É também a codificação secundária que a paleta exige (tritan
            ΔE 6,6 está na faixa 6–8).
          */}
          <div className="flex flex-wrap items-center gap-3">
            {SERIES.map((s) => (
              <span key={s.key} className="flex items-center gap-1.5 text-[11px] text-slate-500">
                <span aria-hidden className="size-2 rounded-sm" style={{ background: s.cor }} />
                {s.rotulo}
              </span>
            ))}
          </div>
        </div>
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={serie} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
              {/* Grade recessiva: só horizontal, para as verticais não
                  competirem com as barras. */}
              {/* ⚠️ Grade e eixos por TOKEN, não hex fixo: o dark mode do
                  projeto remapeia CLASSES em globals.css, e `stroke` de SVG é
                  atributo — um `#eef1f5` viraria linha clara brilhante no fundo
                  escuro. `--border` e `--muted-foreground` já existem nos dois
                  temas. */}
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis
                dataKey="rotulo"
                tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
                minTickGap={16}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
              />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              {SERIES.map((s, i) => (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  name={s.rotulo}
                  stackId="dia"
                  fill={s.cor}
                  /* ⚠️ Vão de 2px entre as fatias — exigência da especificação de
                     marcas, e aqui também a codificação secundária que sustenta a
                     paleta. Só a fatia do TOPO arredonda, para o empilhado não
                     parecer três barras soltas.

                     ⚠️ E o vão usa `var(--card)`, não `#ffffff`: no tema escuro
                     o card é `#16181f`, e um traço branco viraria uma linha
                     acesa entre as fatias — o defeito clássico de cor definida
                     para um tema só. */
                  stroke="var(--card)"
                  strokeWidth={2}
                  radius={i === SERIES.length - 1 ? [4, 4, 0, 0] : 0}
                  maxBarSize={38}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ---------- Tabela: é a "table view" da checagem de acessibilidade ---------- */}
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b bg-slate-50 text-left text-slate-500">
              {["Dia", "Entraram", "Qualificados", "Frios", "Não concluíram", "Pontos (média)"].map(
                (h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-2.5 font-medium">
                    {h}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {dados.linhas.map((l) => (
              <tr key={l.dia} className="border-b last:border-0">
                <td className="whitespace-nowrap px-4 py-2.5 font-medium text-slate-800">
                  {format(new Date(`${l.dia}T12:00:00`), "EEE, dd/MM", { locale: ptBR })}
                </td>
                <td className="px-4 py-2.5 tabular-nums">{l.entraram}</td>
                <td className="px-4 py-2.5 font-semibold tabular-nums text-emerald-600">
                  {l.qualificados}
                </td>
                <td className="px-4 py-2.5 tabular-nums text-indigo-600">{l.frios}</td>
                <td
                  className={cn(
                    "px-4 py-2.5 tabular-nums",
                    l.semClassificacao > 0 && "text-amber-600"
                  )}
                >
                  {l.semClassificacao}
                </td>
                {/* A média de pontos é o que permite mexer no limiar com dado na
                    mão: frios com média 8 pedem outra conversa que frios com
                    média 2. */}
                <td className="px-4 py-2.5 tabular-nums text-slate-400">{l.pontosMedio ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {t.entraram === 0 && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <b>Nenhum lead no período.</b> A Triagem Comercial ainda não está vinculada a nenhum
          número — em <span className="font-mono">/whatsapp</span>, o canal precisa ter esse bot
          para os leads passarem por ela. O relatório enche sozinho a partir do primeiro
          atendimento.
        </div>
      )}
    </>
  );
}

const TODAS_AS_ABAS = [
  "Análise IA",
  "Leads do dia",
  "Atendimento",
  "Conversas do setor",
  "Agentes",
  "Atribuição",
  "Google Ads",
];

/**
 * `useSearchParams` obriga um limite de Suspense — sem ele o build falha ao
 * pré-renderizar /relatorios (mesmo padrão de /leads e /pagamentos).
 */
export default function RelatoriosPage() {
  return (
    <Suspense fallback={null}>
      <RelatoriosPageInner />
    </Suspense>
  );
}

function RelatoriosPageInner() {
  const { isAdmin } = useMyMembership();
  // ?tab=Atendimento vem do widget do painel. A aba só é aceita se existir de
  // verdade — URL torta não pode deixar a página em branco.
  const searchParams = useSearchParams();
  const urlTab = searchParams.get("tab");
  // Só abas com dados REAIS. Análise IA e Agentes são de gestão (admin).
  // Atendimento fica com TODO MUNDO que enxerga Relatórios: quem chega aqui já
  // passou pela permissão do módulo, e a rota confere de novo no servidor.
  const isSupervisor = useIsSupervisor();
  const tabs = isAdmin
    ? [
        { label: "Análise IA" },
        { label: "Leads do dia" },
        { label: "Atendimento" },
        { label: "Conversas do setor" },
        { label: "Agentes" },
        { label: "Atribuição" },
        { label: "Google Ads" },
      ]
    : [
        // Vale a permissão do módulo `relatorios`, como Atendimento — a rota
        // confere de novo no servidor, que é o que decide.
        { label: "Leads do dia" },
        { label: "Atendimento" },
        ...(isSupervisor ? [{ label: "Conversas do setor" }] : []),
        { label: "Atribuição" },
        { label: "Google Ads" },
      ];
  const [tab, setTab] = useState(() => {
    if (urlTab && TODAS_AS_ABAS.includes(urlTab)) return urlTab;
    return isAdmin ? "Análise IA" : "Atendimento";
  });
  const activeTab = tabs.some((t) => t.label === tab) ? tab : tabs[0].label;

  return (
    <div>
      <SubNav tabs={tabs} active={activeTab} onChange={setTab} />
      <div className="p-6">
        {activeTab === "Análise IA" && isAdmin && <AnaliseIA />}
        {activeTab === "Atendimento" && <ServiceSlaReport />}
        {activeTab === "Leads do dia" && <LeadsDoDiaReport />}
        {activeTab === "Conversas do setor" && isSupervisor && <SectorReport />}
        {activeTab === "Agentes" && isAdmin && <AgentesReport />}
        {activeTab === "Atribuição" && <AtribuicaoReport />}
        {activeTab === "Google Ads" && <GoogleAdsReport />}
      </div>
    </div>
  );
}
