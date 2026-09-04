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
  Cell,
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

interface LinhaDia {
  dia: string;
  entraram: number;
  concluiram: number;
  /** Mapa desfecho → quantidade. As chaves são as do FLUXO, não do CRM. */
  desfechos: Record<string, number>;
  pontosMedio: number | null;
}

interface TotalLeads {
  entraram: number;
  concluiram: number;
  desfechos: Record<string, number>;
}

/**
 * Paletas dos desfechos, **validadas** com o verificador de daltonismo
 * (`dataviz/scripts/validate_palette.js`) nos dois temas e em `--pairs all`,
 * não escolhidas a olho.
 *
 * - Comercial (2 séries): `#059669` × `#6366f1` — deuteranopia ΔE 23,6, visão
 *   normal ΔE 28,1.
 * - Secretaria (3 séries): `#0891b2` × `#6366f1` × `#d97706` — pior par
 *   deuteranopia ΔE 13,0, visão normal ΔE 17,0.
 *
 * ⚠️ **Tritan cai na faixa 6–8 nas duas**, que é legal SÓ com codificação
 * secundária. Daí três coisas aqui não serem enfeite: a **legenda com rótulo**,
 * o **vão de 2px entre as fatias** do empilhado e a **tabela** abaixo. Sem elas
 * as paletas reprovariam.
 *
 * ⚠️ **Duas tentativas REPROVARAM, e as duas por medida:**
 * 1. `#94a3b8` (slate-400) como série lê como cinza (croma 0,035) e não se
 *    sustenta num empilhado;
 * 2. rosa `#db2777` ao lado do verde `#059669` dá **ΔE 1,1 em deuteranopia** —
 *    indistinguíveis. Passava só enquanto não eram adjacentes no empilhado, e
 *    `--pairs all` derrubou: num gráfico de 3+ fatias o leitor compara
 *    QUALQUER par contra a legenda, não só os vizinhos.
 *
 * ⚠️ E 4 cores categóricas NÃO passam `--pairs all` — é o limite conhecido da
 * deuteranopia. É por isso que "não concluíram" é **neutro de tema**
 * (`var(--muted-foreground)`) e não uma quarta cor: ele não é uma categoria
 * irmã, é a AUSÊNCIA de desfecho. Neutro também é o que mantém o mesmo
 * significado nos dois fluxos.
 */
const VERDE = "#059669";
const INDIGO = "#6366f1";
const CIANO = "#0891b2";
const AMBAR = "#d97706";
/** "Não concluíram": por TOKEN, para o cinza acompanhar o tema (o dark do
 *  projeto remapeia CLASSES, e `fill` de SVG é atributo). */
const NEUTRO = "var(--muted-foreground)";
/** O mesmo cinza para a planilha, que não tem tema. */
const NEUTRO_XLSX = "#64748b";

interface SerieDesfecho {
  /** Chave em `desfechos` — o valor que o próprio fluxo grava. */
  chave: string;
  rotulo: string;
  cor: string;
}

interface Fluxo {
  /** `bot_flows.key` / `whatsapp_channels.bot_flow`. */
  key: string;
  aba: string;
  nome: string;
  /** A régua do bot, em uma frase, no subtítulo da tela. */
  regua: React.ReactNode;
  series: SerieDesfecho[];
  /** Só fluxo com nó de pontuação tem média de pontos para mostrar. */
  mostraPontos: boolean;
  /** Aviso de histórico parcial, quando o dado antigo veio de backfill. */
  historicoParcial?: string;
}

/**
 * ⚠️ **Os dois bots NÃO têm o mesmo tipo de desfecho, e é por isso que esta
 * tabela existe** (pedido do Gabriel: "dentro dos moldes do bot deles — a
 * secretaria não tem qualificado ou perdido").
 *
 * A Triagem Comercial classifica em quente/frio pelo nó `score`. A Triagem
 * Secretaria não classifica nada: o cliente escolhe um ASSUNTO e cada ramo vai
 * para um atendente. Forçar "qualificado/perdido" na secretaria inventaria uma
 * régua que o bot dela não tem — e alguém decidiria algo com base nela.
 *
 * ⚠️ Os rótulos são os TEXTOS QUE O CLIENTE VÊ na lista do WhatsApp. Se o fluxo
 * for reescrito e as opções mudarem, é aqui que se acerta — e o histórico
 * continua correto, porque `bot_desfechos.rotulo` guarda o texto da época.
 */
const FLUXOS: Fluxo[] = [
  {
    key: "triagem",
    aba: "Comercial",
    nome: "Triagem Comercial",
    regua: (
      <>
        o lead é <b>qualificado quando a soma das respostas chega a 9</b>
      </>
    ),
    series: [
      { chave: "quente", rotulo: "Qualificados", cor: VERDE },
      { chave: "frio", rotulo: "Frios", cor: INDIGO },
    ],
    mostraPontos: true,
  },
  {
    key: "triagem-secretaria",
    aba: "Secretaria",
    nome: "Triagem Secretaria",
    regua: (
      <>
        o cliente <b>escolhe o assunto</b> e cada ramo vai para um atendente — não há nota, nem
        qualificado, nem perdido
      </>
    ),
    series: [
      { chave: "docs", rotulo: "Documentos/Prova Sub", cor: CIANO },
      { chave: "imersao", rotulo: "Imersão Pres. MMA", cor: INDIGO },
      { chave: "outros", rotulo: "Outros", cor: AMBAR },
    ],
    mostraPontos: false,
    historicoParcial:
      "O histórico anterior a 03/09 foi recuperado das sessões do bot que ainda existiam — a sessão é apagada quando uma conversa finalizada reabre, então alguns dias antigos aparecem com menos desfechos do que realmente houve. A partir de hoje o registro é permanente.",
  },
];

/** Chave do desfecho neutro. Não vem do bot: é o que SOBRA. */
const NAO_CONCLUIU = "_naoConcluiu";

/**
 * Leads que entraram por dia, e o que o bot fez com eles.
 *
 * ⚠️ **Sempre um desfecho A MAIS que os do bot.** "Entraram" menos os
 * classificados NÃO é reprovação: quem abandona a triagem antes do nó de
 * decisão não recebe desfecho nenhum. Somar esses com os frios (ou com "Outros")
 * inventaria uma escolha que a pessoa não fez — e as condutas são opostas: frio
 * recebe conteúdo, quem desistiu precisa ser retomado.
 */
function LeadsDoDiaReport() {
  const [dias, setDias] = useState(30);
  const [fluxoKey, setFluxoKey] = useState(FLUXOS[0].key);
  const fluxo = FLUXOS.find((f) => f.key === fluxoKey) ?? FLUXOS[0];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Leads do dia</h1>
          <p className="text-xs text-slate-500">
            Entrada e desfecho pela {fluxo.nome} — {fluxo.regua}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/*
            Seletor de fluxo em botões e não num `Select`: são dois (três com o
            financeiro, um dia), a troca é comparativa e um menu esconderia que a
            outra visão existe — que é justamente o que o pedido apontou.
          */}
          <div className="flex rounded-lg border bg-white p-0.5">
            {FLUXOS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFluxoKey(f.key)}
                aria-pressed={f.key === fluxo.key}
                className={cn(
                  "h-7 rounded-md px-3 text-xs font-medium transition-colors",
                  f.key === fluxo.key
                    ? "bg-indigo-500 text-white"
                    : "text-slate-500 hover:bg-slate-50"
                )}
              >
                {f.aba}
              </button>
            ))}
          </div>
          <Select value={String(dias)} onValueChange={(v) => v && setDias(Number(v))}>
            <SelectTrigger className="h-8 w-[130px] text-xs">
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
      </div>
      {/*
        ⚠️ Remontado por `key` ao trocar período OU fluxo, e não limpando o
        estado dentro do efeito: `setState` síncrono no corpo de um `useEffect`
        causa renderização em cascata (o lint acusa). A `key` zera de graça — e
        sem ela a tela mostraria por um instante os números do fluxo anterior
        sob os rótulos do novo, que é pior que um "Carregando...".
      */}
      <LeadsDoDiaPainel key={`${fluxo.key}-${dias}`} dias={dias} fluxo={fluxo} />
    </>
  );
}

function LeadsDoDiaPainel({ dias, fluxo }: { dias: number; fluxo: Fluxo }) {
  const [dados, setDados] = useState<{
    linhas: LinhaDia[];
    horas: LinhaHora[];
    total: TotalLeads;
  } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [baixando, setBaixando] = useState(false);

  useEffect(() => {
    let ativo = true;
    void (async () => {
      try {
        const res = await fetch(
          `/api/relatorios/leads-diarios?dias=${dias}&flow=${encodeURIComponent(fluxo.key)}`
        );
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
  }, [dias, fluxo.key]);

  /*
   * As séries do gráfico = as do bot + "não concluíram" no TOPO da pilha.
   * O neutro fica por último de propósito: é o que sobra, e no topo ele mostra a
   * folga entre quem entrou e quem foi triado sem quebrar a leitura das outras.
   */
  const series = useMemo(
    () => [...fluxo.series, { chave: NAO_CONCLUIU, rotulo: "Não concluíram", cor: NEUTRO }],
    [fluxo]
  );

  /*
   * O gráfico vai do mais ANTIGO para o mais recente; a tabela é o contrário, e
   * está certo: tabela se lê de cima, linha do tempo se lê da esquerda.
   */
  const serie = useMemo(
    () =>
      (dados?.linhas ?? [])
        .slice()
        .reverse()
        .map((l) => {
          const ponto: Record<string, string | number> = {
            rotulo: format(new Date(`${l.dia}T12:00:00`), "dd/MM", { locale: ptBR }),
          };
          for (const s of fluxo.series) ponto[s.chave] = l.desfechos[s.chave] ?? 0;
          ponto[NAO_CONCLUIU] = naoConcluiu(l);
          return ponto;
        }),
    [dados, fluxo]
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
  const semDesfecho = Math.max(t.entraram - t.concluiram, 0);

  const baixar = async () => {
    setBaixando(true);
    try {
      // Import dinâmico: o exceljs (~940 KB) só é baixado por quem clica.
      const { baixarRelatorioLeadsXlsx } = await import("@/lib/reports/leads-xlsx");
      await baixarRelatorioLeadsXlsx({
        linhas: dados.linhas,
        horas: dados.horas ?? [],
        total: t,
        dias,
        fluxoKey: fluxo.key,
        fluxoNome: fluxo.nome,
        mostraPontos: fluxo.mostraPontos,
        series: fluxo.series.map((s) => ({ chave: s.chave, rotulo: s.rotulo, cor: s.cor })),
        naoConcluiuCor: NEUTRO_XLSX,
      });
    } catch {
      toast.error("Não foi possível gerar a planilha");
    } finally {
      setBaixando(false);
    }
  };

  return (
    <>
      {/* ---------- Faixa de números ---------- */}
      <div
        className={cn(
          "mb-3 grid gap-3 sm:grid-cols-2",
          series.length === 3 ? "lg:grid-cols-4" : "lg:grid-cols-5"
        )}
      >
        <div className="rounded-xl border bg-white p-4">
          <p className="text-[11px] font-medium text-slate-500">Entraram</p>
          <p className="text-2xl font-bold tabular-nums text-slate-900">{t.entraram}</p>
          <p className="text-[11px] text-slate-400">nos últimos {dias} dias</p>
        </div>
        {series.map((s) => {
          const n = s.chave === NAO_CONCLUIU ? semDesfecho : (t.desfechos[s.chave] ?? 0);
          return (
            <div key={s.chave} className="rounded-xl border bg-white p-4">
              {/*
                ⚠️ O rótulo usa token de TEXTO, nunca a cor da série — a marca
                colorida ao lado é que carrega a identidade. Texto na cor da
                série perde contraste e some no dark.
              */}
              <p className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
                <span aria-hidden className="size-2 rounded-full" style={{ background: s.cor }} />
                {s.rotulo}
              </p>
              <p className="text-2xl font-bold tabular-nums text-slate-900">{n}</p>
              <p className="text-[11px] text-slate-400">
                {t.entraram > 0 ? `${Math.round((n / t.entraram) * 100)}% de quem entrou` : "—"}
              </p>
            </div>
          );
        })}
      </div>

      {/* ---------- Manchete + download ---------- */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white px-4 py-3">
        <p className="text-xs text-slate-500">
          <Manchete fluxo={fluxo} total={t} semDesfecho={semDesfecho} />
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
            Legenda SEMPRE presente — identidade nunca fica só na cor. É também a
            codificação secundária que as paletas exigem (tritan na faixa 6–8).
          */}
          <div className="flex flex-wrap items-center gap-3">
            {series.map((s) => (
              <span key={s.chave} className="flex items-center gap-1.5 text-[11px] text-slate-500">
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
              {series.map((s, i) => (
                <Bar
                  key={s.chave}
                  dataKey={s.chave}
                  name={s.rotulo}
                  stackId="dia"
                  fill={s.cor}
                  /* ⚠️ Vão de 2px entre as fatias — exigência da especificação de
                     marcas, e aqui também a codificação secundária que sustenta
                     as paletas. Só a fatia do TOPO arredonda, para o empilhado
                     não parecer barras soltas.

                     ⚠️ E o vão usa `var(--card)`, não `#ffffff`: no tema escuro
                     o card é `#16181f`, e um traço branco viraria uma linha
                     acesa entre as fatias — o defeito clássico de cor definida
                     para um tema só. */
                  stroke="var(--card)"
                  strokeWidth={2}
                  radius={i === series.length - 1 ? [4, 4, 0, 0] : 0}
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
              {["Dia", "Entraram", ...series.map((s) => s.rotulo)]
                .concat(fluxo.mostraPontos ? ["Pontos (média)"] : [])
                .map((h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-2.5 font-medium">
                    {h}
                  </th>
                ))}
            </tr>
          </thead>
          <tbody>
            {dados.linhas.map((l) => (
              <tr key={l.dia} className="border-b last:border-0">
                <td className="whitespace-nowrap px-4 py-2.5 font-medium text-slate-800">
                  {format(new Date(`${l.dia}T12:00:00`), "EEE, dd/MM", { locale: ptBR })}
                </td>
                <td className="px-4 py-2.5 tabular-nums">{l.entraram}</td>
                {series.map((s) => {
                  const n = s.chave === NAO_CONCLUIU ? naoConcluiu(l) : (l.desfechos[s.chave] ?? 0);
                  return (
                    <td
                      key={s.chave}
                      className={cn(
                        "px-4 py-2.5 tabular-nums",
                        // ⚠️ Cor só na MARCA de cor da coluna, nunca no número:
                        // o valor é texto e usa token de texto. O cinza do "não
                        // concluíram" é a única exceção, e é para recuar, não
                        // para destacar.
                        s.chave === NAO_CONCLUIU && "text-slate-400"
                      )}
                    >
                      {n}
                    </td>
                  );
                })}
                {fluxo.mostraPontos && (
                  // A média de pontos é o que permite mexer no limiar com dado
                  // na mão: frios com média 8 pedem outra conversa que frios com
                  // média 2.
                  <td className="px-4 py-2.5 tabular-nums text-slate-400">
                    {l.pontosMedio ?? "—"}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* A visão por HORA vem depois da tabela do diário: cada gráfico junto
          dos próprios números. Entre o gráfico e a tabela dele, este card
          separava um do outro. */}
      <div className="mt-4">
        <LeadsPorHora horas={dados.horas ?? []} dias={dias} />
      </div>

      {fluxo.historicoParcial && t.entraram > 0 && (
        <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
          {/* ⚠️ Backfill parcial ANUNCIADO. Silencioso, alguém compararia agosto
              com setembro e concluiria que a triagem melhorou. */}
          {fluxo.historicoParcial}
        </p>
      )}

      {t.entraram === 0 && <SemLeads fluxo={fluxo} />}
    </>
  );
}

interface LinhaHora {
  hora: number;
  entraram: number;
  concluiram: number;
  desfechos: Record<string, number>;
  pontosMedio: number | null;
}

/** Início e fim (inclusivo) do expediente, a MESMA janela do SLA (0079). */
const EXPEDIENTE_DE = 8;
const EXPEDIENTE_ATE = 18; // 19h exclusivo, como na 0079

function noExpediente(hora: number): boolean {
  return hora >= EXPEDIENTE_DE && hora <= EXPEDIENTE_ATE;
}

/**
 * Faixas do dia. Existem para dar os NÚMEROS em texto: com 24 barras não cabe
 * rótulo direto em nenhuma, e uma tabela de 24 linhas ninguém lê. Quatro faixas
 * é também como se pensa escala de equipe.
 */
const FAIXAS: { rotulo: string; de: number; ate: number }[] = [
  { rotulo: "Madrugada", de: 0, ate: 5 },
  { rotulo: "Manhã", de: 6, ate: 11 },
  { rotulo: "Tarde", de: 12, ate: 17 },
  { rotulo: "Noite", de: 18, ate: 23 },
];

/**
 * Em que HORÁRIO os leads chegam.
 *
 * ⚠️ **Barra simples, e NÃO empilhada por desfecho** — decidido por medida, não
 * por gosto. Foi medido antes de desenhar (secretaria, 30 dias): o mix de
 * desfecho é praticamente o MESMO dentro e fora do expediente (33,5% × 34,5% de
 * abandono), então o empilhado não acrescentaria informação. E as porcentagens
 * por hora fora do expediente estão sobre **n de 1 a 9** — empilhar faria "às
 * 21h só 11% abandonam" (9 leads) parecer padrão. A pergunta aqui é de VOLUME:
 * a barra simples responde direto e o pico salta.
 *
 * ⚠️ **Uma série só, então NÃO leva caixa de legenda** — o título nomeia o que é.
 * Os dois tons são realce (expediente × fora), não categorias: a frase acima do
 * gráfico é o que carrega esse significado, e é ela que faz o tom apagado ser
 * legível como "ninguém está aqui" em vez de "outra coisa".
 */
function LeadsPorHora({ horas, dias }: { horas: LinhaHora[]; dias: number }) {
  const serie = useMemo(
    () =>
      horas.map((h) => ({
        // "00h".."23h": mais legível que "0" e ordena igual.
        rotulo: `${String(h.hora).padStart(2, "0")}h`,
        hora: h.hora,
        entraram: h.entraram,
      })),
    [horas]
  );

  const total = horas.reduce((a, h) => a + h.entraram, 0);
  const dentro = horas.filter((h) => noExpediente(h.hora)).reduce((a, h) => a + h.entraram, 0);
  const fora = total - dentro;
  const pico = horas.reduce((a, h) => (h.entraram > a.entraram ? h : a), horas[0]);

  if (total === 0) {
    return (
      <div className="mb-4 rounded-xl border bg-white p-4">
        <p className="text-xs font-bold text-slate-700">Em que horário os leads chegam</p>
        <p className="mt-2 text-xs text-slate-400">Sem lead no período — nada a distribuir por hora.</p>
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-xl border bg-white p-4">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs font-bold text-slate-700">Em que horário os leads chegam</p>
        <p className="text-[11px] text-slate-400">
          soma dos últimos {dias} dias, horário de Brasília
        </p>
      </div>
      {/*
        A frase é a codificação secundária dos dois tons — e é o número que decide
        escala de equipe, então fica em texto e não só no gráfico.
      */}
      <p className="mb-3 text-xs text-slate-500">
        O pico é às{" "}
        <b className="tabular-nums text-slate-900">
          {String(pico.hora).padStart(2, "0")}h
        </b>{" "}
        ({pico.entraram} leads).{" "}
        <b className="tabular-nums text-slate-900">
          {Math.round((fora / total) * 100)}%
        </b>{" "}
        chegam <b>fora do expediente</b> (antes das {EXPEDIENTE_DE}h ou depois das{" "}
        {EXPEDIENTE_ATE + 1}h) — {fora} de {total}, nas barras mais claras.
      </p>
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={serie} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
            {/* Grade e eixos por TOKEN, não hex fixo — o dark do projeto remapeia
                CLASSES, e `stroke` de SVG é atributo. */}
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="rotulo"
              tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
              axisLine={false}
              tickLine={false}
              /* 24 rótulos não cabem: o Recharts rala os que não couberem, e o
                 `minTickGap` garante que os que sobrarem fiquem legíveis. */
              interval="preserveStartEnd"
              minTickGap={12}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
            />
            {/* Hover: é o que dá o número de CADA hora, já que 24 barras não
                aceitam rótulo direto. */}
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            <Bar dataKey="entraram" name="Leads" radius={[4, 4, 0, 0]} maxBarSize={26}>
              {/*
                ⚠️ Os dois tons saem de `<Cell>`, não de duas séries: duas séries
                exigiriam legenda, pediriam validação de paleta categórica e
                sugeririam que "fora do expediente" é outra coisa sendo contada.
                É a mesma contagem, realçada.

                ⚠️ E o tom apagado é TOKEN de tema (`--muted-foreground`): um
                cinza fixo viraria mancha clara acesa no card escuro.
              */}
              {serie.map((p) => (
                <Cell
                  key={p.hora}
                  fill={noExpediente(p.hora) ? INDIGO : "var(--muted-foreground)"}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Faixas do dia: a "table view" da checagem de acessibilidade, e onde os
          números aparecem sem depender de passar o mouse. */}
      <div className="mt-3 grid gap-2 sm:grid-cols-4">
        {FAIXAS.map((f) => {
          const n = horas
            .filter((h) => h.hora >= f.de && h.hora <= f.ate)
            .reduce((a, h) => a + h.entraram, 0);
          return (
            <div key={f.rotulo} className="rounded-lg border bg-slate-50 px-3 py-2">
              <p className="text-[11px] text-slate-500">
                {f.rotulo}{" "}
                <span className="tabular-nums text-slate-400">
                  {String(f.de).padStart(2, "0")}–{String(f.ate).padStart(2, "0")}h
                </span>
              </p>
              <p className="text-sm font-bold tabular-nums text-slate-900">
                {n}{" "}
                <span className="text-[11px] font-normal text-slate-400">
                  ({Math.round((n / total) * 100)}%)
                </span>
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Quem entrou e não recebeu desfecho nenhum. Nunca negativo. */
function naoConcluiu(l: LinhaDia): number {
  return Math.max(l.entraram - l.concluiram, 0);
}

/**
 * A frase que resume o período — e ela é **diferente por fluxo de propósito**.
 *
 * ⚠️ A taxa de qualificação do comercial é sobre os CLASSIFICADOS, não sobre quem
 * entrou: dividir pelos que entraram faria a taxa cair sempre que mais gente
 * desistisse, o que é problema de fluxo e não de qualidade do lead.
 *
 * ⚠️ Na secretaria essa taxa **não existe** — não há o que qualificar. O número
 * que importa lá é quanta gente CHEGOU a escolher o assunto (ou seja, chegou ao
 * atendente) e qual assunto domina a fila, que é o que decide onde reforçar a
 * equipe.
 */
function Manchete({
  fluxo,
  total,
  semDesfecho,
}: {
  fluxo: Fluxo;
  total: TotalLeads;
  semDesfecho: number;
}) {
  if (total.entraram === 0) return <>Nenhum lead no período.</>;

  if (fluxo.mostraPontos) {
    const quente = total.desfechos.quente ?? 0;
    const classificados = total.concluiram;
    if (classificados === 0) return <>Nenhum lead classificado no período.</>;
    return (
      <>
        <b className="text-base tabular-nums text-slate-900">
          {Math.round((quente / classificados) * 100)}%
        </b>{" "}
        dos leads classificados foram qualificados ({quente} de {classificados}). Os {semDesfecho}{" "}
        que não concluíram a triagem ficam fora dessa conta.
      </>
    );
  }

  const maior = fluxo.series
    .map((s) => ({ rotulo: s.rotulo, n: total.desfechos[s.chave] ?? 0 }))
    .sort((a, b) => b.n - a.n)[0];
  return (
    <>
      <b className="text-base tabular-nums text-slate-900">
        {Math.round((total.concluiram / total.entraram) * 100)}%
      </b>{" "}
      de quem entrou escolheu o assunto e chegou ao atendente ({total.concluiram} de{" "}
      {total.entraram}).
      {maior && maior.n > 0 && (
        <>
          {" "}
          O assunto mais pedido é <b>{maior.rotulo}</b> ({maior.n}).
        </>
      )}{" "}
      Os {semDesfecho} que pararam antes não escolheram nada.
    </>
  );
}

/** Vazio que EXPLICA, em vez de mostrar zeros sem motivo. */
function SemLeads({ fluxo }: { fluxo: Fluxo }) {
  return (
    <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
      <b>Nenhum lead no período.</b> A {fluxo.nome} não está vinculada a nenhum número — em{" "}
      <span className="font-mono">/whatsapp</span>, o canal precisa ter esse bot para os leads
      passarem por ela. O relatório enche sozinho a partir do primeiro atendimento.
    </div>
  );
}

/** Abas válidas para o `?tab=` da URL. */
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
