import { createClient } from "@/lib/supabase/server";
import { canAccess } from "@/lib/auth/module-access";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

/**
 * Leads que entraram por dia, e quantos o bot qualificou.
 *
 * A régua é a do fluxo: o nó `score` soma os pesos das respostas e, a partir do
 * limiar (**9** na Triagem Comercial), marca o lead como `quente`. Quem fica
 * abaixo é `frio`; quem abandonou a triagem antes do nó não tem classificação.
 *
 * ⚠️ **Lê `bot_qualificacoes`, não `bot_sessions`** — ver a migração
 * 202609031728. Sessão é apagada quando a conversa finalizada reabre, e um
 * relatório diário lido de lá encolheria o passado.
 *
 * ⚠️ **Não é admin-only**: vale a permissão do módulo `relatorios`, como a aba
 * de Atendimento. E a checagem que importa é ESTA, no servidor — a função é
 * `security definer`, então esconder a aba na tela não seria proteção.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "não autenticado" }, { status: 401 });

  const { data: membership } = await supabase
    .from("location_members")
    .select("location_id, role, permissions, department_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) return Response.json({ error: "empresa não encontrada" }, { status: 400 });

  const { data: deps } = await supabase
    .from("departments")
    .select("id, name, permissions")
    .eq("location_id", membership.location_id);

  if (!canAccess("relatorios", membership as any, (deps ?? []) as any)) {
    return Response.json({ error: "sem acesso a relatórios" }, { status: 403 });
  }

  const url = new URL(request.url);
  const dias = Math.min(180, Math.max(1, Number(url.searchParams.get("dias")) || 30));
  // `flow` vazio = todos os fluxos. A tela manda "triagem" (Triagem Comercial).
  const flow = url.searchParams.get("flow") || null;

  const hoje = new Date();
  const de = new Date(hoje);
  de.setDate(de.getDate() - (dias - 1));
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  const { data, error } = await supabase.rpc("relatorio_leads_diario", {
    p_location: membership.location_id,
    p_de: iso(de),
    p_ate: iso(hoje),
    p_flow: flow,
  });
  if (error) {
    /*
     * ⚠️ O motivo VAI para a tela. Uma rota que respondia só "não foi possível
     * carregar" custou uma rodada inteira em 03/09 — a função existia, os grants
     * estavam certos, e o `42804` (tipo divergente no `returns table`) só
     * apareceu depois de o `code` ser exposto.
     */
    const detalhe = [error.code, error.message].filter(Boolean).join(" · ");
    console.error(`[relatorios/leads-diarios] rpc falhou: ${detalhe}`);
    return Response.json({ error: `Não foi possível carregar: ${detalhe}` }, { status: 500 });
  }

  const linhas = (data ?? []).map((r: any) => ({
    dia: r.dia as string,
    entraram: Number(r.entraram ?? 0),
    qualificados: Number(r.qualificados ?? 0),
    frios: Number(r.frios ?? 0),
    semClassificacao: Number(r.sem_classificacao ?? 0),
    // numeric do PostgREST chega como string.
    pontosMedio: r.pontos_medio == null ? null : Number(r.pontos_medio),
  }));

  const total = linhas.reduce(
    (a: any, l: any) => ({
      entraram: a.entraram + l.entraram,
      qualificados: a.qualificados + l.qualificados,
      frios: a.frios + l.frios,
      semClassificacao: a.semClassificacao + l.semClassificacao,
    }),
    { entraram: 0, qualificados: 0, frios: 0, semClassificacao: 0 },
  );

  return Response.json({ linhas, total, dias, flow });
}
