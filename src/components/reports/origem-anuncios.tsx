"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { X } from "lucide-react";
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
import { PeriodoPicker } from "@/components/shared/period-picker";
import { createClient } from "@/lib/supabase/client";
import { useContactsByIds } from "@/lib/data/repos/db/contacts-search";
import { useDbTeam } from "@/lib/data/repos/db/contacts";
import { contactName } from "@/lib/data/repos/contacts";
import { formatBRL } from "@/lib/data/repos/opportunities";
import { temperaturaDe } from "@/lib/leads/temperatura";
import { resolvePreset, somaDias, type Periodo } from "@/lib/periodo";
import { cn } from "@/lib/utils";

/**
 * Painel "Leads por anúncio" (pedido 2026-10-23: "estilo Power BI, mais fácil
 * de ler e ver quem são esses leads"). Fonte: lead_origens (202610221000).
 *
 * Números grandes → barras por anúncio (clicar FILTRA tudo) → leads por dia →
 * tabela de quem são. Um filtro só alimenta os quatro blocos: número, barra e
 * linha da tabela nunca discordam.
 *
 * Cores = as do relatório "Leads do dia" (validadas: quente #059669, frio
 * #6366f1, "sem nota" no cinza do tema). Mesma regra de quente/frio do selo da
 * caixa (`temperaturaDe`). Vendas = cards GANHOS do contato (acumulado do
 * contato — a venda costuma vir dias depois do clique) e só o que quem está
 * vendo enxerga pela RLS.
 *
 * O anúncio é agrupado pelo NOME (o da Marketing API quando já resolvido, senão
 * o título que a Meta manda): vários ids com o mesmo título viram uma barra só,
 * que é a leitura que o gestor quer. O id aparece na tabela.
 */
type Linha = {
  id: string;
  plataforma: string;
  contact_id: string | null;
  conversation_id: string | null;
  meta_source_id: string | null;
  meta_headline: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  campanha: string | null;
  anuncio: string | null;
  created_at: string;
};

type Temp = "quente" | "frio" | null;
type Dados = {
  linhas: Linha[];
  temp: Map<string, Temp>;
  vendas: Map<string, number>;
  dono: Map<string, string | null>;
};

const PLAT: Record<string, string> = { meta: "Meta", google: "Google", site: "Site" };
const COR = { quente: "#059669", frio: "#6366f1", semNota: "var(--muted-foreground)" };
const PAGINA = 1000;
const TOP = 10;

const inicioSP = (d: string) => `${d}T00:00:00-03:00`;
const fimSP = (d: string) => `${d}T23:59:59.999-03:00`;
const diaSP = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(iso));

const nomeAnuncio = (l: Linha) => l.anuncio ?? l.meta_headline ?? l.utm_content ?? "(sem título)";
const nomeCampanha = (l: Linha) => l.campanha ?? l.utm_campaign ?? null;

async function carregar(p: Periodo): Promise<Dados> {
  const sb = createClient();
  const linhas: Linha[] = [];
  // Paginado: o PostgREST corta em 1000 linhas sem aviso (armadilha nº 7).
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await sb
      .from("lead_origens")
      .select(
        "id, plataforma, contact_id, conversation_id, meta_source_id, meta_headline, utm_campaign, utm_content, campanha, anuncio, created_at"
      )
      .gte("created_at", inicioSP(p.de))
      .lte("created_at", fimSP(p.ate))
      .order("created_at", { ascending: false })
      .order("id")
      .range(de, de + PAGINA - 1);
    if (error) throw new Error(`${error.code ?? ""} ${error.message}`.trim());
    linhas.push(...((data as Linha[]) ?? []));
    if ((data?.length ?? 0) < PAGINA) break;
  }
  const convs = [...new Set(linhas.map((l) => l.conversation_id).filter((x): x is string => !!x))];
  const contatos = [...new Set(linhas.map((l) => l.contact_id).filter((x): x is string => !!x))];
  const temp = new Map<string, Temp>();
  const vendas = new Map<string, number>();
  const dono = new Map<string, string | null>();
  const lotes = (ids: string[]) => Array.from({ length: Math.ceil(ids.length / 200) }, (_, i) => ids.slice(i * 200, i * 200 + 200));

  await Promise.all([
    ...lotes(convs).map(async (ids) => {
      const { data } = await sb
        .from("bot_desfechos")
        .select("conversation_id, pontos, limiar, created_at")
        .in("conversation_id", ids)
        .order("created_at", { ascending: false });
      for (const d of data ?? []) {
        const id = d.conversation_id as string;
        // Mais novo primeiro: o primeiro de cada conversa é o desfecho vigente.
        if (!temp.has(id))
          temp.set(id, temperaturaDe({ pontos: d.pontos as number | null, limiar: d.limiar as number | null }));
      }
    }),
    ...lotes(convs).map(async (ids) => {
      const { data } = await sb.from("conversations").select("id, assigned_to").in("id", ids);
      for (const c of data ?? []) dono.set(c.id as string, (c.assigned_to as string | null) ?? null);
    }),
    ...lotes(contatos).map(async (ids) => {
      const { data } = await sb
        .from("opportunities")
        .select("contact_id, value")
        .eq("status", "won")
        .in("contact_id", ids);
      for (const o of data ?? []) {
        const c = o.contact_id as string;
        vendas.set(c, (vendas.get(c) ?? 0) + Number(o.value ?? 0));
      }
    }),
  ]);
  return { linhas, temp, vendas, dono };
}

export function OrigemAnunciosReport() {
  const [periodo, setPeriodo] = useState<Periodo>(() => resolvePreset("30d"));
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [plataforma, setPlataforma] = useState<string>("todas");
  const [anuncio, setAnuncio] = useState<string | null>(null);
  const [temp, setTemp] = useState<"todas" | "quente" | "frio" | "sem">("todas");
  const team = useDbTeam();

  useEffect(() => {
    let vivo = true;
    carregar(periodo)
      .then((d) => {
        if (vivo) {
          setErro(null);
          setDados(d);
        }
      })
      .catch((e: Error) => vivo && setErro(e.message));
    return () => {
      vivo = false;
    };
  }, [periodo]);

  const tempDe = (l: Linha): Temp => (l.conversation_id ? dados?.temp.get(l.conversation_id) ?? null : null);

  /* Recorte da plataforma vale para TUDO; anúncio e temperatura também. */
  const daPlataforma = useMemo(
    () => (dados?.linhas ?? []).filter((l) => plataforma === "todas" || l.plataforma === plataforma),
    [dados, plataforma]
  );
  const recorte = useMemo(
    () =>
      daPlataforma.filter((l) => {
        if (anuncio && nomeAnuncio(l) !== anuncio) return false;
        const t = l.conversation_id ? dados?.temp.get(l.conversation_id) ?? null : null;
        if (temp === "quente" && t !== "quente") return false;
        if (temp === "frio" && t !== "frio") return false;
        if (temp === "sem" && t) return false;
        return true;
      }),
    [daPlataforma, anuncio, temp, dados]
  );

  const kpi = useMemo(() => {
    let quentes = 0;
    let frios = 0;
    let vendas = 0;
    let receita = 0;
    const contatosVenda = new Set<string>();
    for (const l of recorte) {
      const t = l.conversation_id ? dados?.temp.get(l.conversation_id) : null;
      if (t === "quente") quentes++;
      if (t === "frio") frios++;
      const r = l.contact_id ? dados?.vendas.get(l.contact_id) : undefined;
      if (r !== undefined && l.contact_id && !contatosVenda.has(l.contact_id)) {
        contatosVenda.add(l.contact_id);
        vendas++;
        receita += r;
      }
    }
    return { leads: recorte.length, quentes, frios, sem: recorte.length - quentes - frios, vendas, receita };
  }, [recorte, dados]);

  /* Barras: os 10 anúncios com mais leads + "Outros". Ignora o filtro de anúncio
     (senão a barra clicada viraria a única) mas respeita plataforma e temperatura. */
  const barras = useMemo(() => {
    const m = new Map<string, { nome: string; quente: number; frio: number; sem: number; total: number }>();
    for (const l of daPlataforma) {
      const t = l.conversation_id ? dados?.temp.get(l.conversation_id) ?? null : null;
      if (temp === "quente" && t !== "quente") continue;
      if (temp === "frio" && t !== "frio") continue;
      if (temp === "sem" && t) continue;
      const nome = nomeAnuncio(l);
      const g = m.get(nome) ?? { nome, quente: 0, frio: 0, sem: 0, total: 0 };
      if (t === "quente") g.quente++;
      else if (t === "frio") g.frio++;
      else g.sem++;
      g.total++;
      m.set(nome, g);
    }
    const ord = [...m.values()].sort((a, b) => b.total - a.total);
    if (ord.length <= TOP) return ord;
    const resto = ord.slice(TOP).reduce(
      (acc, g) => ({ ...acc, quente: acc.quente + g.quente, frio: acc.frio + g.frio, sem: acc.sem + g.sem, total: acc.total + g.total }),
      { nome: `Outros (${ord.length - TOP} anúncios)`, quente: 0, frio: 0, sem: 0, total: 0 }
    );
    return [...ord.slice(0, TOP), resto];
  }, [daPlataforma, temp, dados]);

  const porDia = useMemo(() => {
    // Todos os dias do período, inclusive os sem lead (zero, não buraco).
    const cont = new Map<string, number>();
    for (let d = periodo.de; d <= periodo.ate; d = somaDias(d, 1)) cont.set(d, 0);
    for (const l of recorte) {
      const d = diaSP(l.created_at);
      cont.set(d, (cont.get(d) ?? 0) + 1);
    }
    return [...cont.entries()].map(([dia, leads]) => ({ dia, rotulo: `${dia.slice(8, 10)}/${dia.slice(5, 7)}`, leads }));
  }, [recorte, periodo]);

  const nomes = useContactsByIds(recorte.slice(0, 300).map((l) => l.contact_id));
  const plataformas = useMemo(() => [...new Set((dados?.linhas ?? []).map((l) => l.plataforma))], [dados]);
  const pct = (n: number) => (kpi.leads ? `${Math.round((n / kpi.leads) * 100)}%` : "—");

  return (
    <div className="mt-8">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold text-slate-900">Leads por anúncio</h2>
        <PeriodoPicker periodo={periodo} onChange={(p) => { setPeriodo(p); setAnuncio(null); }} />
      </div>
      <p className="mb-3 text-xs text-slate-500">
        Leads que chegaram pelo WhatsApp por anúncio da Meta ou pelo botão do site. Clique numa barra
        para ver só aquele anúncio.
      </p>

      {/* Filtros numa linha só, acima de tudo. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {["todas", ...plataformas].map((p) => (
          <button
            key={p}
            onClick={() => { setPlataforma(p); setAnuncio(null); }}
            className={cn(
              "rounded-full px-3 py-1 text-[11px] font-medium",
              plataforma === p ? "bg-indigo-100 text-indigo-700" : "text-slate-500 hover:bg-slate-100"
            )}
          >
            {p === "todas" ? "Todas as plataformas" : PLAT[p] ?? p}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-slate-200" />
        {(
          [
            ["todas", "Todas as notas"],
            ["quente", "Quentes"],
            ["frio", "Frios"],
            ["sem", "Sem nota"],
          ] as const
        ).map(([k, r]) => (
          <button
            key={k}
            onClick={() => setTemp(k)}
            className={cn(
              "rounded-full px-3 py-1 text-[11px] font-medium",
              temp === k ? "bg-indigo-100 text-indigo-700" : "text-slate-500 hover:bg-slate-100"
            )}
          >
            {r}
          </button>
        ))}
        {anuncio && (
          <button
            onClick={() => setAnuncio(null)}
            className="flex items-center gap-1 rounded-full bg-indigo-500 px-3 py-1 text-[11px] font-medium text-white"
            title="Remover o filtro de anúncio"
          >
            Anúncio: <span className="max-w-[240px] truncate">{anuncio}</span>
            <X className="size-3" />
          </button>
        )}
      </div>

      {erro ? (
        <p className="rounded-xl border bg-white p-4 text-xs text-red-600">Não foi possível carregar: {erro}</p>
      ) : !dados ? (
        <p className="rounded-xl border bg-white p-4 text-xs text-slate-400">Carregando...</p>
      ) : dados.linhas.length === 0 ? (
        <p className="rounded-xl border bg-white p-4 text-xs text-slate-500">
          Nenhum lead com origem de anúncio no período. A origem é registrada desde 22/10/2026.
        </p>
      ) : (
        <>
          {/* Números grandes */}
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {[
              { t: "Leads", v: String(kpi.leads), s: anuncio ? "deste anúncio" : "no período" },
              { t: "Quentes", v: String(kpi.quentes), s: `${pct(kpi.quentes)} dos leads`, cor: COR.quente },
              { t: "Frios", v: String(kpi.frios), s: `${pct(kpi.frios)} dos leads`, cor: COR.frio },
              { t: "Sem nota", v: String(kpi.sem), s: "não concluíram a triagem" },
              { t: "Vendas", v: String(kpi.vendas), s: "contatos com card ganho" },
              { t: "Receita", v: formatBRL(kpi.receita), s: "dos cards ganhos" },
            ].map((k) => (
              <div key={k.t} className="rounded-xl border bg-white p-3">
                <p className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
                  {k.cor && <span className="size-2 rounded-full" style={{ background: k.cor }} />}
                  {k.t}
                </p>
                <p className="mt-1 text-2xl font-bold text-slate-900">{k.v}</p>
                <p className="text-[11px] text-slate-400">{k.s}</p>
              </div>
            ))}
          </div>

          <div className="mb-4 grid gap-3 xl:grid-cols-5">
            {/* Barras por anúncio */}
            <div className="rounded-xl border bg-white p-4 xl:col-span-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-800">Leads por anúncio</p>
                <div className="flex gap-3 text-[11px] text-slate-500">
                  <span className="flex items-center gap-1"><span className="size-2 rounded-sm" style={{ background: COR.quente }} />Quente</span>
                  <span className="flex items-center gap-1"><span className="size-2 rounded-sm" style={{ background: COR.frio }} />Frio</span>
                  <span className="flex items-center gap-1"><span className="size-2 rounded-sm" style={{ background: COR.semNota }} />Sem nota</span>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={Math.max(160, barras.length * 34)}>
                <BarChart data={barras} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }} barCategoryGap={8}>
                  <CartesianGrid horizontal={false} stroke="var(--border)" />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                  <YAxis
                    type="category"
                    dataKey="nome"
                    width={210}
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                    tickFormatter={(v: string) => (v.length > 30 ? `${v.slice(0, 29)}…` : v)}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: "var(--muted)", opacity: 0.4 }}
                    contentStyle={{ fontSize: 12, borderRadius: 8 }}
                    formatter={(v, n) => [v as number, n === "quente" ? "Quentes" : n === "frio" ? "Frios" : "Sem nota"]}
                  />
                  {(["quente", "frio", "sem"] as const).map((k) => (
                    <Bar
                      key={k}
                      dataKey={k}
                      stackId="t"
                      fill={k === "quente" ? COR.quente : k === "frio" ? COR.frio : COR.semNota}
                      stroke="var(--card)"
                      strokeWidth={2}
                      cursor="pointer"
                      onClick={(d) => {
                        // Recharts 3: a linha clicada vem em `payload`.
                        const nome = (d as unknown as { payload?: { nome?: string } }).payload?.nome;
                        if (!nome || nome.startsWith("Outros (")) return;
                        setAnuncio(anuncio === nome ? null : nome);
                      }}
                    >
                      {barras.map((b) => (
                        <Cell key={b.nome} fillOpacity={anuncio && anuncio !== b.nome ? 0.3 : 1} />
                      ))}
                    </Bar>
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Leads por dia */}
            <div className="rounded-xl border bg-white p-4 xl:col-span-2">
              <p className="mb-2 text-sm font-semibold text-slate-800">Leads por dia</p>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={porDia} margin={{ left: -16, right: 8, top: 4, bottom: 4 }}>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="rotulo" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} minTickGap={12} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                  <Tooltip
                    cursor={{ fill: "var(--muted)", opacity: 0.4 }}
                    contentStyle={{ fontSize: 12, borderRadius: 8 }}
                    formatter={(v) => [v as number, "Leads"]}
                  />
                  <Bar dataKey="leads" fill="#6366f1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Quem são */}
          <div className="rounded-xl border bg-white">
            <p className="border-b px-4 py-3 text-sm font-semibold text-slate-800">
              Quem são ({recorte.length})
              {recorte.length > 300 && <span className="ml-2 text-[11px] font-normal text-slate-400">mostrando os 300 mais recentes</span>}
            </p>
            <div className="max-h-[520px] overflow-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-white">
                  <tr className="border-b text-[11px] text-slate-400">
                    {["Lead", "Telefone", "Anúncio", "Nota", "Responsável", "Chegou em", ""].map((h) => (
                      <th key={h} className="whitespace-nowrap px-4 py-2.5 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {recorte.slice(0, 300).map((l) => {
                    const c = l.contact_id ? nomes.get(l.contact_id) : null;
                    const t = tempDe(l);
                    const donoId = l.conversation_id ? dados.dono.get(l.conversation_id) : null;
                    const camp = nomeCampanha(l);
                    return (
                      <tr key={l.id} className="border-b last:border-0 hover:bg-slate-50">
                        <td className="whitespace-nowrap px-4 py-2 font-medium text-slate-800">
                          {c ? contactName(c) : l.contact_id ? "Carregando..." : "—"}
                          {l.contact_id && dados.vendas.has(l.contact_id) && (
                            <span className="ml-2 rounded bg-emerald-100 px-1 text-[9px] font-semibold uppercase text-emerald-700">venda</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2 text-slate-600">{c?.phone ?? "—"}</td>
                        <td className="max-w-[280px] px-4 py-2 text-slate-700">
                          <p className="truncate" title={nomeAnuncio(l)}>{nomeAnuncio(l)}</p>
                          <p className="truncate text-[10px] text-slate-400">
                            {PLAT[l.plataforma] ?? l.plataforma}
                            {camp ? ` · ${camp}` : ""}
                            {l.meta_source_id ? ` · id ${l.meta_source_id}` : ""}
                          </p>
                        </td>
                        <td className="px-4 py-2">
                          {t ? (
                            <span
                              className={cn(
                                "rounded border px-1 text-[9px] font-semibold uppercase",
                                t === "frio" ? "border-indigo-200 bg-indigo-50 text-indigo-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"
                              )}
                            >
                              {t}
                            </span>
                          ) : (
                            <span className="text-[11px] text-slate-400">sem nota</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2 text-slate-600">
                          {donoId ? team.find((u) => u.id === donoId)?.name ?? "—" : <span className="text-amber-600">sem responsável</span>}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2 text-slate-600">
                          {format(new Date(l.created_at), "dd/MM HH:mm", { locale: ptBR })}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2">
                          <span className="flex gap-3">
                            {l.contact_id && <Link href={`/contatos/${l.contact_id}`} className="text-indigo-600 hover:underline">Contato</Link>}
                            {l.conversation_id && <Link href={`/conversas?c=${l.conversation_id}`} className="text-indigo-600 hover:underline">Conversa</Link>}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
