"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, Info, Loader2, RefreshCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { piorStatus, type Checagem, type Status } from "@/lib/saude/avaliar";
import { cn } from "@/lib/utils";

const ATUALIZA_MS = 60_000;

const ESTILO: Record<Status, { rotulo: string; texto: string; fundo: string; Icone: typeof CheckCircle2 }> = {
  ok: { rotulo: "OK", texto: "text-emerald-700", fundo: "bg-emerald-100", Icone: CheckCircle2 },
  atencao: { rotulo: "Atenção", texto: "text-amber-700", fundo: "bg-amber-100", Icone: AlertTriangle },
  falha: { rotulo: "Falha", texto: "text-red-700", fundo: "bg-red-100", Icone: XCircle },
  info: { rotulo: "Info", texto: "text-slate-600", fundo: "bg-slate-100", Icone: Info },
};

const GRUPOS = ["Aplicação", "Banco de dados", "Rotinas automáticas", "Filas", "WhatsApp", "Integrações"];

/**
 * Configurações → Saúde. Só administrador (a rota confere no servidor).
 *
 * ⚠️ O status vai SEMPRE em palavra ao lado do ícone, nunca só na cor: verde ×
 * vermelho é o par que a deuteranopia embaralha, e esta tela existe para que
 * "quebrado" seja impossível de não ver.
 */
export default function SaudePage() {
  const [checagens, setChecagens] = useState<Checagem[] | null>(null);
  const [medidoEm, setMedidoEm] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const res = await fetch("/api/saude", { cache: "no-store" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErro(res.status === 403 ? "Esta tela é só para administradores." : (j.error ?? `HTTP ${res.status}`));
        return;
      }
      setErro(null);
      setChecagens(j.checagens ?? []);
      setMedidoEm(j.medidoEm ?? null);
    } catch {
      setErro("Não foi possível falar com o servidor do CRM.");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    // setTimeout: a primeira carga sai do corpo síncrono do efeito (setState
    // direto ali dispara renderização em cascata).
    const primeira = setTimeout(() => void carregar(), 0);
    // Só atualiza com a aba visível: em segundo plano, cada rodada consultaria
    // o banco e quatro serviços externos sem ninguém olhando.
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void carregar();
    }, ATUALIZA_MS);
    const aoVoltar = () => document.visibilityState === "visible" && void carregar();
    document.addEventListener("visibilitychange", aoVoltar);
    return () => {
      clearTimeout(primeira);
      clearInterval(id);
      document.removeEventListener("visibilitychange", aoVoltar);
    };
  }, [carregar]);

  const porGrupo = useMemo(() => {
    const mapa = new Map<string, Checagem[]>();
    for (const c of checagens ?? []) mapa.set(c.grupo, [...(mapa.get(c.grupo) ?? []), c]);
    return GRUPOS.filter((g) => mapa.has(g)).map((g) => ({ grupo: g, itens: mapa.get(g)! }));
  }, [checagens]);

  const geral = piorStatus((checagens ?? []).map((c) => c.status));
  const contagem = (s: Status) => (checagens ?? []).filter((c) => c.status === s).length;

  return (
    <div className="max-w-4xl space-y-5 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-bold text-slate-900">
            <Activity className="size-5 text-indigo-500" /> Saúde do sistema
          </h1>
          <p className="text-xs text-slate-500">
            Banco, rotinas automáticas, filas, WhatsApp e integrações. Atualiza sozinho a cada minuto.
          </p>
        </div>
        <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={carregar} disabled={carregando}>
          {carregando ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          Atualizar
        </Button>
      </div>

      {erro && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{erro}</div>
      )}

      {!checagens && !erro && (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="size-4 animate-spin" /> Medindo...
        </p>
      )}

      {checagens && (
        <>
          <ResumoGeral status={geral} falhas={contagem("falha")} atencoes={contagem("atencao")} medidoEm={medidoEm} />
          {porGrupo.map(({ grupo, itens }) => {
            const s = piorStatus(itens.map((i) => i.status));
            return (
              <section key={grupo} className="rounded-xl border bg-white">
                <header className="flex items-center justify-between border-b px-4 py-2.5">
                  <h2 className="text-sm font-semibold text-slate-800">{grupo}</h2>
                  <Selo status={s} />
                </header>
                <ul className="divide-y">
                  {itens.map((c) => (
                    <li key={c.id} className="flex gap-3 px-4 py-2.5">
                      <div className="w-20 shrink-0 pt-0.5">
                        <Selo status={c.status} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-slate-800">{c.nome}</p>
                        <p className="text-xs text-slate-600">{c.resumo}</p>
                        {c.detalhe && (
                          <p className="mt-0.5 whitespace-pre-line break-words text-[11px] text-slate-500">{c.detalhe}</p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
          <p className="text-[11px] text-slate-400">
            Diagnósticos completos (abrem em JSON):{" "}
            <a href="/api/ai/diagnostico" target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">
              OpenAI com geração de teste
            </a>
            {" · "}
            <a href="/api/whatsapp/diagnostico" target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">
              contas do WhatsApp na Meta
            </a>
          </p>
        </>
      )}
    </div>
  );
}

function Selo({ status }: { status: Status }) {
  const e = ESTILO[status];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold", e.fundo, e.texto)}>
      <e.Icone className="size-3" /> {e.rotulo}
    </span>
  );
}

function ResumoGeral({
  status,
  falhas,
  atencoes,
  medidoEm,
}: {
  status: Status;
  falhas: number;
  atencoes: number;
  medidoEm: string | null;
}) {
  const e = ESTILO[status === "info" ? "ok" : status];
  const frase =
    status === "falha"
      ? `${falhas} item(ns) com falha${atencoes ? ` e ${atencoes} em atenção` : ""}`
      : status === "atencao"
        ? `${atencoes} item(ns) pedindo atenção`
        : "Tudo funcionando";
  return (
    <div className={cn("flex items-center justify-between rounded-xl p-4", e.fundo)}>
      <p className={cn("flex items-center gap-2 text-sm font-semibold", e.texto)}>
        <e.Icone className="size-5" /> {frase}
      </p>
      {medidoEm && (
        <p className="text-[11px] text-slate-500">
          medido às {new Date(medidoEm).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo" })}
        </p>
      )}
    </div>
  );
}
