"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { PeriodoPicker } from "@/components/shared/period-picker";
import { formatBRL } from "@/lib/data/repos/opportunities";
import { hojeSP } from "@/lib/periodo";
import { cn } from "@/lib/utils";
import { RelatorioComercialLeads, type AlvoLeads } from "@/components/reports/relatorio-comercial-leads";

interface Linha {
  usuario: string;
  nome: string;
  departamento: string | null;
  recebidos: number;
  quentes: number;
  frios: number;
  perdidos_espera: number;
  com_ele_agora: number;
  sem_resposta: number;
  pendentes: number;
  ganhos_funil: number;
  perdidos_funil: number;
  vendas_guru: number;
  receita_guru: number;
}

type Periodo = { de: string; ate: string };

/** "12,5%" — ou "—" quando não há base (zero recebido não é 0% de conversão). */
function pct(n: number, base: number): string {
  if (base <= 0) return "—";
  return `${((n / base) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

/**
 * Relatório comercial: tudo que a diretoria precisa para avaliar e remunerar o
 * vendedor PJ, num período. "Agora" (carteira, sem resposta, pendentes) é o
 * estado atual e não muda com o seletor; o resto é do período.
 */
export function RelatorioComercial() {
  const [periodo, setPeriodo] = useState<Periodo>(() => ({ de: hojeSP(), ate: hojeSP() }));
  const [linhas, setLinhas] = useState<Linha[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [departamento, setDepartamento] = useState<string>("");
  const [todos, setTodos] = useState(false);
  const [alvo, setAlvo] = useState<AlvoLeads | null>(null);

  useEffect(() => {
    let ativo = true;
    void (async () => {
      setLinhas(null);
      setErro(null);
      try {
        const res = await fetch(`/api/relatorios/comercial?de=${periodo.de}&ate=${periodo.ate}`);
        const json = await res.json().catch(() => ({}));
        if (!ativo) return;
        if (!res.ok) return setErro(json?.error ?? "Não foi possível carregar");
        setLinhas(json.linhas ?? []);
      } catch {
        if (ativo) setErro("Falha de conexão");
      }
    })();
    return () => {
      ativo = false;
    };
  }, [periodo]);

  const departamentos = useMemo(
    () => [...new Set((linhas ?? []).map((l) => l.departamento).filter(Boolean) as string[])].sort(),
    [linhas]
  );

  const visiveis = useMemo(() => {
    let l = linhas ?? [];
    if (departamento) l = l.filter((x) => x.departamento === departamento);
    // Sem movimento nenhum, a linha só ocupa espaço — "mostrar todos" traz de volta.
    if (!todos)
      l = l.filter(
        (x) => x.recebidos || x.com_ele_agora || x.vendas_guru || x.ganhos_funil || x.perdidos_funil
      );
    return l;
  }, [linhas, departamento, todos]);

  const tot = useMemo(() => {
    const t = {
      recebidos: 0, quentes: 0, frios: 0, perdidos_espera: 0, com_ele_agora: 0,
      sem_resposta: 0, pendentes: 0, ganhos_funil: 0, perdidos_funil: 0, vendas_guru: 0, receita_guru: 0,
    };
    for (const l of visiveis)
      for (const k of Object.keys(t) as (keyof typeof t)[]) t[k] += l[k];
    return t;
  }, [visiveis]);

  const cab: { label: string; title: string }[] = [
    { label: "Vendedor", title: "" },
    { label: "Recebidos", title: "Leads DISTINTOS atribuídos a ele no período (devolvido e reentregue conta uma vez)" },
    { label: "Quentes", title: "Dos recebidos, os que o bot classificou como quentes" },
    { label: "Frios", title: "Dos recebidos, os que o bot classificou como frios" },
    { label: "Perdidos por espera", title: "Vezes em que a conversa saiu dele porque o cliente ficou sem resposta (devolução ao rodízio)" },
    { label: "Com ele agora", title: "Conversas abertas atribuídas a ele neste momento (não muda com o período)" },
    { label: "Sem resposta agora", title: "Das conversas com ele agora, as em que a última mensagem é do cliente" },
    { label: "Pendentes", title: "Recebidas enquanto estava offline e ainda não abertas" },
    { label: "Ganhos (funil)", title: "Cards dele marcados como Ganho, atualizados no período" },
    { label: "Perdidos (funil)", title: "Cards dele marcados como Perdido, atualizados no período" },
    { label: "Vendas (Guru)", title: "Vendas novas aprovadas na Guru no período, de contatos que estavam com ele no momento da venda" },
    { label: "Receita (Guru)", title: "Soma das vendas da coluna anterior" },
    { label: "Conversão", title: "Vendas (Guru) ÷ Recebidos no período" },
    { label: "Conversão quentes", title: "Vendas (Guru) ÷ Quentes recebidos no período" },
  ];

  return (
    <>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-bold text-slate-900">Relatório comercial</h1>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={departamento}
            onChange={(e) => setDepartamento(e.target.value)}
            className="h-8 rounded-md border bg-white px-2 text-xs"
          >
            <option value="">Todos os departamentos</option>
            {departamentos.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-xs text-slate-600">
            <input type="checkbox" checked={todos} onChange={(e) => setTodos(e.target.checked)} />
            mostrar todos
          </label>
          <PeriodoPicker periodo={periodo} onChange={setPeriodo} />
        </div>
      </div>
      <p className="mb-4 text-xs text-slate-500">
        Recebidos, perdidos, ganhos e vendas são do <strong>período</strong> escolhido. “Com ele agora”,
        “Sem resposta agora” e “Pendentes” são o estado <strong>atual</strong>. A venda da Guru é casada com o
        contato do CRM (CPF → telefone → e-mail) e creditada a quem estava com a conversa no momento da
        venda. “Ganhos (funil)” usa a última atualização do card, porque o CRM não guarda a data exata do
        ganho. Passe o mouse no título de cada coluna para ver a definição.
      </p>

      {erro && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-700">{erro}</div>
      )}
      {!linhas && !erro && (
        <div className="flex items-center gap-2 rounded-xl border bg-white p-4 text-xs text-slate-500">
          <Loader2 className="size-4 animate-spin" /> Carregando...
        </div>
      )}

      {linhas && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
            {[
              { k: "Recebidos", v: tot.recebidos },
              { k: "Com eles agora", v: tot.com_ele_agora },
              { k: "Sem resposta agora", v: tot.sem_resposta, alerta: tot.sem_resposta > 0 },
              { k: "Perdidos por espera", v: tot.perdidos_espera, alerta: tot.perdidos_espera > 0 },
              { k: "Vendas (Guru)", v: tot.vendas_guru },
              { k: "Receita (Guru)", v: formatBRL(tot.receita_guru) },
            ].map((c) => (
              <div key={c.k} className="rounded-xl border bg-white p-3">
                <p className="text-[11px] text-slate-500">{c.k}</p>
                <p className={cn("text-lg font-bold text-slate-900", c.alerta && "text-red-600")}>{c.v}</p>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto rounded-xl border bg-white">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b text-[11px] text-slate-400">
                  {cab.map((h) => (
                    <th key={h.label} title={h.title} className="whitespace-nowrap px-3 py-2.5 font-medium">
                      {h.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visiveis.length === 0 && (
                  <tr>
                    <td colSpan={cab.length} className="px-4 py-6 text-center text-slate-400">
                      Nenhum vendedor com movimento no período.
                    </td>
                  </tr>
                )}
                {visiveis.map((l) => (
                  <tr key={l.usuario} className="border-b last:border-0">
                    <td className="px-3 py-2.5">
                      <p className="font-medium text-slate-800">{l.nome}</p>
                      {l.departamento && <p className="text-[10px] text-slate-400">{l.departamento}</p>}
                    </td>
                    <td className="px-3 py-2.5 font-semibold">
                      <Num l={l} k="recebidos" rotulo="Recebidos" abrir={setAlvo} />
                    </td>
                    <td className="px-3 py-2.5 text-emerald-700">
                      <Num l={l} k="quentes" rotulo="Quentes" abrir={setAlvo} />
                    </td>
                    <td className="px-3 py-2.5 text-sky-700">
                      <Num l={l} k="frios" rotulo="Frios" abrir={setAlvo} />
                    </td>
                    <td className={cn("px-3 py-2.5", l.perdidos_espera > 0 && "font-semibold text-red-600")}>
                      <Num l={l} k="perdidos_espera" rotulo="Perdidos por espera" abrir={setAlvo} />
                    </td>
                    <td className="px-3 py-2.5 font-semibold">
                      <Num l={l} k="com_ele_agora" rotulo="Com ele agora" abrir={setAlvo} />
                    </td>
                    <td className={cn("px-3 py-2.5", l.sem_resposta > 0 && "font-semibold text-red-600")}>
                      <Num l={l} k="sem_resposta" rotulo="Sem resposta agora" abrir={setAlvo} />
                    </td>
                    <td className="px-3 py-2.5 text-amber-700">
                      <Num l={l} k="pendentes" rotulo="Pendentes" abrir={setAlvo} />
                    </td>
                    <td className="px-3 py-2.5 text-emerald-600">
                      <Num l={l} k="ganhos_funil" rotulo="Ganhos (funil)" abrir={setAlvo} />
                    </td>
                    <td className="px-3 py-2.5 text-slate-500">
                      <Num l={l} k="perdidos_funil" rotulo="Perdidos (funil)" abrir={setAlvo} />
                    </td>
                    <td className="px-3 py-2.5 font-semibold text-emerald-700">
                      <Num l={l} k="vendas_guru" rotulo="Vendas (Guru)" abrir={setAlvo} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5">{formatBRL(l.receita_guru)}</td>
                    <td className="px-3 py-2.5 font-semibold">{pct(l.vendas_guru, l.recebidos)}</td>
                    <td className="px-3 py-2.5">{pct(l.vendas_guru, l.quentes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <RelatorioComercialLeads alvo={alvo} periodo={periodo} onClose={() => setAlvo(null)} />
    </>
  );
}

/** Número clicável: abre a lista de leads. Zero não é clicável (lista vazia não responde nada). */
function Num({
  l, k, rotulo, abrir,
}: {
  l: Linha;
  k: keyof Linha;
  rotulo: string;
  abrir: (a: AlvoLeads) => void;
}) {
  const v = l[k] as number;
  if (!v) return <>{v}</>;
  return (
    <button
      onClick={() => abrir({ usuario: l.usuario, nome: l.nome, metrica: k, rotulo })}
      className="rounded px-1 underline decoration-dotted underline-offset-2 hover:bg-indigo-50 hover:text-indigo-700"
    >
      {v}
    </button>
  );
}
