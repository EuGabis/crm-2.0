"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Loader2 } from "lucide-react";
import { agregar, dur, type SlaLinha } from "@/lib/reports/sla";
import { cn } from "@/lib/utils";

interface Resposta {
  meta: number;
  expediente: string;
  linhas: SlaLinha[];
  nomes: Record<string, string>;
  dias_do_periodo: string[];
}

/**
 * SLA de atendimento no painel de controle.
 *
 * Versão enxuta da aba Relatórios → Atendimento: quatro números e a porta para
 * a análise completa. A tela cheia tem gráficos clicáveis, filtros e a fila de
 * conversas — num widget de 1/2 de linha isso viraria um amontoado ilegível
 * (mesmo raciocínio do "Resumo pagamentos" na barra das Conversas).
 *
 * ⚠️ Aparece só para quem enxerga **relatorios** — o catálogo cuida disso pelo
 * `requires`, e a rota confere de novo no servidor. Esconder o widget não seria
 * proteção: `sla_conversations` é `security definer`.
 *
 * O 403 é tratado em silêncio de propósito: se o acesso mudou depois de o
 * painel ter sido salvo com este widget, a resposta certa é ele desaparecer, e
 * não um cartão vermelho de erro no painel de quem não pode ver mesmo.
 */
export function ServiceSlaWidget() {
  const [dados, setDados] = useState<Resposta | null>(null);
  const [semAcesso, setSemAcesso] = useState(false);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    let ativo = true;
    void (async () => {
      try {
        const res = await fetch("/api/relatorios/atendimento?dias=7");
        if (!ativo) return;
        if (res.status === 403) {
          setSemAcesso(true);
          return;
        }
        if (!res.ok) {
          setErro(true);
          return;
        }
        setDados(await res.json());
      } catch {
        if (ativo) setErro(true);
      }
    })();
    return () => {
      ativo = false;
    };
  }, []);

  if (semAcesso) return null;

  const ag = dados
    ? agregar(dados.linhas, dados.nomes, dados.dias_do_periodo)
    : null;

  return (
    <div className="rounded-2xl border bg-white p-4 transition hover:shadow-sm">
      <div className="mb-1 flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-slate-700">Atendimento (7 dias)</p>
          <p className="text-[11px] text-slate-400">
            primeira resposta humana, só no expediente
            {dados ? ` · meta ${dados.meta} min` : ""}
          </p>
        </div>
        <Link
          href="/relatorios?tab=Atendimento"
          className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-indigo-600 hover:underline"
        >
          Ver análise <ArrowRight className="size-3" />
        </Link>
      </div>

      {!ag && !erro && (
        <div className="flex items-center gap-2 py-6 text-xs text-slate-400">
          <Loader2 className="size-4 animate-spin" /> Calculando...
        </div>
      )}
      {erro && <p className="py-6 text-xs text-slate-400">Não foi possível carregar.</p>}

      {ag && ag.kpis.recebidas === 0 && (
        <p className="py-6 text-xs text-slate-400">
          Nenhum cliente escreveu nos últimos 7 dias.
        </p>
      )}

      {ag && ag.kpis.recebidas > 0 && (
        <>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Numero
              rotulo="Na meta"
              valor={`${ag.kpis.pct_na_meta.toLocaleString("pt-BR")}%`}
              cor={
                ag.kpis.pct_na_meta >= 80
                  ? "text-emerald-600"
                  : ag.kpis.pct_na_meta >= 50
                    ? "text-amber-600"
                    : "text-red-500"
              }
            />
            <Numero rotulo="Resposta típica" valor={dur(ag.kpis.mediana_min)} />
            <Numero
              rotulo="Sem resposta"
              valor={String(ag.kpis.sem_resposta)}
              cor={ag.kpis.sem_resposta > 0 ? "text-red-500" : undefined}
            />
            <Numero
              rotulo="Esperando"
              valor={String(ag.kpis.esperando_agora)}
              cor={ag.kpis.esperando_agora > 0 ? "text-amber-600" : undefined}
            />
          </div>

          {/* A fila de espera é o único item do widget que pede ação hoje —
              por isso ganha destaque e link direto, em vez de virar mais um
              número na grade. */}
          {ag.kpis.esperando_agora > 0 && (
            <Link
              href="/relatorios?tab=Atendimento"
              className="mt-3 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800 hover:bg-amber-100"
            >
              <AlertTriangle className="size-3.5 shrink-0" />
              {ag.kpis.esperando_agora} conversa(s) aberta(s) sem resposta — a mais antiga espera{" "}
              {dur(ag.kpis.maior_espera_aberta)}
            </Link>
          )}
        </>
      )}
    </div>
  );
}

function Numero({
  rotulo,
  valor,
  cor,
}: {
  rotulo: string;
  valor: string;
  cor?: string;
}) {
  return (
    <div>
      <p className="text-[11px] text-slate-500">{rotulo}</p>
      <p className={cn("text-lg font-bold", cor ?? "text-slate-900")}>{valor}</p>
    </div>
  );
}
