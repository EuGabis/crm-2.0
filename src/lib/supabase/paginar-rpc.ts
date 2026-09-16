import type { SupabaseClient } from "@supabase/supabase-js";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Linhas por página. É também o "Max rows" do projeto no PostgREST. */
const PAGINA = 1000;

/**
 * Teto de segurança. A resposta vai INTEIRA para o navegador, e sem teto um
 * período largo numa operação que cresce viraria dezenas de MB. Quando ele
 * morde, quem chama recebe `truncado: true` e a tela DIZ — em vez de mostrar um
 * número redondo com cara de total, que é o defeito que isto conserta.
 */
const MAX_PAGINAS = 12;

/**
 * Chama uma função `returns setof` do Postgres trazendo TODAS as linhas.
 *
 * 🔴 **O PostgREST corta a resposta no "Max rows" do projeto (1000) sem erro e
 * sem aviso — e isso vale também para RPC.** É a armadilha nº 7 deste projeto,
 * e ela reapareceu nos RELATÓRIOS em 16/09/2026: "Leads do dia" mostrava
 * `Entraram 1000` em 30 dias (o total real era 3.296) e o dia 15/09 aparecia com
 * 187 leads dentro do período contra 615 quando filtrado sozinho — porque um dia
 * cabe em mil linhas e trinta não cabem.
 *
 * ⚠️ **Número redondo — 1000, 500, 100 — num total vindo do PostgREST é suspeito
 * até prova em contrário.** Foi um "1000" que denunciou este caso, como já havia
 * denunciado o do log do bot e o dos contatos.
 *
 * 🔴 **Paginar sem ordem ESTÁVEL troca um defeito por outro.** Cada página é uma
 * execução nova da função; se duas linhas empatam no critério de ordenação, a
 * página 2 pode repetir uma e PULAR outra — e a pulada some do relatório.
 * Conferido nas três funções: `triagem_leads` **não tinha `order by` nenhum** na
 * consulta final (ordem totalmente indefinida), e `sla_conversations` e
 * `log_do_bot` ordenavam só por carimbo de tempo, sem desempate.
 *
 * ⚠️ **A ordem é imposta AQUI, pelo PostgREST, e não por migração.** RPC que
 * retorna `setof` aceita `order` como uma tabela, então quem pagina controla a
 * própria ordem — sem reescrever o corpo de três funções `security definer` só
 * para acrescentar uma cláusula. `ordem` termina SEMPRE numa coluna única (um
 * id): é ela que torna a paginação correta por construção, mesmo no dia em que
 * o bot gravar uma rajada de conversas no mesmo microssegundo.
 *
 * Existe como função única, e não copiada em cada rota, porque a cópia seguinte
 * é a que esquece: hoje são três chamadores (`triagem_leads`,
 * `sla_conversations`, `log_do_bot`) e o quarto chega sem ninguém lembrar disto.
 */
export async function paginarRpc(
  supabase: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
  /** Ordenação estável. A ÚLTIMA entrada tem de ser uma coluna única. */
  ordem: { coluna: string; desc?: boolean }[]
): Promise<{ data: any[]; truncado: boolean; error: { code?: string; message?: string } | null }> {
  /*
   * ⚠️ **Dedupe pela coluna única, e ele NÃO é zelo excessivo.** Se por qualquer
   * motivo a ordenação não valer (uma função nova sem a coluna, um `order`
   * ignorado), a paginação volta a repetir linhas — e repetição num relatório
   * INFLA totais, que é tão ruim quanto o corte que isto conserta. Repetição é
   * também o sintoma observável de ordem instável: quando ela aparece, a rota
   * AVISA no log em vez de entregar um número errado em silêncio.
   */
  const chave = ordem[ordem.length - 1]?.coluna;
  const vistos = new Set<string>();
  let repetidas = 0;

  const linhas: any[] = [];
  for (let p = 0; p < MAX_PAGINAS; p++) {
    let q = supabase.rpc(fn, args);
    for (const o of ordem) {
      q = q.order(o.coluna, { ascending: !o.desc, nullsFirst: false });
    }
    const { data, error } = await q.range(p * PAGINA, p * PAGINA + PAGINA - 1);
    if (error) return { data: [], truncado: false, error };
    const veio = data?.length ?? 0;
    for (const linha of (data ?? []) as any[]) {
      if (!chave) {
        linhas.push(linha);
        continue;
      }
      const id = String(linha[chave]);
      if (vistos.has(id)) {
        repetidas++;
        continue;
      }
      vistos.add(id);
      linhas.push(linha);
    }
    // ⚠️ `< PAGINA` e não `=== 0`: página incompleta já é a última, e pedir mais
    // uma seria uma ida e volta a mais em toda carga.
    if (veio < PAGINA) {
      avisar(fn, repetidas);
      return { data: linhas, truncado: false, error: null };
    }
  }
  avisar(fn, repetidas);
  return { data: linhas, truncado: true, error: null };
}

/**
 * Linha repetida entre páginas só acontece se a ordenação não estiver estável —
 * e o preço de não perceber é um relatório com total inflado. O log é o único
 * lugar onde isso pode aparecer, já que a tela não tem como saber.
 */
function avisar(fn: string, repetidas: number) {
  if (repetidas > 0) {
    console.warn(
      `[paginarRpc] ${fn}: ${repetidas} linha(s) repetida(s) entre páginas — ` +
        "a ordenação não está estável. Confira a coluna única passada em `ordem`."
    );
  }
}
