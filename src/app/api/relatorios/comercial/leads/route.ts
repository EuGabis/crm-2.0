import { createClient } from "@/lib/supabase/server";
import { ehDiaValido, hojeSP } from "@/lib/periodo";
import { paginarRpc } from "@/lib/supabase/paginar-rpc";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

const METRICAS = new Set([
  "recebidos", "quentes", "frios", "perdidos_espera", "com_ele_agora", "sem_resposta",
  "pendentes", "ganhos_funil", "perdidos_funil", "vendas_guru",
]);

/**
 * Leads por trás de um número do Relatório comercial
 * (`public.relatorio_comercial_leads`, migração 202611101600). Paginado:
 * a carteira de um vendedor passa de 6 mil conversas e RPC também é cortada em
 * 1000 linhas sem aviso.
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

  const url = new URL(request.url);
  const de = url.searchParams.get("de") ?? hojeSP();
  const ate = url.searchParams.get("ate") ?? hojeSP();
  const usuario = url.searchParams.get("usuario") ?? "";
  const metrica = url.searchParams.get("metrica") ?? "";
  if (!ehDiaValido(de) || !ehDiaValido(ate) || de > ate || !usuario || !METRICAS.has(metrica)) {
    return Response.json({ error: "parâmetros inválidos" }, { status: 400 });
  }

  const { data, truncado, error } = await paginarRpc(
    supabase,
    "relatorio_comercial_leads",
    { p_location: membership.location_id, p_de: de, p_ate: ate, p_usuario: usuario, p_metrica: metrica },
    [{ coluna: "quando", desc: true }, { coluna: "ref" }]
  );
  if (error) {
    const detalhe = [error.code, error.message].filter(Boolean).join(" · ");
    return Response.json(
      {
        error:
          error.code === "PGRST202"
            ? "A lista ainda não foi criada no banco (aplicar a migração 202611101600)."
            : `Não foi possível carregar: ${detalhe}`,
      },
      { status: 500 }
    );
  }

  const leads = (data as any[]).map((r) => ({
    ref: r.ref as string,
    conversationId: (r.conversation_id as string | null) ?? null,
    contactId: (r.contact_id as string | null) ?? null,
    contato: (r.contato as string | null) || "Sem nome",
    telefone: (r.telefone as string | null) ?? null,
    email: (r.email as string | null) ?? null,
    quando: (r.quando as string | null) ?? null,
    detalhe: (r.detalhe as string | null) ?? "",
    chave: (r.chave as string | null) ?? null,
    valor: r.valor == null ? null : Number(r.valor),
  }));
  return Response.json({ leads, truncado });
}
