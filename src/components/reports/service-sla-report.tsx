"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Clock, Filter, Loader2, Target, TimerOff, X } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import type { Channel } from "@/lib/data/types";
import {
  agregar,
  aplicarFiltros,
  dur,
  FILTROS_VAZIOS,
  SEM_RESPONSAVEL,
  temFiltro,
  type Situacao,
  type SlaFiltros,
  type SlaLinha,
} from "@/lib/reports/sla";
import { cn } from "@/lib/utils";

interface Resposta {
  periodo: { dias: number };
  meta: number;
  expediente: string;
  linhas: SlaLinha[];
  nomes: Record<string, string>;
  dias_do_periodo: string[];
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

const SITUACOES: { valor: Situacao; label: string }[] = [
  { valor: "na_meta", label: "Dentro da meta" },
  { valor: "fora_da_meta", label: "Respondidas fora da meta" },
  { valor: "sem_resposta", label: "Sem resposta humana" },
  { valor: "esperando", label: "Esperando agora" },
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
 *
 * Tudo é clicável e tudo reflete o MESMO recorte: os totais são somados no
 * navegador (`lib/reports/sla.ts`) a partir de uma linha por conversa, então
 * clicar numa barra, num dia, num KPI ou num responsável filtra a tela inteira
 * na hora, sem ida ao servidor.
 */
export function ServiceSlaReport() {
  const router = useRouter();
  const [dias, setDias] = useState(30);
  const [dados, setDados] = useState<Resposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [filtros, setFiltros] = useState<SlaFiltros>(FILTROS_VAZIOS);
  const [painelAberto, setPainelAberto] = useState(false);

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

  /**
   * Trocar de período limpa o recorte: um dia específico do período anterior
   * pode não existir no novo, e a tela ficaria vazia sem dar para entender por
   * quê. Feito no clique, e não num efeito sobre `dias` — o efeito rodaria
   * também na primeira montagem e disparava renderização em cascata.
   */
  const trocarPeriodo = (novo: number) => {
    setDias(novo);
    setFiltros(FILTROS_VAZIOS);
  };

  // `useMemo` e não `dados?.linhas ?? []`: o array literal nasce novo a cada
  // render e invalidaria todos os `useMemo` abaixo, refazendo a agregação sem
  // que nada tivesse mudado.
  const linhas = useMemo(() => dados?.linhas ?? [], [dados]);
  const filtradas = useMemo(() => aplicarFiltros(linhas, filtros), [linhas, filtros]);
  const ag = useMemo(
    () => agregar(filtradas, dados?.nomes ?? {}, dados?.dias_do_periodo ?? []),
    [filtradas, dados]
  );
  const totalPeriodo = linhas.length;
  // Os seletores conhecem o PERÍODO, não o recorte: se a lista encolhesse junto
  // com o filtro, trocar de responsável exigiria limpar o filtro antes.
  const canaisDoPeriodo = useMemo(() => [...new Set(linhas.map((l) => l.canal))].sort(), [linhas]);
  const responsaveisDoPeriodo = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const l of linhas) {
      const chave = l.assigned_to ?? SEM_RESPONSAVEL;
      mapa.set(
        chave,
        l.assigned_to ? (dados?.nomes[l.assigned_to] ?? "Atendente") : "Sem responsável"
      );
    }
    return [...mapa.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [linhas, dados]);

  const k = ag.kpis;
  /** Alterna um filtro: clicar no que já está ativo remove o recorte. */
  const alternar = <C extends keyof SlaFiltros>(campo: C, valor: SlaFiltros[C]) =>
    setFiltros((f) => ({ ...f, [campo]: f[campo] === valor ? FILTROS_VAZIOS[campo] : valor }));

  const chips: { rotulo: string; limpar: () => void }[] = [];
  if (filtros.faixa)
    chips.push({ rotulo: `espera: ${filtros.faixa}`, limpar: () => alternar("faixa", null) });
  if (filtros.dia)
    chips.push({
      rotulo: `dia ${filtros.dia.slice(8, 10)}/${filtros.dia.slice(5, 7)}`,
      limpar: () => alternar("dia", null),
    });
  if (filtros.responsavel)
    chips.push({
      rotulo: responsaveisDoPeriodo.find(([id]) => id === filtros.responsavel)?.[1] ?? "responsável",
      limpar: () => alternar("responsavel", null),
    });
  if (filtros.canal) chips.push({ rotulo: filtros.canal, limpar: () => alternar("canal", null) });
  if (filtros.situacao)
    chips.push({
      rotulo: SITUACOES.find((s) => s.valor === filtros.situacao)?.label ?? "situação",
      limpar: () => alternar("situacao", null),
    });
  if (filtros.estado)
    chips.push({
      rotulo: filtros.estado === "aberta" ? "conversa aberta" : "conversa finalizada",
      limpar: () => alternar("estado", null),
    });
  if (filtros.soBot)
    chips.push({ rotulo: "só o bot respondeu", limpar: () => alternar("soBot", false) });

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Análise de atendimento</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            Tempo até a{" "}
            <strong className="font-semibold text-slate-600">primeira resposta humana</strong>,
            contado só dentro do expediente
            {dados ? ` (${dados.expediente})` : ""}. Meta: {dados?.meta ?? 15} min.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => setPainelAberto((v) => !v)}
          >
            <Filter className="size-3.5" /> Mais filtros
            {chips.length > 0 && (
              <Badge variant="secondary" className="ml-0.5 text-[10px]">
                {chips.length}
              </Badge>
            )}
          </Button>
          <div className="flex items-center gap-1 rounded-lg border bg-white p-0.5">
            {PERIODOS.map((p) => (
              <button
                key={p.value}
                onClick={() => trocarPeriodo(p.value)}
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
      </div>

      {painelAberto && dados && (
        <div className="mb-4 grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1">
            <span className="text-[11px] font-medium text-slate-500">Responsável</span>
            <select
              value={filtros.responsavel ?? ""}
              onChange={(e) => setFiltros((f) => ({ ...f, responsavel: e.target.value || null }))}
              className="h-8 w-full rounded-md border bg-white px-2 text-xs"
            >
              <option value="">Todos</option>
              {responsaveisDoPeriodo.map(([id, nome]) => (
                <option key={id} value={id}>
                  {nome}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[11px] font-medium text-slate-500">Canal</span>
            <select
              value={filtros.canal ?? ""}
              onChange={(e) => setFiltros((f) => ({ ...f, canal: e.target.value || null }))}
              className="h-8 w-full rounded-md border bg-white px-2 text-xs capitalize"
            >
              <option value="">Todos</option>
              {canaisDoPeriodo.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[11px] font-medium text-slate-500">Situação</span>
            <select
              value={filtros.situacao ?? ""}
              onChange={(e) =>
                setFiltros((f) => ({ ...f, situacao: (e.target.value || null) as Situacao | null }))
              }
              className="h-8 w-full rounded-md border bg-white px-2 text-xs"
            >
              <option value="">Todas</option>
              {SITUACOES.map((s) => (
                <option key={s.valor} value={s.valor}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[11px] font-medium text-slate-500">Estado da conversa</span>
            <select
              value={filtros.estado ?? ""}
              onChange={(e) =>
                setFiltros((f) => ({
                  ...f,
                  estado: (e.target.value || null) as "aberta" | "fechada" | null,
                }))
              }
              className="h-8 w-full rounded-md border bg-white px-2 text-xs"
            >
              <option value="">Todas</option>
              <option value="aberta">Aberta</option>
              <option value="fechada">Finalizada</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={filtros.soBot}
              onChange={(e) => setFiltros((f) => ({ ...f, soBot: e.target.checked }))}
              className="size-3.5"
            />
            Só onde o bot respondeu e nenhuma pessoa
          </label>
        </div>
      )}

      {chips.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-slate-400">Recorte:</span>
          {chips.map((c) => (
            <button
              key={c.rotulo}
              onClick={c.limpar}
              className="flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-medium text-indigo-700 hover:bg-indigo-100"
            >
              {c.rotulo}
              <X className="size-3" />
            </button>
          ))}
          <button
            onClick={() => setFiltros(FILTROS_VAZIOS)}
            className="text-[11px] text-slate-500 hover:underline"
          >
            limpar tudo
          </button>
          <span className="text-[11px] text-slate-400">
            {filtradas.length.toLocaleString("pt-BR")} de {totalPeriodo.toLocaleString("pt-BR")}{" "}
            conversas
          </span>
        </div>
      )}

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

      {dados && totalPeriodo === 0 && (
        <EmptyState
          icon={Clock}
          title="Nenhuma mensagem de cliente no período"
          description="O SLA começa a ser medido quando um cliente escreve. Amplie o período ou espere a primeira conversa."
        />
      )}

      {dados && totalPeriodo > 0 && (
        <div className={cn("space-y-4", carregando && "opacity-60")}>
          {/* Recorte que não sobrou nada: explica e oferece a saída, em vez de
              deixar quatro zeros e dois gráficos vazios sem motivo aparente. */}
          {filtradas.length === 0 && (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
              <span>Nenhuma conversa combina com esse recorte.</span>
              <button
                onClick={() => setFiltros(FILTROS_VAZIOS)}
                className="font-semibold hover:underline"
              >
                limpar filtros
              </button>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiBotao
              ativo={filtros.situacao === "na_meta"}
              onClick={() => alternar("situacao", "na_meta")}
              icone={<Target className="size-3.5" />}
              titulo="Dentro da meta"
              valor={`${k.pct_na_meta.toLocaleString("pt-BR")}%`}
              corValor={corPct(k.pct_na_meta)}
              nota={`${k.dentro_da_meta} de ${k.recebidas} conversas em até ${dados.meta} min`}
            />
            <KpiBotao
              ativo={filtros.situacao === "fora_da_meta"}
              onClick={() => alternar("situacao", "fora_da_meta")}
              icone={<Clock className="size-3.5" />}
              titulo="Resposta típica"
              valor={dur(k.mediana_min)}
              // A mediana sozinha esconde a cauda; o p90 é a pergunta "e quando
              // vai mal?". Os dois juntos são o retrato honesto.
              nota={`metade responde nisso · 9 de 10 até ${dur(k.p90_min)}`}
            />
            <KpiBotao
              ativo={filtros.situacao === "sem_resposta"}
              onClick={() => alternar("situacao", "sem_resposta")}
              icone={<TimerOff className="size-3.5" />}
              titulo="Sem resposta"
              valor={String(k.sem_resposta)}
              corValor={k.sem_resposta > 0 ? "text-red-500" : undefined}
              nota={
                k.sem_resposta === 0
                  ? "todo cliente foi respondido"
                  : `nunca respondidas por uma pessoa${k.so_o_bot > 0 ? ` · ${k.so_o_bot} só o bot atendeu` : ""}`
              }
            />
            <KpiBotao
              ativo={filtros.situacao === "esperando"}
              onClick={() => alternar("situacao", "esperando")}
              icone={<AlertTriangle className="size-3.5" />}
              titulo="Esperando agora"
              valor={String(k.esperando_agora)}
              corValor={k.esperando_agora > 0 ? "text-amber-600" : undefined}
              nota={
                k.esperando_agora === 0
                  ? "nenhuma conversa aberta sem resposta"
                  : `a mais antiga espera ${dur(k.maior_espera_aberta)}`
              }
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border bg-white p-4">
              <p className="text-xs font-semibold text-slate-700">Cumprimento da meta por dia</p>
              <p className="mb-2 text-[11px] text-slate-400">clique num dia para ver só ele</p>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={ag.serie}
                    margin={{ top: 8, right: 8, bottom: 0, left: -20 }}
                    // O clique vem do GRÁFICO, não do ponto: acertar um `dot` de
                    // 4 px com o mouse é difícil, e a área do dia já diz qual foi.
                    onClick={(estado) => {
                      const rotulo = (estado as { activeLabel?: string })?.activeLabel;
                      const achado = ag.serie.find((s) => s.rotulo === rotulo);
                      if (achado) alternar("dia", achado.dia);
                    }}
                    style={{ cursor: "pointer" }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                    <XAxis dataKey="rotulo" tick={{ fontSize: 10 }} />
                    {/* Domínio fixo de 0 a 100: é porcentagem. Deixar o Recharts
                        escalar pelo maior valor faria 40% desenhar quase no topo. */}
                    <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} unit="%" />
                    <Tooltip
                      formatter={(valor: unknown) => [`${String(valor)}%`, "Na meta"]}
                      labelFormatter={(r: unknown) => {
                        const s = ag.serie.find((x) => x.rotulo === r);
                        return s ? `${String(r)} · ${s.recebidas} conversa(s)` : String(r);
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="pct_na_meta"
                      stroke="#6366f1"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-xl border bg-white p-4">
              <p className="text-xs font-semibold text-slate-700">Em quanto tempo respondemos</p>
              <p className="mb-2 text-[11px] text-slate-400">
                clique numa faixa para ver só ela — vermelho é fora da meta
              </p>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={ag.distribuicao}
                    margin={{ top: 8, right: 8, bottom: 0, left: -20 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                    <XAxis dataKey="faixa" tick={{ fontSize: 9 }} interval={0} />
                    <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                    <Tooltip formatter={(valor: unknown) => [String(valor), "Conversas"]} />
                    <Bar
                      dataKey="conversas"
                      radius={[4, 4, 0, 0]}
                      cursor="pointer"
                      onClick={(d: unknown) => {
                        const faixa = (d as { payload?: { faixa?: string } })?.payload?.faixa;
                        if (faixa) alternar("faixa", faixa);
                      }}
                    >
                      {ag.distribuicao.map((d) => (
                        <Cell
                          key={d.faixa}
                          fill={d.violacao ? "#f87171" : "#34d399"}
                          // A faixa fora do recorte fica apagada em vez de sumir:
                          // ver o tamanho relativo dela é metade da informação.
                          opacity={!filtros.faixa || filtros.faixa === d.faixa ? 1 : 0.3}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="rounded-xl border bg-white">
            <div className="border-b px-4 py-3">
              <p className="text-xs font-semibold text-slate-700">Por responsável da conversa</p>
              {/* Vale explicar na tela: a aba Agentes usa o autor da mensagem e
                  mostra "sem dados" para quase todo mundo, porque 86% das saídas
                  estão sem autor gravado. Aqui o recorte é o responsável. */}
              <p className="text-[11px] text-slate-400">
                pelo responsável atribuído, não por quem digitou · clique numa linha para filtrar
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b text-[11px] text-slate-400">
                    {[
                      "Responsável",
                      "Conversas",
                      "Na meta",
                      "Resposta típica",
                      "p90",
                      "Sem resposta",
                    ].map((h) => (
                      <th key={h} className="whitespace-nowrap px-4 py-2.5 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ag.agentes.map((a) => (
                    <tr
                      key={a.userId}
                      onClick={() => alternar("responsavel", a.userId)}
                      className={cn(
                        "cursor-pointer border-b last:border-0 hover:bg-slate-50",
                        filtros.responsavel === a.userId && "bg-indigo-50/60"
                      )}
                    >
                      <td className="px-4 py-2.5 font-medium text-slate-800">
                        {a.nome}
                        {a.userId === SEM_RESPONSAVEL && (
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
                  {ag.agentes.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                        Nada neste recorte.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {canaisDoPeriodo.length > 1 && (
            <div className="rounded-xl border bg-white">
              <div className="border-b px-4 py-3">
                <p className="text-xs font-semibold text-slate-700">Por canal</p>
                <p className="text-[11px] text-slate-400">clique para filtrar</p>
              </div>
              <div className="divide-y">
                {ag.canais.map((c) => (
                  <button
                    key={c.canal}
                    onClick={() => alternar("canal", c.canal)}
                    className={cn(
                      "flex w-full items-center gap-3 px-4 py-2.5 text-left text-xs hover:bg-slate-50",
                      filtros.canal === c.canal && "bg-indigo-50/60"
                    )}
                  >
                    <ChannelIcon channel={c.canal as Channel} size={16} />
                    <span className="w-24 font-medium capitalize text-slate-700">{c.canal}</span>
                    <span className="w-24 text-slate-500">{c.conversas} conversas</span>
                    <span className={cn("w-16 font-semibold", corPct(c.pct_na_meta))}>
                      {c.pct_na_meta.toLocaleString("pt-BR")}%
                    </span>
                    <span className="text-slate-500">típica {dur(c.mediana_min)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-xl border bg-white">
            <div className="border-b px-4 py-3">
              <p className="text-xs font-semibold text-slate-700">
                Precisa de atenção
                <span className="ml-2 font-normal text-slate-400">
                  {ag.criticos.length} conversa(s)
                </span>
              </p>
              <p className="text-[11px] text-slate-400">
                quem ainda espera vem primeiro; depois as respondidas fora da meta. Clique para
                abrir a conversa.
              </p>
            </div>
            {ag.criticos.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-slate-400">
                Nada fora da meta neste recorte.
              </p>
            ) : (
              <div className="divide-y">
                {ag.criticos.map((c) => (
                  <button
                    key={c.conversation_id}
                    // `?c=<id>` é o parâmetro que /conversas já entende (o mesmo
                    // do card do kanban) — abre direto naquela conversa.
                    onClick={() => router.push(`/conversas?c=${c.conversation_id}`)}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-xs hover:bg-slate-50"
                  >
                    <span
                      className={cn(
                        "w-1.5 shrink-0 self-stretch rounded-full",
                        c.situacao === "esperando" ? "bg-amber-400" : "bg-red-400"
                      )}
                    />
                    <ChannelIcon channel={c.canal as Channel} size={14} />
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
                      {dur(c.espera_util_min)}
                    </span>
                    <span className="truncate text-slate-400">
                      {c.situacao === "esperando"
                        ? c.respondida_por_bot
                          ? "esperando — só o bot respondeu"
                          : "esperando resposta"
                        : "respondida fora da meta"}
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
            {temFiltro(filtros) && " Os números acima refletem o recorte ativo."}
          </p>
        </div>
      )}
    </>
  );
}

/**
 * KPI que também é filtro. O estado ativo tem que ser visível: um número que
 * mudou porque você clicou nele, sem sinal de seleção, parece defeito.
 */
function KpiBotao({
  ativo,
  onClick,
  icone,
  titulo,
  valor,
  corValor,
  nota,
}: {
  ativo: boolean;
  onClick: () => void;
  icone: ReactNode;
  titulo: string;
  valor: string;
  corValor?: string;
  nota: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-xl border bg-white p-4 text-left transition hover:border-indigo-300",
        ativo && "border-indigo-400 ring-1 ring-indigo-200"
      )}
    >
      <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
        {icone} {titulo}
      </p>
      <p className={cn("mt-1 text-2xl font-bold", corValor ?? "text-slate-900")}>{valor}</p>
      <p className="mt-1 text-[11px] text-slate-400">{nota}</p>
    </button>
  );
}
