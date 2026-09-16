import { createClient } from "@/lib/supabase/server";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

/** "12 min" · "1h 45min" · "sem dados". */
function fmtMin(min: number | null): string {
  if (min == null) return "sem dados";
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}min` : `${h}h`;
}

/**
 * Desempenho por agente, dados reais (admin).
 *
 * ⚠️ **Era `buildReportSnapshot` e demorava segundos.** Aquele retrato baixa a
 * empresa inteira em páginas de 1000 linhas num LAÇO SEQUENCIAL — medido:
 * 17.449 mensagens em 30 dias = **18 idas e voltas em série** ao Supabase, mais
 * conversas e oportunidades. A 200–400 ms por salto, 4–7 segundos só de espera
 * de rede. E a tela usa 8 campos; os outros 12 do `AtendenteStat` eram
 * calculados e descartados.
 *
 * Agora é UMA chamada a `public.agentes_desempenho` (migração 202609031359), que
 * agrega no Postgres: 13,7 ms na parte agregada, medido com `explain analyze`.
 *
 * ⚠️ `buildReportSnapshot` continua existindo para a **Análise IA**, que precisa
 * do retrato inteiro para montar o prompt. O que mudou é esta aba parar de pagar
 * por ele.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "não autenticado" }, { status: 401 });

  const { data: membership } = await supabase
    .from("location_members")
    .select("location_id, role")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) return Response.json({ error: "empresa não encontrada" }, { status: 400 });
  if (membership.role !== "admin") {
    return Response.json({ error: "apenas administradores" }, { status: 403 });
  }

  const dias = Math.min(365, Math.max(1, Number(new URL(request.url).searchParams.get("dias")) || 30));

  /*
   * ⚠️ **Tempo online vem de uma consulta SEPARADA, e não de dentro de
   * `agentes_desempenho`.** Juntar exigiria reescrever uma função de 13 colunas
   * para acrescentar uma — e `returns table` que muda de forma obriga
   * `drop`+`create`, com o risco que isso traz numa função que a tela inteira
   * depende. Duas fontes casadas na rota é o mesmo desenho já usado aqui para
   * os nomes dos atendentes.
   *
   * ⚠️ **`tempo_online` só existe depois da 202609161400**, e o código vai ao ar
   * ANTES da migração: falhar aqui não pode derrubar a aba, então o erro é
   * engolido e a coluna some — em vez de a tela inteira parar por causa de um
   * campo novo.
   */
  const [{ data, error }, online] = await Promise.all([
    supabase.rpc("agentes_desempenho", {
      p_location: membership.location_id,
      p_dias: dias,
      p_meta_min: 15,
    }),
    supabase
      .rpc("tempo_online", { p_location: membership.location_id, p_dias: dias })
      .then((r) => (r.error ? null : (r.data as any[]))),
  ]);
  if (error) {
    /*
     * ⚠️ **O motivo VAI para a tela, não para o lixo.** A primeira versão
     * respondia só "não foi possível carregar", e foi exatamente isso que
     * aconteceu em 03/09: a função existia, a assinatura batia, `authenticated`
     * tinha EXECUTE — e eu não tinha como saber o que falhou, porque a única
     * informação foi descartada aqui.
     *
     * É o mesmo defeito que custou rodadas no áudio recusado pela Meta (o motivo
     * da falha não era gravado) e o "tente novamente" do contato duplicado.
     * Regra que sai daqui: **erro de RPC sempre carrega o `code` e a `message`
     * do PostgREST.**
     *
     * Os dois mais prováveis, e a conduta de cada um:
     *   - `PGRST202` — a função existe no banco mas não no cache de esquema do
     *     PostgREST. Acontece logo depois de criar a função e some sozinho; um
     *     `notify pgrst, 'reload schema'` força.
     *   - `42501` — falta `grant execute ... to authenticated` (o par da 0080).
     */
    const detalhe = [error.code, error.message].filter(Boolean).join(" · ");
    console.error(
      `[relatorios/agentes] rpc agentes_desempenho falhou: ${detalhe} ` +
        `commit=${(process.env.VERCEL_GIT_COMMIT_SHA ?? "local").slice(0, 7)}`
    );
    return Response.json(
      { error: `Não foi possível carregar: ${detalhe || "erro desconhecido"}` },
      { status: 500 }
    );
  }

  const porUsuario = online
    ? new Map(
        online.map((r: any) => [
          r.usuario as string,
          { minutos: Number(r.minutos ?? 0), desde: (r.desde as string | null) ?? null },
        ])
      )
    : null;
  /*
   * ⚠️ Quem TEM medida e não aparece na lista ficou zero minutos online — isso é
   * informação. Quem não tem medida nenhuma (a migração não rodou) recebe
   * `null`, e a tela escreve "—" em vez de um zero que acusaria a pessoa.
   */
  const minutosDe = (id: string): number | null =>
    porUsuario ? porUsuario.get(id)?.minutos ?? 0 : null;

  const agentes = (data ?? [])
    .map((r: any) => ({
      userId: r.user_id,
      nome: r.nome,
      papel: r.papel,
      departamento: r.departamento,
      conversas_atribuidas: Number(r.conversas_atribuidas ?? 0),
      // A mediana vem como numeric (string no PostgREST) — Number() antes de usar.
      resposta_tipica_min: r.mediana_resposta_min == null ? null : Number(r.mediana_resposta_min),
      resposta_tipica: fmtMin(r.mediana_resposta_min == null ? null : Number(r.mediana_resposta_min)),
      respostas_medidas: Number(r.respostas_medidas ?? 0),
      nao_respondidas: Number(r.nao_respondidas ?? 0),
      templates_enviados_30d: Number(r.templates_30d ?? 0),
      mensagens_enviadas: Number(r.mensagens_enviadas ?? 0),
      ganhos: Number(r.ganhos ?? 0),
      perdidos: Number(r.perdidos ?? 0),
      receita_ganha: Number(r.receita_ganha ?? 0),
      /*
       * Minutos em que a pessoa esteve ONLINE no período. `null` = não há
       * medida — e null NÃO é zero: zero afirma que ela não abriu o CRM, null
       * diz que ninguém mediu. A distinção importa porque o histórico começa na
       * 202609161400 e não existe passado para reconstruir.
       */
      minutos_online: minutosDe(r.user_id),
      /** Desde quando há medida para esta pessoa (ISO), ou null. */
      online_desde: porUsuario?.get(r.user_id)?.desde ?? null,
    }))
    // Mais ativo primeiro.
    .sort((a: any, b: any) => b.conversas_atribuidas - a.conversas_atribuidas);

  return Response.json({ agentes, dias });
}
