"use client";

import { useMemo } from "react";
import { useTeam } from "@/lib/data/repos/db/team";
import { cn } from "@/lib/utils";

/** Uma linha do quadro por atendente, como a rota devolve. */
export interface Carteira {
  atendente: string | null;
  recebeu: number;
  qualificados: number;
  finalizadas: number;
  ganhas: number;
  cursos: Record<string, number>;
}

export interface CursoContado {
  curso: string;
  leads: number;
}

/**
 * A carteira de cada atendente e os cursos marcados, na aba "Leads do dia".
 *
 * Pedido do Gabriel (2026-09-09): *"quantos leads cada atendente do número do
 * time comercial (Vendas) recebeu, quantos ele fechou e finalizou a conversa e,
 * se for possível, identificar os cursos quando o atendente marcar."*
 *
 * ⚠️ **"Recebeu" é com quem o lead está AGORA**, não quantos passaram pela mão
 * dele. Conversa devolvida ao rodízio troca de dono, e quem quer esse histórico
 * tem os eventos do fio (gatilho da 202608281530). A pergunta desta tabela é de
 * carteira: onde os leads do período foram parar.
 *
 * ⚠️ **"Sem responsável" é uma LINHA, não uma omissão.** Lead que ninguém
 * assumiu sumindo do quadro é exatamente o que não pode passar despercebido —
 * mesma decisão da aba Atendimento, onde as conversas sem responsável aparecem
 * agrupadas em vez de serem escondidas.
 *
 * Mora em arquivo próprio, e não em `relatorios/page.tsx`: aquela página já
 * passa de mil linhas, e este quadro tem regra de leitura própria o bastante
 * para ser lido sozinho.
 */
/**
 * A chave que a rota usa para agrupar quem NÃO é do time do setor.
 *
 * 🔴 Existe porque o Daniel — da secretaria — apareceu no quadro do comercial
 * com 2 leads: alguém transferiu duas conversas daquele número para ele. O dado é
 * verdadeiro, e mesmo assim uma linha de fora suja a comparação que o quadro
 * existe para fazer.
 *
 * ⚠️ **Agrupado, e não descartado**: sem essa linha, a soma de "Recebeu"
 * deixaria de fechar com "Entraram" — e quadro cuja soma não fecha é quadro em
 * que ninguém confia. De quebra ela responde algo útil: quanto do setor está
 * sendo atendido por fora.
 */
const FORA = "__fora__";

const ehPessoa = (id: string | null) => !!id && id !== FORA;

function rotulo(id: string | null, nomes: Map<string, string>): string {
  if (!id) return "Sem responsável";
  if (id === FORA) return "Outros setores";
  // "Carregando..." e não "—": os dois são coisas diferentes, e o mesmo texto
  // faria a linha COM atendente parecer sem nenhum enquanto a equipe não volta.
  return nomes.get(id) ?? "Carregando...";
}

export function CarteiraPorAtendente({
  carteiras,
  cursos,
  semCurso,
  /** O fluxo termina em venda? Decide as colunas "Qualificados" e "Ganhos". */
  mostraGanhos,
}: {
  carteiras: Carteira[];
  cursos: CursoContado[];
  semCurso: number;
  mostraGanhos: boolean;
}) {
  const { members } = useTeam();
  const nomes = useMemo(() => new Map(members.map((m) => [m.userId, m.name])), [members]);

  if (carteiras.length === 0) return null;

  // Escala pelo MAIOR e não pelo total: contra o total, cinco atendentes de 10 a
  // 30 leads viram cinco tracinhos indistinguíveis — e comparar entre si é a
  // pergunta do quadro.
  const maior = Math.max(...carteiras.map((c) => c.recebeu), 1);
  const comCurso = cursos.reduce((a, c) => a + c.leads, 0);

  return (
    <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
      <div className="rounded-xl border bg-white p-4">
        <h3 className="text-xs font-semibold text-slate-700">Por atendente</h3>
        <p className="mb-3 text-[11px] text-slate-400">
          Onde os leads do período estão hoje. Quem não é do setor entra em{" "}
          <strong>Outros setores</strong>.
          {mostraGanhos && " “Ganhos” vem da oportunidade mais recente do contato."}
        </p>
        {/* Tabela larga rola no PRÓPRIO container — o corpo da página nunca
            rola de lado. */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-left text-[11px] text-slate-500">
                <th className="pb-2 font-medium">Atendente</th>
                <th className="pb-2 text-right font-medium">Recebeu</th>
                {mostraGanhos && <th className="pb-2 text-right font-medium">Qualificados</th>}
                <th className="pb-2 text-right font-medium">Finalizadas</th>
                {mostraGanhos && <th className="pb-2 text-right font-medium">Ganhos</th>}
                <th className="pb-2 pl-3 font-medium">Cursos marcados</th>
              </tr>
            </thead>
            <tbody>
              {carteiras.map((c) => {
                const top = Object.entries(c.cursos).sort((a, b) => b[1] - a[1]);
                return (
                  <tr key={c.atendente ?? "sem"} className="border-b last:border-0">
                    <td className="py-2 pr-3">
                      <span
                        className={cn(
                          "font-medium",
                          ehPessoa(c.atendente) ? "text-slate-800" : "text-slate-400"
                        )}
                      >
                        {rotulo(c.atendente, nomes)}
                      </span>
                      {/* A barra é do MESMO número da coluna ao lado: realce de
                          grandeza, não uma segunda medida — por isso não tem
                          legenda nem cor categórica. */}
                      <span
                        aria-hidden
                        className="mt-1 block h-1 rounded-full bg-indigo-500/70"
                        style={{ width: `${Math.max((c.recebeu / maior) * 100, 3)}%` }}
                      />
                    </td>
                    <td className="py-2 text-right font-semibold tabular-nums text-slate-900">
                      {c.recebeu}
                    </td>
                    {mostraGanhos && (
                      <td className="py-2 text-right tabular-nums text-slate-600">
                        {c.qualificados}
                      </td>
                    )}
                    <td className="py-2 text-right tabular-nums text-slate-600">{c.finalizadas}</td>
                    {mostraGanhos && (
                      <td className="py-2 text-right font-semibold tabular-nums text-emerald-700">
                        {c.ganhas}
                      </td>
                    )}
                    <td className="py-2 pl-3">
                      {top.length === 0 ? (
                        <span className="text-slate-300">—</span>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {top.slice(0, 2).map(([curso, n]) => (
                            <span
                              key={curso}
                              title={curso}
                              className="max-w-[160px] truncate rounded border bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-600"
                            >
                              {curso} · {n}
                            </span>
                          ))}
                          {top.length > 2 && (
                            <span
                              title={top.map(([nome, n]) => `${nome}: ${n}`).join(" · ")}
                              className="px-1 text-[10px] text-slate-400"
                            >
                              +{top.length - 2}
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border bg-white p-4">
        <h3 className="text-xs font-semibold text-slate-700">Cursos marcados</h3>
        {/*
          ⚠️ **O "sem marcação" vem PRIMEIRO, e é o número mais importante do
          card.** Sem ele, um quadro com 6 leads em MMA sobre 126 pareceria a
          operação inteira, e a conclusão ("quase ninguém quer MMA") seria o
          oposto da verdade ("quase ninguém marcou o curso"). O campo é
          preenchido à mão no card do funil — enquanto a equipe não marcar, este
          quadro mede o PREENCHIMENTO, não a demanda.
        */}
        <p className="mb-3 text-[11px] text-slate-400">
          {comCurso} de {comCurso + semCurso} leads com curso marcado
          {semCurso > 0 && ` — ${semCurso} sem marcação`}.
        </p>
        {cursos.length === 0 ? (
          <p className="text-xs text-slate-400">
            Nenhum lead do período tem curso marcado. O campo fica no card do funil, em Leads.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {cursos.slice(0, 8).map((c) => (
              <li key={c.curso} className="flex items-center gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate text-slate-600" title={c.curso}>
                  {c.curso}
                </span>
                <span
                  aria-hidden
                  className="h-1.5 shrink-0 rounded-full bg-emerald-600/70"
                  style={{ width: `${Math.max((c.leads / cursos[0].leads) * 40, 2)}%` }}
                />
                <span className="w-6 shrink-0 text-right font-semibold tabular-nums text-slate-900">
                  {c.leads}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
