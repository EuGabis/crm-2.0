"use client";

import { useEffect, useMemo, useState } from "react";
import { PeriodoPicker } from "@/components/shared/period-picker";
import { useTeam } from "@/lib/data/repos/db/team";
import {
  SEM_CURSO,
  SEM_RESPONSAVEL,
  agruparPorCurso,
  filtrarPorResponsavel,
  leadsDoCurso,
  totaisDeCurso,
} from "@/lib/reports/cursos";
import { rotuloDoPeriodo, type Periodo } from "@/lib/periodo";
import { type Recorte } from "@/lib/reports/quadro-leads";
import { LeadsDoAtendenteDialog, type LeadDoQuadro } from "./leads-do-atendente-dialog";
import { cn } from "@/lib/utils";

/**
 * O relatório detalhado por CURSO marcado, na aba "Leads do dia".
 *
 * Pedido do Gabriel (2026-09-22): *"adicione a opção de ver um relatório por
 * cursos e a opção de filtro de datas e responsável. Precisamos de um relatório
 * detalhado dos leads de cada curso marcado."* — e, no mesmo dia: *"deixe a
 * opção de clicar nos quentes, frios, finalizados e ganhos. O filtro precisa ser
 * individual desse relatório também."*
 *
 * 🔴 **O período é PRÓPRIO deste card**, e isso reverte a primeira versão (que
 * usava só o seletor do topo da aba). A objeção que eu tinha era real — duas
 * datas na mesma tela se confundem —, então ela virou desenho em vez de
 * impedimento: o card **escreve o período que está mostrando** logo abaixo do
 * título, e o seletor fica ao lado. Sem essa frase, o número aqui seria lido com
 * a data do gráfico lá de cima.
 *
 * ⚠️ **Só busca quando o período local SAI do período da aba.** Enquanto forem
 * iguais, ele usa as linhas que a página já tem — abrir a aba não pode custar
 * duas vezes a mesma consulta. E trocar o período do TOPO remonta o painel
 * inteiro (a `key` da página), então o filtro local volta ao do topo sozinho:
 * sem isso, mudar a data lá em cima deixaria este card preso numa data antiga.
 */
export function RelatorioPorCurso({
  leads: leadsDaAba,
  periodo: periodoDaAba,
  fluxoKey,
  /** O fluxo termina em venda? Decide as colunas "Quentes", "Frios" e "Ganhos". */
  mostraGanhos,
}: {
  leads: LeadDoQuadro[];
  periodo: Periodo;
  fluxoKey: string;
  mostraGanhos: boolean;
}) {
  const { members } = useTeam();
  const nomes = useMemo(() => new Map(members.map((m) => [m.userId, m.name])), [members]);
  const [responsavel, setResponsavel] = useState("");
  const [periodo, setPeriodo] = useState<Periodo>(periodoDaAba);
  const [aberto, setAberto] = useState<{ curso: string; recorte: Recorte } | null>(null);

  const proprio = periodo.de !== periodoDaAba.de || periodo.ate !== periodoDaAba.ate;
  /**
   * O que foi buscado, COM o período a que pertence.
   *
   * ⚠️ Guardar o período junto das linhas é o que permite DERIVAR "está
   * carregando" em vez de manter um `carregando` em estado. Um `setCarregando`
   * no corpo do efeito é `setState` síncrono dentro de efeito — cascata de
   * renderização, e o lint do projeto acusa. Aqui não existe nenhum setState
   * antes do primeiro `await`.
   */
  const [carregado, setCarregado] = useState<{
    de: string;
    ate: string;
    leads: LeadDoQuadro[];
  } | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!proprio) return;
    let ativo = true;
    void (async () => {
      try {
        const res = await fetch(
          `/api/relatorios/leads-diarios?de=${periodo.de}&ate=${periodo.ate}` +
            `&flow=${encodeURIComponent(fluxoKey)}`
        );
        const json = await res.json().catch(() => ({}));
        if (!ativo) return;
        // ⚠️ O motivo VAI para a tela. "Não foi possível carregar" sem `code` já
        // custou uma rodada inteira de investigação neste projeto.
        if (!res.ok) {
          setErro(json?.error ?? "Não foi possível carregar");
          return;
        }
        setErro(null);
        setCarregado({ de: periodo.de, ate: periodo.ate, leads: json.leads ?? [] });
      } catch {
        if (ativo) setErro("Falha de conexão");
      }
    })();
    return () => {
      ativo = false;
    };
    // ⚠️ Sem `eslint-disable` aqui, e é de propósito: nenhum `setState` roda no
    // corpo síncrono do efeito, então a regra não dispara. Um disable que não é
    // mais necessário é uma armadilha — ele calaria a regra no dia em que
    // alguém acrescentasse um setState de verdade logo acima.
  }, [proprio, periodo.de, periodo.ate, fluxoKey]);

  const carregando =
    proprio && !erro && (carregado?.de !== periodo.de || carregado?.ate !== periodo.ate);

  /*
   * ⚠️ Enquanto a busca do período novo não volta, vale a lista ANTERIOR — não
   * uma tela vazia. Trocar a data faria a tabela piscar para "nenhum lead", que
   * se lê como "não houve lead nesse período" e não como "estou buscando".
   */
  const base = proprio ? carregado?.leads ?? leadsDaAba : leadsDaAba;

  /*
   * ⚠️ O seletor lista quem TEM lead no período, não a equipe inteira: um menu
   * com trinta nomes em que vinte e sete devolvem lista vazia ensina que o
   * filtro não funciona. "Sem responsável" só aparece quando existe algum.
   */
  const responsaveis = useMemo(() => {
    const ids = new Set<string>();
    let temSem = false;
    for (const l of base) {
      if (l.atendente) ids.add(l.atendente);
      else temSem = true;
    }
    const lista = [...ids]
      .map((id) => ({ id, nome: nomes.get(id) ?? "Carregando..." }))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    return { lista, temSem };
  }, [base, nomes]);

  const filtrados = useMemo(
    () => filtrarPorResponsavel(base, responsavel),
    [base, responsavel]
  );
  const linhas = useMemo(() => agruparPorCurso(filtrados), [filtrados]);
  const totais = useMemo(() => totaisDeCurso(filtrados), [filtrados]);

  /*
   * A escala é o MAIOR curso, não o total: contra o total, treze cursos de 1 a
   * 88 leads viram treze tracinhos indistinguíveis — e comparar os cursos entre
   * si é a pergunta da tabela.
   *
   * ⚠️ A linha "sem marcação" fica FORA da escala. Ela é quase sempre a maior de
   * todas (5.880 contra 88 no dia do pedido), e deixá-la mandar na régua
   * achataria todos os cursos reais a um pixel.
   */
  const maior = Math.max(...linhas.filter((l) => l.curso !== SEM_CURSO).map((l) => l.recebeu), 1);

  const rotuloDoFiltro =
    responsavel === SEM_RESPONSAVEL
      ? "sem responsável"
      : responsavel
        ? nomes.get(responsavel) ?? "esse responsável"
        : null;

  /**
   * Um número da tabela. Vira botão só quando HÁ o que abrir.
   *
   * ⚠️ Zero não é clicável: abrir lista vazia não responde nada e ensina que o
   * clique às vezes não faz nada — o que tira a confiança nos que funcionam.
   * Mesma regra do quadro por atendente.
   */
  function Numero({
    valor,
    curso,
    recorte,
    className,
  }: {
    valor: number;
    curso: string;
    recorte: Recorte;
    className?: string;
  }) {
    if (valor === 0) return <span className={className}>{valor}</span>;
    return (
      <button
        onClick={() => setAberto({ curso, recorte })}
        title="Ver estes leads"
        className={cn(
          className,
          "rounded px-1 underline decoration-dotted underline-offset-2 hover:bg-indigo-50 hover:text-indigo-700"
        )}
      >
        {valor}
      </button>
    );
  }

  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-xs font-semibold text-slate-700">Relatório por curso</h3>
          {/*
            ⚠️ A frase diz o que a tabela MEDE e DE QUANDO. Sem o período
            escrito, o número aqui seria lido com a data do gráfico lá de cima —
            que é justamente o risco de existirem dois seletores na mesma tela.
            E sem o "de X leads", "88 em Mecânico de Aeronaves" se lê como
            demanda do mercado, quando o número que importa é o outro: quase
            ninguém marca o curso.
          */}
          <p className="text-[11px] text-slate-400">
            {rotuloDoPeriodo(periodo)} · {totais.comCurso} de {totais.total} leads com curso
            marcado
            {totais.semMarcacao > 0 && ` — ${totais.semMarcacao} sem marcação`} ·{" "}
            {totais.cursosDistintos} curso{totais.cursosDistintos === 1 ? "" : "s"} diferente
            {totais.cursosDistintos === 1 ? "" : "s"}. Clique num número para ver os leads.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
            Responsável:
            {/*
              `<select>` nativo, como o de curso no card do funil e o "Atribuir…"
              do Relatório: dá busca por digitação e a rolagem do sistema de
              graça.
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
          <PeriodoPicker periodo={periodo} onChange={setPeriodo} />
        </div>
      </div>

      {erro && (
        <p className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          {erro} — a tabela abaixo é do período anterior.
        </p>
      )}

      {linhas.length === 0 ? (
        <p className="py-6 text-center text-xs text-slate-400">
          {carregando
            ? "Carregando..."
            : rotuloDoFiltro
              ? `Nenhum lead de ${rotuloDoFiltro} no período.`
              : "Nenhum lead no período."}
        </p>
      ) : (
        /* Tabela larga rola no PRÓPRIO container — o corpo da página nunca rola
           de lado. */
        <div className={cn("overflow-x-auto", carregando && "opacity-60")}>
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
                  <tr key={l.curso} className="border-b last:border-0 align-top">
                    <td className="max-w-[260px] py-2 pr-3">
                      <button
                        onClick={() => setAberto({ curso: l.curso, recorte: "recebeu" })}
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
                    <td className="py-2 text-right">
                      <Numero
                        valor={l.recebeu}
                        curso={l.curso}
                        recorte="recebeu"
                        className="font-semibold tabular-nums text-slate-900"
                      />
                    </td>
                    <td className="w-[22%] py-2 pl-3">
                      {/*
                        ⚠️ A marca some na linha "sem marcação", que está fora da
                        escala: desenhá-la com a régua dos cursos daria uma barra
                        estourada, e com régua própria daria uma barra que não
                        compara com nada.
                      */}
                      {!semMarcacao && (
                        <span
                          aria-hidden
                          className="mt-1.5 block h-1.5 rounded-full bg-emerald-600/70"
                          style={{ width: `${Math.max((l.recebeu / maior) * 100, 3)}%` }}
                        />
                      )}
                    </td>
                    {mostraGanhos && (
                      <td className="py-2 text-right">
                        <Numero
                          valor={l.qualificados}
                          curso={l.curso}
                          recorte="qualificados"
                          className="tabular-nums text-emerald-700"
                        />
                      </td>
                    )}
                    {mostraGanhos && (
                      <td className="py-2 text-right">
                        <Numero
                          valor={l.frios}
                          curso={l.curso}
                          recorte="frios"
                          className="tabular-nums text-blue-700"
                        />
                      </td>
                    )}
                    <td className="py-2 text-right">
                      <Numero
                        valor={l.finalizadas}
                        curso={l.curso}
                        recorte="finalizadas"
                        className="tabular-nums text-slate-600"
                      />
                    </td>
                    {mostraGanhos && (
                      <td className="py-2 text-right">
                        <Numero
                          valor={l.ganhas}
                          curso={l.curso}
                          recorte="ganhas"
                          className="font-semibold tabular-nums text-slate-900"
                        />
                      </td>
                    )}
                    <td className="py-2 pl-3">
                      {donos.length === 0 ? (
                        <span className="text-[10px] text-slate-400">ninguém assumiu</span>
                      ) : (
                        /*
                          🔴 **TODOS os responsáveis, não os dois primeiros.** A
                          primeira versão mostrava "+N" e a queixa foi direta:
                          *"não aparece todos os comerciais em Quem está com
                          eles"*. Numa coluna que existe para responder "quem
                          está com os leads deste curso", esconder metade da
                          resposta atrás de um contador é o defeito — e o `title`
                          do "+N" não serve, porque exige descobrir que há algo
                          para passar o mouse em cima.
                        */
                        <span className="flex flex-wrap items-center gap-1">
                          {donos.map(([id, n]) => (
                            <span
                              key={id}
                              title={`${nomes.get(id) ?? id}: ${n}`}
                              className="rounded border bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-600"
                            >
                              {nomes.get(id) ?? "Carregando..."} · {n}
                            </span>
                          ))}
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
          /*
           * ⚠️ O rótulo só é trocado no total ("Leads do curso"); nos recortes
           * vale o texto padrão do diálogo ("Leads qualificados", "Conversas
           * finalizadas"…), que é exatamente o que a coluna clicada diz.
           */
          rotulo={
            aberto.recorte === "recebeu"
              ? aberto.curso === SEM_CURSO
                ? "Leads"
                : "Leads do curso"
              : undefined
          }
          titulo={
            (aberto.curso === SEM_CURSO ? "sem curso marcado" : aberto.curso) +
            (rotuloDoFiltro ? ` · ${rotuloDoFiltro}` : "")
          }
          recorte={aberto.recorte}
          leads={leadsDoCurso(filtrados, aberto.curso)}
        />
      )}
    </div>
  );
}
