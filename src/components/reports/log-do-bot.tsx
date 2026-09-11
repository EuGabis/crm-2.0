"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

interface Linha {
  conversation_id: string;
  contato: string;
  telefone: string;
  chegou_em: string | null;
  atribuida_em: string | null;
  atendente_id: string | null;
  atendente: string;
  motivo: string;
  fluxo: string;
  canal: string;
  desfecho: string;
  na_fila: boolean;
}

const PERIODOS = [
  { label: "Hoje", dias: 1 },
  { label: "7 dias", dias: 7 },
  { label: "30 dias", dias: 30 },
];

/**
 * Teto de linhas desenhadas por grade.
 *
 * ⚠️ Não é estética: um dia real passa de mil leads, e sem teto o navegador
 * monta milhares de `<tr>` em oito grades ao mesmo tempo. O card DIZ quando
 * corta — tabela que mostra 300 de 800 calada é a mesma classe de mentira do
 * corte de mil linhas que esta tela levou do PostgREST.
 */
const MAX_LINHAS = 300;

/**
 * Hora no relógio de SÃO PAULO, não no do navegador.
 *
 * ⚠️ A operação inteira raciocina em horário de Brasília ("caiu 22h", "logou
 * 8h"). Um gestor abrindo isto de outro fuso leria horários que não batem com o
 * que a equipe viveu — e esta tela existe para reconstruir a linha do tempo de
 * um incidente.
 */
const hora = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat("pt-BR", {
        timeZone: "America/Sao_Paulo",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(iso))
    : "—";

const dataHora = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat("pt-BR", {
        timeZone: "America/Sao_Paulo",
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(iso))
    : "—";

/** Só a hora cheia, para agrupar o "em qual período" (00–23). */
const horaCheia = (iso: string) =>
  Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      hour12: false,
    }).format(new Date(iso)),
  );

/**
 * O motivo cru vira um rótulo curto e uma cor.
 *
 * 🔴 É a coluna que os dois incidentes desta semana pediram: ela diz QUAL dos
 * caminhos atribuiu o lead. Sem isso, "o Alberto recebeu tudo" não distingue o
 * botão do Relatório do tique de minuto — e a correção vai para o lugar errado,
 * que foi exatamente o que aconteceu em 10/09.
 */
function origemDe(motivo: string): { curto: string; classe: string } {
  const m = (motivo || "").toLowerCase();
  if (m.includes("relatório")) return { curto: "botão do relatório", classe: "bg-amber-100 text-amber-700" };
  if (m.includes("administrador")) return { curto: "escolha do admin", classe: "bg-amber-100 text-amber-700" };
  if (m.includes("varredura")) return { curto: "varredura da fila", classe: "bg-sky-100 text-sky-700" };
  if (m.includes("devolvida") || m.includes("redistribuída"))
    return { curto: "devolução", classe: "bg-rose-100 text-rose-700" };
  if (m.includes("transferida") || m.includes("assumida") || m.includes("supervisão"))
    return { curto: "pessoa", classe: "bg-violet-100 text-violet-700" };
  if (m.includes("rodízio") || m.includes("bot") || m.includes("fluxo"))
    return { curto: "bot / rodízio", classe: "bg-emerald-100 text-emerald-700" };
  if (!m) return { curto: "—", classe: "bg-slate-100 text-slate-500" };
  return { curto: motivo, classe: "bg-slate-100 text-slate-600" };
}

export function LogDoBot() {
  const [dias, setDias] = useState(1);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [truncado, setTruncado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [fluxo, setFluxo] = useState("todos");
  const [canal, setCanal] = useState("todos");

  useEffect(() => {
    let vivo = true;
    /*
     * ⚠️ Os `setState` ficam DENTRO da função assíncrona, não no corpo do
     * efeito: chamada síncrona ali dispara renderização em cascata e o lint do
     * projeto acusa (`react-hooks/set-state-in-effect`). O `await` já tira a
     * primeira atualização do caminho síncrono.
     */
    void (async () => {
      setCarregando(true);
      setErro(null);
      const r = await fetch(`/api/relatorios/log-bot?dias=${dias}`);
      const j = await r.json().catch(() => ({}));
      if (!vivo) return;
      if (!r.ok) setErro(j.error ?? "Não foi possível carregar");
      else {
        setLinhas(j.linhas ?? []);
        setTruncado(!!j.truncado);
      }
      setCarregando(false);
    })();
    return () => {
      vivo = false;
    };
  }, [dias]);

  const fluxos = useMemo(
    () => Array.from(new Set(linhas.map((l) => l.fluxo).filter(Boolean))).sort(),
    [linhas],
  );
  /*
   * ⚠️ O filtro por NÚMERO é o jeito de isolar o time de vendas sem casar por
   * nome de pessoa. "Paulo, Alberto e Rogério" é o time de hoje; o número do CRM
   * é o vínculo real, e continua certo quando alguém entra ou sai. Casar por nome
   * já confundiu setor mais de uma vez neste projeto.
   */
  const canais = useMemo(
    () => Array.from(new Set(linhas.map((l) => l.canal).filter(Boolean))).sort(),
    [linhas],
  );

  const visiveis = useMemo(
    () =>
      linhas.filter(
        (l) => (fluxo === "todos" || l.fluxo === fluxo) && (canal === "todos" || l.canal === canal),
      ),
    [linhas, fluxo, canal],
  );

  /**
   * Um grupo por atendente, mais o grupo da FILA.
   *
   * ⚠️ A fila entra como grupo próprio e não é omitida: "o Alberto levou 34 e 66
   * estão esperando" e "o Alberto levou 34 de 34" descrevem operações opostas, e
   * sem a fila ao lado não dá para distinguir uma da outra.
   */
  const grupos = useMemo(() => {
    const mapa = new Map<string, { nome: string; naFila: boolean; leads: Linha[] }>();
    for (const l of visiveis) {
      const chave = l.na_fila ? "__fila__" : (l.atendente_id ?? "__sem__");
      if (!mapa.has(chave)) {
        mapa.set(chave, {
          nome: l.na_fila ? "Na fila (sem dono)" : l.atendente || "Sem responsável",
          naFila: l.na_fila,
          leads: [],
        });
      }
      mapa.get(chave)!.leads.push(l);
    }
    return Array.from(mapa.values()).sort((a, b) => {
      // A fila sempre por último: é contexto, não desempenho de ninguém.
      if (a.naFila !== b.naFila) return a.naFila ? 1 : -1;
      return b.leads.length - a.leads.length;
    });
  }, [visiveis]);

  const atribuidos = visiveis.filter((l) => !l.na_fila).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <h2 className="text-sm font-bold text-slate-900">Log do bot</h2>
          <p className="text-[11px] text-slate-500">
            Cada lead que entrou por um número com setor: quem recebeu, quando chegou, quando foi
            atribuído e por qual caminho.
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {PERIODOS.map((p) => (
            <button
              key={p.dias}
              onClick={() => setDias(p.dias)}
              className={cn(
                "h-7 rounded-md border px-2 text-[11px] font-medium",
                dias === p.dias
                  ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
              )}
            >
              {p.label}
            </button>
          ))}
          {canais.length > 1 && (
            <select
              value={canal}
              onChange={(e) => setCanal(e.target.value)}
              title="Filtrar pelo número do CRM — é como isolar o time de vendas"
              className="h-7 max-w-[190px] rounded-md border border-slate-200 bg-white px-1.5 text-[11px] text-slate-700"
            >
              <option value="todos">Número: todos</option>
              {canais.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
          {fluxos.length > 1 && (
            <select
              value={fluxo}
              onChange={(e) => setFluxo(e.target.value)}
              className="h-7 max-w-[190px] rounded-md border border-slate-200 bg-white px-1.5 text-[11px] text-slate-700"
            >
              <option value="todos">Fluxo: todos</option>
              {fluxos.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {erro && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
          {erro}
        </div>
      )}

      {/*
        ⚠️ Um total truncado é pior que nenhum: as porcentagens do rateio saem
        erradas e alguém decide com base nelas. Se o teto de páginas morder, a
        tela diz — em vez de mostrar um número redondo com cara de total.
      */}
      {truncado && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <strong>Período grande demais para listar inteiro.</strong> Os números abaixo cobrem
          apenas as primeiras 10.000 linhas — use um período menor para conferir o rateio.
        </div>
      )}

      {carregando && <p className="text-xs text-slate-500">Carregando…</p>}

      {!carregando && !erro && visiveis.length === 0 && (
        <div className="rounded-xl border bg-white p-6 text-center">
          <p className="text-sm font-semibold text-slate-700">Nenhum lead neste período</p>
          <p className="mt-1 text-xs text-slate-500">
            Só entram conversas de números vinculados a um setor — é o universo do rodízio.
          </p>
        </div>
      )}

      {!carregando && !erro && visiveis.length > 0 && (
        <>
          {/*
            A faixa do rateio. ⚠️ É a informação que faltava nos dois incidentes:
            a divisão entre os vendedores só é legível com os números lado a lado,
            e com a fila junto.
          */}
          <div className="rounded-xl border bg-white p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Divisão no período · {atribuidos} atribuído(s) de {visiveis.length}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {grupos.map((g) => {
                const pct = atribuidos > 0 && !g.naFila ? (g.leads.length / atribuidos) * 100 : null;
                return (
                  <div
                    key={g.nome}
                    className={cn(
                      "rounded-lg border px-2.5 py-1.5",
                      g.naFila ? "border-slate-200 bg-slate-50" : "border-slate-200 bg-white",
                    )}
                  >
                    <p className="text-[11px] font-medium text-slate-600">{g.nome}</p>
                    <p className="text-base font-bold text-slate-900">
                      {g.leads.length}
                      {/*
                        ⚠️ A porcentagem é sobre os ATRIBUÍDOS, não sobre o total:
                        com a fila no denominador, "33% cada" nunca apareceria e a
                        regra do rateio ficaria impossível de conferir na tela.
                      */}
                      {pct !== null && (
                        <span className="ml-1 text-[11px] font-medium text-slate-500">
                          {pct.toFixed(1).replace(".", ",")}%
                        </span>
                      )}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          {/*
            🔴 TRÊS GRADES LADO A LADO, e não uma lista embaixo da outra.
            Empilhado, o Paulo com 258 leads empurrava o Alberto e o Rogério para
            fora da tela — e comparar o rateio, que é a razão de existir deste log,
            exigia rolar centenas de linhas e memorizar números. Cada grade rola
            POR DENTRO (`max-h` + `overflow-auto`), então as três ficam visíveis ao
            mesmo tempo em qualquer altura de janela.
          */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            {grupos.map((g) => {
              const comHora = g.leads.filter((l) => l.atribuida_em);
              const horas = comHora.map((l) => horaCheia(l.atribuida_em!));
              const faixa =
                horas.length > 0
                  ? `${String(Math.min(...horas)).padStart(2, "0")}h–${String(
                      Math.max(...horas),
                    ).padStart(2, "0")}h`
                  : null;
              // Quantos por hora — é o "em qual período" do pedido, e é o que
              // torna visível um despejo (tudo concentrado numa hora só).
              const porHora = new Map<number, number>();
              for (const h of horas) porHora.set(h, (porHora.get(h) ?? 0) + 1);
              const pico = [...porHora.entries()].sort((a, b) => b[1] - a[1])[0];
              /*
               * Fluxo e número saíram da LINHA e viraram resumo do cabeçalho: numa
               * coluna de um terço da tela não cabem sete colunas de tabela, e
               * esses dois se repetem em quase toda linha do mesmo atendente.
               * Havendo mais de um, o cabeçalho diz QUANTOS em vez de escolher um
               * e mentir.
               */
              const resumo = (vals: string[], plural: string) => {
                const u = Array.from(new Set(vals.filter(Boolean)));
                return u.length === 1 ? u[0] : u.length > 1 ? `${u.length} ${plural}` : null;
              };
              const fluxoDoGrupo = resumo(g.leads.map((l) => l.fluxo), "fluxos");
              const mostrados = g.leads.slice(0, MAX_LINHAS);

              return (
                <div
                  key={g.nome}
                  className="flex flex-col overflow-hidden rounded-xl border bg-white"
                >
                  <div className="border-b bg-slate-50/70 px-3 py-2">
                    <div className="flex items-baseline gap-2">
                      <p className="truncate text-xs font-bold text-slate-800">{g.nome}</p>
                      <p className="ml-auto shrink-0 text-sm font-bold text-slate-900">
                        {g.leads.length}
                      </p>
                    </div>
                    <p className="mt-0.5 text-[10px] leading-snug text-slate-500">
                      {faixa ? `atribuídos entre ${faixa}` : "sem atribuição no período"}
                      {pico && pico[1] > 1
                        ? ` · pico às ${String(pico[0]).padStart(2, "0")}h (${pico[1]})`
                        : ""}
                      {fluxoDoGrupo ? ` · ${fluxoDoGrupo}` : ""}
                    </p>
                  </div>
                  {/* A rolagem é DAQUI, não da página: é o que mantém as três lado a lado. */}
                  <div className="max-h-[520px] overflow-auto">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-white">
                        <tr className="border-b text-left text-[10px] uppercase tracking-wide text-slate-400">
                          <th className="px-2 py-1.5 font-semibold">Nome</th>
                          <th className="px-2 py-1.5 font-semibold">Número</th>
                          <th className="px-2 py-1.5 font-semibold">Chegou</th>
                          <th className="px-2 py-1.5 font-semibold">Atrib.</th>
                          <th className="px-2 py-1.5 font-semibold">Origem</th>
                        </tr>
                      </thead>
                      <tbody>
                        {mostrados.map((l) => {
                          const o = origemDe(l.motivo);
                          return (
                            <tr key={l.conversation_id} className="border-b last:border-0">
                              <td className="max-w-[130px] px-2 py-1.5">
                                <Link
                                  href={`/conversas?c=${l.conversation_id}`}
                                  className="block truncate font-medium text-slate-800 hover:text-indigo-600 hover:underline"
                                  title={l.contato}
                                >
                                  {l.contato}
                                </Link>
                                {l.desfecho && (
                                  <span className="text-[10px] text-slate-400">{l.desfecho}</span>
                                )}
                              </td>
                              <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-slate-600">
                                {l.telefone || "—"}
                              </td>
                              <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-slate-600">
                                {dias > 1 ? dataHora(l.chegou_em) : hora(l.chegou_em)}
                              </td>
                              <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-slate-600">
                                {dias > 1 ? dataHora(l.atribuida_em) : hora(l.atribuida_em)}
                              </td>
                              <td className="px-2 py-1.5">
                                <span
                                  className={cn(
                                    "whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium",
                                    o.classe,
                                  )}
                                  // O motivo COMPLETO no title: o rótulo curto
                                  // agrupa, mas "devolvida: esperava 37 min" tem o
                                  // número que explica o caso.
                                  title={l.motivo || undefined}
                                >
                                  {o.curto}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {g.leads.length > MAX_LINHAS && (
                      <p className="border-t bg-slate-50 px-2 py-1.5 text-[10px] text-slate-500">
                        mostrando os {MAX_LINHAS} mais recentes de {g.leads.length}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
