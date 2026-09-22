"use client";

import { useMemo, useState } from "react";
import { useTeam } from "@/lib/data/repos/db/team";
import {
  SEM_CURSO,
  SEM_RESPONSAVEL,
  agruparPorCurso,
  filtrarPorResponsavel,
  leadsDoCurso,
  totaisDeCurso,
} from "@/lib/reports/cursos";
import { LeadsDoAtendenteDialog, type LeadDoQuadro } from "./leads-do-atendente-dialog";
import { cn } from "@/lib/utils";

/**
 * O relatório detalhado por CURSO marcado, na aba "Leads do dia".
 *
 * Pedido do Gabriel (2026-09-22): *"adicione a opção de ver um relatório por
 * cursos e a opção de filtro de datas e responsável. Precisamos de um relatório
 * detalhado dos leads de cada curso marcado."*
 *
 * ⚠️ **O filtro de DATAS é o do topo da aba** (o `PeriodoPicker` que já existe),
 * e é de propósito: um segundo seletor de período aqui dentro criaria duas
 * verdades na mesma tela — o gráfico diário falando de uma semana e a tabela de
 * cursos de outra, sem nada avisando. O de RESPONSÁVEL é local porque é o único
 * dos dois que não faz sentido nos outros cards: aplicá-lo ao quadro "Por
 * atendente" — que existe justamente para comparar atendentes — o reduziria a
 * uma linha.
 *
 * ⚠️ **Tudo sai das MESMAS linhas que a rota já mandou** (`leads`), não de uma
 * chamada nova. Além de o filtro responder na hora, é o que garante que este
 * relatório e o card "Cursos marcados" logo acima contem a mesma coisa.
 */
export function RelatorioPorCurso({
  leads,
  /** O fluxo termina em venda? Decide as colunas "Qualificados", "Frios" e "Ganhos". */
  mostraGanhos,
}: {
  leads: LeadDoQuadro[];
  mostraGanhos: boolean;
}) {
  const { members } = useTeam();
  const nomes = useMemo(() => new Map(members.map((m) => [m.userId, m.name])), [members]);
  const [responsavel, setResponsavel] = useState("");
  const [aberto, setAberto] = useState<string | null>(null);

  /*
   * ⚠️ O seletor lista quem TEM lead no período, não a equipe inteira: um menu
   * com trinta nomes em que vinte e sete devolvem lista vazia ensina que o
   * filtro não funciona. "Sem responsável" só aparece quando existe algum.
   */
  const responsaveis = useMemo(() => {
    const ids = new Set<string>();
    let temSem = false;
    for (const l of leads) {
      if (l.atendente) ids.add(l.atendente);
      else temSem = true;
    }
    const lista = [...ids]
      .map((id) => ({ id, nome: nomes.get(id) ?? "Carregando..." }))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    return { lista, temSem };
  }, [leads, nomes]);

  const filtrados = useMemo(
    () => filtrarPorResponsavel(leads, responsavel),
    [leads, responsavel]
  );
  const linhas = useMemo(() => agruparPorCurso(filtrados), [filtrados]);
  const totais = useMemo(() => totaisDeCurso(filtrados), [filtrados]);

  /*
   * A escala é o MAIOR curso, não o total: contra o total, oito cursos de 6 a 88
   * leads viram oito tracinhos indistinguíveis — e comparar os cursos entre si é
   * a pergunta da tabela. Mesma decisão do quadro por atendente.
   *
   * ⚠️ A linha "sem marcação" fica FORA da escala. Ela costuma ser a maior de
   * todas (184 de 6.052 no dia do pedido), e deixá-la mandar na régua achataria
   * todos os cursos reais a um pixel.
   */
  const maior = Math.max(...linhas.filter((l) => l.curso !== SEM_CURSO).map((l) => l.recebeu), 1);

  const rotuloDoFiltro =
    responsavel === SEM_RESPONSAVEL
      ? "sem responsável"
      : responsavel
        ? nomes.get(responsavel) ?? "esse responsável"
        : null;

  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-xs font-semibold text-slate-700">Relatório por curso</h3>
          {/*
            ⚠️ A frase diz o que a tabela MEDE. Sem ela, "88 em Mecânico de
            Aeronaves" se lê como demanda do mercado, quando o número que importa
            é o outro: quase ninguém marca o curso. O campo é preenchido à mão no
            card do funil — enquanto a equipe não marcar, isto mede o
            PREENCHIMENTO.
          */}
          <p className="text-[11px] text-slate-400">
            {totais.comCurso} de {totais.total} leads do período com curso marcado
            {totais.semMarcacao > 0 && ` — ${totais.semMarcacao} sem marcação`} ·{" "}
            {totais.cursosDistintos} curso{totais.cursosDistintos === 1 ? "" : "s"} diferente
            {totais.cursosDistintos === 1 ? "" : "s"}. Clique para ver os leads.
          </p>
        </div>
        <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
          Responsável:
          {/*
            `<select>` nativo, como o de curso no card do funil e o "Atribuir…"
            do Relatório: dá busca por digitação e a rolagem do sistema de graça.
          */}
          <select
            value={responsavel}
            onChange={(e) => setResponsavel(e.target.value)}
            className="h-7 rounded-md border bg-white px-2 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          >
            <option value="">Todos</option>
            {responsaveis.lista.map((r) => (
              <option key={r.id} value={r.id}>
                {r.nome}
              </option>
            ))}
            {responsaveis.temSem && <option value={SEM_RESPONSAVEL}>Sem responsável</option>}
          </select>
        </label>
      </div>

      {linhas.length === 0 ? (
        <p className="py-6 text-center text-xs text-slate-400">
          {rotuloDoFiltro
            ? `Nenhum lead de ${rotuloDoFiltro} no período.`
            : "Nenhum lead no período."}
        </p>
      ) : (
        /* Tabela larga rola no PRÓPRIO container — o corpo da página nunca rola
           de lado. */
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-left text-[11px] text-slate-500">
                <th className="pb-2 font-medium">Curso</th>
                <th className="pb-2 text-right font-medium">Leads</th>
                <th className="pb-2 pl-3 font-medium" />
                {mostraGanhos && <th className="pb-2 text-right font-medium">Quentes</th>}
                {mostraGanhos && <th className="pb-2 text-right font-medium">Frios</th>}
                <th className="pb-2 text-right font-medium">Finalizadas</th>
                {mostraGanhos && <th className="pb-2 text-right font-medium">Ganhos</th>}
                <th className="pb-2 pl-3 font-medium">Quem está com eles</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => {
                const semMarcacao = l.curso === SEM_CURSO;
                const donos = Object.entries(l.porAtendente).sort((a, b) => b[1] - a[1]);
                return (
                  <tr key={l.curso} className="border-b last:border-0">
                    <td className="max-w-[260px] py-2 pr-3">
                      <button
                        onClick={() => setAberto(l.curso)}
                        title={
                          semMarcacao
                            ? "Ver os leads que estão sem curso marcado"
                            : `Ver os leads de ${l.curso}`
                        }
                        className={cn(
                          "block max-w-full truncate rounded text-left underline decoration-dotted underline-offset-2",
                          semMarcacao
                            ? "italic text-slate-400 hover:text-slate-600"
                            : "font-medium text-slate-700 hover:text-indigo-700"
                        )}
                      >
                        {semMarcacao ? "Sem curso marcado" : l.curso}
                      </button>
                    </td>
                    <td className="py-2 text-right font-semibold tabular-nums text-slate-900">
                      {l.recebeu}
                    </td>
                    <td className="w-[28%] py-2 pl-3">
                      {/*
                        ⚠️ A marca some na linha "sem marcação", que está fora da
                        escala: desenhá-la com a régua dos cursos daria uma barra
                        estourada, e com régua própria daria uma barra que não
                        compara com nada.
                      */}
                      {!semMarcacao && (
                        <span
                          aria-hidden
                          className="block h-1.5 rounded-full bg-emerald-600/70"
                          style={{ width: `${Math.max((l.recebeu / maior) * 100, 3)}%` }}
                        />
                      )}
                    </td>
                    {mostraGanhos && (
                      <td className="py-2 text-right tabular-nums text-emerald-700">
                        {l.qualificados}
                      </td>
                    )}
                    {mostraGanhos && (
                      <td className="py-2 text-right tabular-nums text-blue-700">{l.frios}</td>
                    )}
                    <td className="py-2 text-right tabular-nums text-slate-600">
                      {l.finalizadas}
                    </td>
                    {mostraGanhos && (
                      <td className="py-2 text-right font-semibold tabular-nums text-slate-900">
                        {l.ganhas}
                      </td>
                    )}
                    <td className="py-2 pl-3">
                      {donos.length === 0 ? (
                        <span className="text-[10px] text-slate-400">ninguém assumiu</span>
                      ) : (
                        <span className="flex flex-wrap items-center gap-1">
                          {donos.slice(0, 2).map(([id, n]) => (
                            <span
                              key={id}
                              className="max-w-[150px] truncate rounded border bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-600"
                            >
                              {nomes.get(id) ?? "Carregando..."} · {n}
                            </span>
                          ))}
                          {donos.length > 2 && (
                            <span
                              title={donos
                                .map(([id, n]) => `${nomes.get(id) ?? id}: ${n}`)
                                .join(" · ")}
                              className="px-1 text-[10px] text-slate-400"
                            >
                              +{donos.length - 2}
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
      )}

      {/* Montado só quando aberto: o diálogo filtra a lista inteira, e fazer
          isso para cada linha da tabela seria trabalho jogado fora. */}
      {aberto && (
        <LeadsDoAtendenteDialog
          open
          onOpenChange={(v) => !v && setAberto(null)}
          rotulo={aberto === SEM_CURSO ? "Leads sem curso marcado" : "Leads do curso"}
          titulo={
            aberto === SEM_CURSO
              ? rotuloDoFiltro ?? "todos os responsáveis"
              : `${aberto}${rotuloDoFiltro ? ` · ${rotuloDoFiltro}` : ""}`
          }
          recorte="recebeu"
          leads={leadsDoCurso(filtrados, aberto)}
        />
      )}
    </div>
  );
}
