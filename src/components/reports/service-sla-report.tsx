"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Clock, Loader2, Target, TimerOff } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChannelIcon } from "@/components/shared/channel-icon";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import type { Channel } from "@/lib/data/types";
import { cn } from "@/lib/utils";

interface Critico {
  conversationId: string;
  contactId: string | null;
  contato: string;
  canal: Channel;
  responsavel: string | null;
  primeiraEntrada: string;
  esperaUtilMin: number;
  situacao: "esperando" | "violou";
  fechada: boolean;
  soBot: boolean;
}

interface Dados {
  periodo: { dias: number };
  meta: number;
  expediente: string;
  kpis: {
    recebidas: number;
    respondidas: number;
    sem_resposta: number;
    esperando_agora: number;
    dentro_da_meta: number;
    pct_na_meta: number;
    mediana_min: number | null;
    p90_min: number | null;
    maior_espera_aberta: number | null;
    respondidas_so_pelo_bot: number;
  };
  distribuicao: { faixa: string; conversas: number; violacao: boolean }[];
  agentes: {
    userId: string;
    nome: string;
    conversas: number;
    pct_na_meta: number;
    mediana_min: number | null;
    p90_min: number | null;
    sem_resposta: number;
  }[];
  canais: { canal: Channel; conversas: number; pct_na_meta: number; mediana_min: number | null }[];
  serie: { rotulo: string; recebidas: number; pct_na_meta: number; mediana_min: number | null }[];
  criticos: Critico[];
}

/** Minutos → texto curto. "sem dados" quando não houve o que medir. */
function dur(min: number | null | undefined): string {
  if (min == null) return "—";
  if (min < 1) return "menos de 1 min";
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h < 24) return m ? `${h}h ${m}min` : `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

/** Verde/âmbar/vermelho pelo cumprimento — a cor é o resumo da linha. */
function corPct(pct: number): string {
  if (pct >= 80) return "text-emerald-600";
  if (pct >= 50) return "text-amber-600";
  return "text-red-500";
}

const PERIODOS = [
  { label: "7 dias", value: 7 },
  { label: "30 dias", value: 30 },
  { label: "90 dias", value: 90 },
];

/**
 * Análise de atendimento — SLA de primeira resposta.
 *
 * O que esta tela corrige, em relação ao "tempo médio de resposta" da aba
 * Agentes (medido neste banco, 30 dias):
 *
 * - **Mediana e p90 no lugar da média.** A média era 675 min e a mediana 14 min:
 *   o número grande vinha de dois ou três casos extremos e descrevia mal o
 *   atendimento de todo mundo.
 * - **Minutos ÚTEIS.** Com o expediente (seg–sex, 8h–19h), o p90 caiu de 45h
 *   para 2h33 — quase tudo que parecia atraso gigante era fim de semana.
 * - **Quem NUNCA foi respondido aparece.** São 55 conversas, e antes não
 *   entravam em métrica nenhuma: o pior caso de atendimento era invisível.
 */
export function ServiceSlaReport() {
  const router = useRouter();
  const [dias, setDias] = useState(30);
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let ativo = true;
    void (async () => {
      try {
        setCarregando(true);
        const res = await fetch(`/api/relatorios/atendimento?dias=${dias}`);
        const json = await res.json().catch(() => ({}));
        if (!ativo) return;
        if (!res.ok) {
          setErro(json?.error ?? "Não foi possível carregar");
          setDados(null);
        } else {
          setErro(null);
          setDados(json);
        }
      } catch {
        if (ativo) setErro("Falha de conexão");
      } finally {
        if (ativo) setCarregando(false);
      }
    })();
    return () => {
      ativo = false;
    };
  }, [dias]);

  const k = dados?.kpis;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Análise de atendimento</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            Tempo até a <strong className="font-semibold text-slate-600">primeira resposta
            humana</strong>, contado só dentro do expediente
            {dados ? ` (${dados.expediente})` : ""}. Meta: {dados?.meta ?? 15} min.
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border bg-white p-0.5">
          {PERIODOS.map((p) => (
            <button
              key={p.value}
              onClick={() => setDias(p.value)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium",
                dias === p.value
                  ? "bg-indigo-50 text-indigo-700"
                  : "text-slate-500 hover:bg-slate-50"
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {erro && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-700">
          {erro}
        </div>
      )}
      {carregando && !dados && (
        <div className="flex items-center gap-2 rounded-xl border bg-white p-4 text-xs text-slate-500">
          <Loader2 className="size-4 animate-spin" /> Calculando...
        </div>
      )}

      {dados && k && k.recebidas === 0 && (
        <EmptyState
          icon={Clock}
          title="Nenhuma mensagem de cliente no período"
          description="O SLA começa a ser medido quando um cliente escreve. Amplie o período ou espere a primeira conversa."
        />
      )}

      {dados && k && k.recebidas > 0 && (
        <div className={cn("space-y-4", carregando && "opacity-60")}>
          {/* ---- KPIs ---- */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border bg-white p-4">
              <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                <Target className="size-3.5" /> Dentro da meta
              </p>
              <p className={cn("mt-1 text-2xl font-bold", corPct(k.pct_na_meta))}>
                {k.pct_na_meta.toLocaleString("pt-BR")}%
              </p>
              <p className="mt-1 text-[11px] text-slate-400">
                {k.dentro_da_meta} de {k.recebidas} conversas em até {dados.meta} min
              </p>
            </div>
            <div className="rounded-xl border bg-white p-4">
              <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                <Clock className="size-3.5" /> Resposta típica
              </p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{dur(k.mediana_min)}</p>
              {/* A mediana sozinha esconde a cauda; o p90 é a pergunta "e quando
                  vai mal?". Os dois juntos são o retrato honesto. */}
              <p className="mt-1 text-[11px] text-slate-400">
                metade responde nisso · 9 de 10 até {dur(k.p90_min)}
              </p>
            </div>
            <div className="rounded-xl border bg-white p-4">
              <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                <TimerOff className="size-3.5" /> Sem resposta
              </p>
              <p
                className={cn(
                  "mt-1 text-2xl font-bold",
                  k.sem_resposta > 0 ? "text-red-500" : "text-slate-900"
                )}
              >
                {k.sem_resposta}
              </p>
              <p className="mt-1 text-[11px] text-slate-400">
                {k.sem_resposta === 0
                  ? "todo cliente foi respondido"
                  : `nunca respondidas por uma pessoa${k.respondidas_so_pelo_bot > 0 ? ` · ${k.respondidas_so_pelo_bot} só o bot atendeu` : ""}`}
              </p>
            </div>
            <div className="rounded-xl border bg-white p-4">
              <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                <AlertTriangle className="size-3.5" /> Esperando agora
              </p>
              <p
                className={cn(
                  "mt-1 text-2xl font-bold",
                  k.esperando_agora > 0 ? "text-amber-600" : "text-slate-900"
                )}
              >
                {k.esperando_agora}
              </p>
              <p className="mt-1 text-[11px] text-slate-400">
                {k.esperando_agora === 0
                  ? "nenhuma conversa aberta sem resposta"
                  : `a mais antiga espera ${dur(k.maior_espera_aberta)}`}
              </p>
            </div>
          </div>

          {/* ---- Cumprimento no tempo + distribuição ---- */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border bg-white p-4">
              <p className="text-xs font-semibold text-slate-700">Cumprimento da meta por dia</p>
              <p className="mb-2 text-[11px] text-slate-400">
                % das conversas do dia respondidas em até {dados.meta} min úteis
              </p>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dados.serie} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                    <XAxis dataKey="rotulo" tick={{ fontSize: 10 }} />
                    {/* Domínio fixo de 0 a 100: é porcentagem. Deixar o Recharts
                        escalar pelo maior valor faria 40% desenhar quase no topo. */}
                    <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} unit="%" />
                    <Tooltip
                      // `unknown` nos parâmetros: o Formatter do Recharts entrega
                      // `ValueType | undefined`, e tipar como number|string não
                      // compila.
                      formatter={(valor: unknown, nome: unknown) =>
                        nome === "pct_na_meta"
                          ? [`${String(valor)}%`, "Na meta"]
                          : [String(valor), "Conversas"]
                      }
                    />
                    <Line
                      type="monotone"
                      dataKey="pct_na_meta"
                      name="pct_na_meta"
                      stroke="#6366f1"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-xl border bg-white p-4">
              <p className="text-xs font-semibold text-slate-700">Em quanto tempo respondemos</p>
              <p className="mb-2 text-[11px] text-slate-400">
                conversas por faixa de espera — vermelho é fora da meta
              </p>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={dados.distribuicao}
                    margin={{ top: 8, right: 8, bottom: 0, left: -20 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                    <XAxis dataKey="faixa" tick={{ fontSize: 9 }} interval={0} />
                    <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                    <Tooltip formatter={(valor: unknown) => [String(valor), "Conversas"]} />
                    <Bar dataKey="conversas" radius={[4, 4, 0, 0]}>
                      {dados.distribuicao.map((d) => (
                        <Cell key={d.faixa} fill={d.violacao ? "#f87171" : "#34d399"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* ---- Por atendente ---- */}
          <div className="rounded-xl border bg-white">
            <div className="border-b px-4 py-3">
              <p className="text-xs font-semibold text-slate-700">Por responsável da conversa</p>
              {/* Vale explicar na tela: a aba Agentes usa o autor da mensagem e
                  mostra "sem dados" para quase todo mundo, porque 86% das saídas
                  estão sem autor gravado. Aqui o recorte é o responsável. */}
              <p className="text-[11px] text-slate-400">
                pelo responsável atribuído, não por quem digitou — conversa sem responsável
                aparece agrupada
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b text-[11px] text-slate-400">
                    {["Responsável", "Conversas", "Na meta", "Resposta típica", "p90", "Sem resposta"].map(
                      (h) => (
                        <th key={h} className="whitespace-nowrap px-4 py-2.5 font-medium">
                          {h}
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody>
                  {dados.agentes.map((a) => (
                    <tr key={a.userId} className="border-b last:border-0">
                      <td className="px-4 py-2.5 font-medium text-slate-800">
                        {a.nome}
                        {a.userId === "__sem__" && (
                          <Badge variant="secondary" className="ml-2 text-[10px]">
                            ninguém assumiu
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-2.5">{a.conversas}</td>
                      <td className={cn("px-4 py-2.5 font-semibold", corPct(a.pct_na_meta))}>
                        {a.pct_na_meta.toLocaleString("pt-BR")}%
                      </td>
                      <td className="px-4 py-2.5">{dur(a.mediana_min)}</td>
                      <td className="px-4 py-2.5 text-slate-500">{dur(a.p90_min)}</td>
                      <td
                        className={cn(
                          "px-4 py-2.5",
                          a.sem_resposta > 0 ? "font-semibold text-red-500" : "text-slate-400"
                        )}
                      >
                        {a.sem_resposta}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ---- Por canal ---- */}
          {dados.canais.length > 1 && (
            <div className="rounded-xl border bg-white">
              <div className="border-b px-4 py-3">
                <p className="text-xs font-semibold text-slate-700">Por canal</p>
              </div>
              <div className="divide-y">
                {dados.canais.map((c) => (
                  <div key={c.canal} className="flex items-center gap-3 px-4 py-2.5 text-xs">
                    <ChannelIcon channel={c.canal} size={16} />
                    <span className="w-24 font-medium capitalize text-slate-700">{c.canal}</span>
                    <span className="w-24 text-slate-500">{c.conversas} conversas</span>
                    <span className={cn("w-16 font-semibold", corPct(c.pct_na_meta))}>
                      {c.pct_na_meta.toLocaleString("pt-BR")}%
                    </span>
                    <span className="text-slate-500">típica {dur(c.mediana_min)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ---- Fila de ação ---- */}
          <div className="rounded-xl border bg-white">
            <div className="border-b px-4 py-3">
              <p className="text-xs font-semibold text-slate-700">Precisa de atenção</p>
              <p className="text-[11px] text-slate-400">
                quem ainda espera vem primeiro; depois as respondidas fora da meta. Clique para
                abrir a conversa.
              </p>
            </div>
            {dados.criticos.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-slate-400">
                Nada fora da meta no período.
              </p>
            ) : (
              <div className="divide-y">
                {dados.criticos.map((c) => (
                  <button
                    key={c.conversationId}
                    onClick={() => // `?c=<id>` é o parâmetro que /conversas já entende (o mesmo do card
                      // do kanban) — abre direto naquela conversa.
                      router.push(`/conversas?c=${c.conversationId}`)}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-xs hover:bg-slate-50"
                  >
                    <span
                      className={cn(
                        "w-1.5 shrink-0 self-stretch rounded-full",
                        c.situacao === "esperando" ? "bg-amber-400" : "bg-red-400"
                      )}
                    />
                    <ChannelIcon channel={c.canal} size={14} />
                    <span className="w-40 shrink-0 truncate font-medium text-slate-800">
                      {c.contato}
                    </span>
                    <span className="w-28 shrink-0 truncate text-slate-400">
                      {c.responsavel ?? "sem responsável"}
                    </span>
                    <span
                      className={cn(
                        "w-28 shrink-0 font-semibold",
                        c.situacao === "esperando" ? "text-amber-600" : "text-red-500"
                      )}
                    >
                      {dur(c.esperaUtilMin)}
                    </span>
                    <span className="truncate text-slate-400">
                      {c.situacao === "esperando"
                        ? c.soBot
                          ? "esperando — só o bot respondeu"
                          : "esperando resposta"
                        : `respondida fora da meta`}
                      {c.fechada && " · conversa finalizada"}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <p className="text-[11px] text-slate-400">
            O relógio do SLA conta só {dados.expediente} — mensagem que chega de noite ou no fim de
            semana começa a contar na abertura seguinte. Resposta do bot não conta como
            atendimento: ela chega em segundos e faria o número parecer perfeito sem ninguém ter
            atendido.
          </p>
        </div>
      )}
    </>
  );
}
