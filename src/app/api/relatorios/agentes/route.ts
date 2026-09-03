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

  const { data, error } = await supabase.rpc("agentes_desempenho", {
    p_location: membership.location_id,
    p_dias: dias,
    p_meta_min: 15,
  });
  if (error) {
    return Response.json({ error: "não foi possível carregar" }, { status: 500 });
  }

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
    }))
    // Mais ativo primeiro.
    .sort((a: any, b: any) => b.conversas_atribuidas - a.conversas_atribuidas);

  return Response.json({ agentes, dias });
}
