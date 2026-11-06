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

export function LinhaDoTempoPresenca({
  userId,
  periodo,
}: {
  userId: string;
  periodo: Periodo;
}) {
  const [sessoes, setSessoes] = useState<Sessao[] | null>(null);
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
      setSessoes(todas);
    })();
    return () => {
      ativo = false;
    };
  }, [userId, periodo]);

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
        return (
          <div key={dia}>
            <p className="mb-1 text-[11px] font-semibold text-slate-700">
              {dia.split("-").reverse().join("/")} · entrou {HORA.format(new Date(lista[0].inicio))} ·
              último sinal {HORA.format(new Date(lista[lista.length - 1].fim))}
              <span className="ml-2 font-normal text-slate-500">
                online {dur(totOn)} · ausente {dur(totAus)}
              </span>
            </p>
            <ul className="ml-1 border-l border-slate-200 pl-3">
              {lista.map((s, i) => {
                const ant = lista[i - 1];
                const lacuna = ant ? minEntre(ant.fim, s.inicio) : 0;
                const aus = s.tipo === "ausente";
                return (
                  <li key={s.inicio + i} className="text-[11px]">
                    {lacuna >= LACUNA_MIN && (
                      <div className="py-0.5 text-slate-400">
                        {HORA.format(new Date(ant!.fim))}–{HORA.format(new Date(s.inicio))} · sem sinal
                        (CRM fechado ou inativo) · {dur(lacuna)}
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
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
