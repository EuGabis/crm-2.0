import { createClient } from "@/lib/supabase/server";
import { buildReportSnapshot } from "@/lib/reports/snapshot";

export const dynamic = "force-dynamic";

/**
 * Desempenho por agente com dados REAIS (admin): conversas atribuídas, tempo
 * médio de resposta, oportunidades ganhas/perdidas e receita. Mesma base da
 * Análise IA (buildReportSnapshot). RLS de admin enxerga tudo da location.
 */
export async function GET() {
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

  const snapshot = await buildReportSnapshot(supabase, membership.location_id);
  // Ordena por conversas atribuídas (mais ativo primeiro).
  const agentes = [...snapshot.atendentes].sort(
    (a, b) => b.conversas_atribuidas - a.conversas_atribuidas,
  );
  return Response.json({ agentes, periodo: snapshot.periodo });
}
