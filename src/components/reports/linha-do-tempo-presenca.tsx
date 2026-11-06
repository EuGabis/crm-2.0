"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { somaDias, type Periodo } from "@/lib/periodo";

/**
 * Linha do tempo da presença de UMA pessoa: quando entrou, quando ficou
 * ausente, quando saiu — sessão a sessão, de `presence_sessions`.
 *
 * O total por dia responde "quanto"; esta tela responde "como": 3h online pode
 * ser um bloco de manhã ou trinta entradas de segundos seguidas de "Ausente".
 *
 * ⚠️ `fim` é o ÚLTIMO SINAL de presença, não um logout: fechar a aba não avisa
 * ninguém. Por isso o intervalo entre duas sessões é escrito como "sem sinal"
 * (CRM fechado ou inativo), não como "saiu".
 */

type Sessao = { inicio: string; fim: string; tipo: string };

const HORA = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  hour: "2-digit",
  minute: "2-digit",
});
const DIA = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" });

/** Intervalo sem sinal menor que isto é ruído do ping, não saída. */
const LACUNA_MIN = 3;
const PAGINA = 1000;

function dur(min: number): string {
  const m = Math.round(min);
  if (m < 1) return "<1 min";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}h ${m % 60}min` : `${h}h`;
}

const minEntre = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 60000;

/** Conta os instantes em [a, b). */
const contar = (ts: number[], a: string, b: string) => {
  const x = Date.parse(a), y = Date.parse(b);
  return ts.filter((t) => t >= x && t < y).length;
};

function Leads({ n }: { n: number }) {
  return (
    <span className={n ? "font-semibold text-indigo-700" : "text-slate-400"}>
      · {n} lead{n === 1 ? "" : "s"}
    </span>
  );
}

export function LinhaDoTempoPresenca({
  userId,
  nome,
  periodo,
}: {
  userId: string;
  /** Nome exato como o gatilho escreve no evento "Atribuída a <nome>". */
  nome: string;
  periodo: Periodo;
}) {
  const [sessoes, setSessoes] = useState<Sessao[] | null>(null);
  /** Instantes (ms) em que um lead foi atribuído a esta pessoa. */
  const [leads, setLeads] = useState<number[]>([]);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    void (async () => {
      const supabase = createClient();
      // Dia em São Paulo: de 00:00 do início até 00:00 do dia seguinte ao fim.
      const de = `${periodo.de}T00:00:00-03:00`;
      const ate = `${somaDias(periodo.ate, 1)}T00:00:00-03:00`;
      const todas: Sessao[] = [];
      // ⚠️ Paginado: o PostgREST corta em 1000 linhas sem avisar.
      for (let p = 0; p < 20; p++) {
        const { data, error } = await supabase
          .from("presence_sessions")
          .select("inicio, fim, tipo")
          .eq("user_id", userId)
          .gte("fim", de)
          .lt("inicio", ate)
          .order("inicio")
          .order("id")
          .range(p * PAGINA, p * PAGINA + PAGINA - 1);
        if (!ativo) return;
        if (error) {
          setErro([error.code, error.message].filter(Boolean).join(" · "));
          return;
        }
        todas.push(...((data ?? []) as Sessao[]));
        if ((data ?? []).length < PAGINA) break;
      }
      /*
       * Leads RECEBIDOS = eventos "Atribuída a <nome>" do gatilho de atribuição
       * (202608281530). ⚠️ Não é `conversations.assigned_to`: ali só fica o que
       * AINDA está com a pessoa, e o que foi devolvido ou transferido sumiria.
       * O espaço depois do nome evita "Paulo" casar com "Paulo Lopes".
       */
      const padrao = `Atribuída a ${nome.replace(/[%_]/g, "_")} %`; // % no nome viraria curinga
      const ts: number[] = [];
      for (let p = 0; p < 20; p++) {
        const { data, error } = await supabase
          .from("messages")
          .select("created_at")
          .eq("type", "event")
          .ilike("body", padrao)
          .gte("created_at", de)
          .lt("created_at", ate)
          .order("created_at")
          .order("id")
          .range(p * PAGINA, p * PAGINA + PAGINA - 1);
        if (!ativo) return;
        if (error) {
          setErro([error.code, error.message].filter(Boolean).join(" · "));
          return;
        }
        for (const r of data ?? []) ts.push(Date.parse((r as { created_at: string }).created_at));
        if ((data ?? []).length < PAGINA) break;
      }
      setLeads(ts);
      setSessoes(todas);
    })();
    return () => {
      ativo = false;
    };
  }, [userId, nome, periodo]);

  if (erro) return <p className="text-[11px] text-amber-700">Não foi possível carregar: {erro}</p>;
  if (!sessoes)
    return (
      <p className="flex items-center gap-1 text-[11px] text-slate-500">
        <Loader2 className="size-3 animate-spin" /> Carregando linha do tempo…
      </p>
    );
  if (sessoes.length === 0)
    return <p className="text-[11px] text-slate-500">Nenhuma sessão registrada no período.</p>;

  // Agrupa pelo dia (em São Paulo) em que a sessão começou.
  const porDia = new Map<string, Sessao[]>();
  for (const s of sessoes) {
    const d = DIA.format(new Date(s.inicio));
    if (!porDia.has(d)) porDia.set(d, []);
    porDia.get(d)!.push(s);
  }

  return (
    <div className="space-y-3">
      {[...porDia.entries()].map(([dia, lista]) => {
        const online = lista.filter((s) => s.tipo !== "ausente");
        const totOn = online.reduce((t, s) => t + minEntre(s.inicio, s.fim), 0);
        const totAus = lista
          .filter((s) => s.tipo === "ausente")
          .reduce((t, s) => t + minEntre(s.inicio, s.fim), 0);
        // Leads do dia: os que caem fora das sessões/lacunas vão para "antes"/"depois".
        const iniDia = `${dia}T00:00:00-03:00`;
        const fimDia = `${somaDias(dia, 1)}T00:00:00-03:00`;
        const totDia = contar(leads, iniDia, fimDia);
        const antes = contar(leads, iniDia, lista[0].inicio);
        const depois = contar(leads, lista[lista.length - 1].fim, fimDia);
        return (
          <div key={dia}>
            <p className="mb-1 text-[11px] font-semibold text-slate-700">
              {dia.split("-").reverse().join("/")} · entrou {HORA.format(new Date(lista[0].inicio))} ·
              último sinal {HORA.format(new Date(lista[lista.length - 1].fim))}
              <span className="ml-2 font-normal text-slate-500">
                online {dur(totOn)} · ausente {dur(totAus)} · {totDia} lead
                {totDia === 1 ? "" : "s"} recebido{totDia === 1 ? "" : "s"}
              </span>
            </p>
            <ul className="ml-1 border-l border-slate-200 pl-3">
              {antes > 0 && (
                <li className="py-0.5 text-[11px] text-slate-400">
                  antes de {HORA.format(new Date(lista[0].inicio))} · sem sinal (offline){" "}
                  <Leads n={antes} />
                </li>
              )}
              {lista.map((s, i) => {
                const ant = lista[i - 1];
                const lacuna = ant ? minEntre(ant.fim, s.inicio) : 0;
                const aus = s.tipo === "ausente";
                // Lacuna curta (escondida) não é saída: seus leads vão para a sessão.
                const iniSeg = ant && lacuna < LACUNA_MIN ? ant.fim : s.inicio;
                const nSessao = contar(leads, iniSeg, s.fim);
                const nLacuna = ant && lacuna >= LACUNA_MIN ? contar(leads, ant.fim, s.inicio) : 0;
                return (
                  <li key={s.inicio + i} className="text-[11px]">
                    {lacuna >= LACUNA_MIN && (
                      <div className="py-0.5 text-slate-400">
                        {HORA.format(new Date(ant!.fim))}–{HORA.format(new Date(s.inicio))} · sem sinal
                        (CRM fechado ou inativo) · {dur(lacuna)} <Leads n={nLacuna} />
                      </div>
                    )}
                    <div className="flex items-center gap-2 py-0.5">
                      <span
                        aria-hidden
                        className={aus ? "size-2 rounded-full bg-amber-500" : "size-2 rounded-full bg-emerald-500"}
                      />
                      <span className="tabular-nums text-slate-600">
                        {HORA.format(new Date(s.inicio))}–{HORA.format(new Date(s.fim))}
                      </span>
                      <span className={aus ? "text-amber-700" : "text-emerald-700"}>
                        {aus ? "Ausente" : "Online"}
                      </span>
                      <span className="text-slate-500">{dur(minEntre(s.inicio, s.fim))}</span>
                      <Leads n={nSessao} />
                    </div>
                  </li>
                );
              })}
              {depois > 0 && (
                <li className="py-0.5 text-[11px] text-slate-400">
                  depois de {HORA.format(new Date(lista[lista.length - 1].fim))} · sem sinal
                  (offline) <Leads n={depois} />
                </li>
              )}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
