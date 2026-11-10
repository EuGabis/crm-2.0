import { createClient } from "@/lib/supabase/server";
import { ehDiaValido, hojeSP } from "@/lib/periodo";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

/**
 * Relatório comercial (pedido da diretoria, 10/11/2026): por vendedor e por
 * período, o que ele recebeu, perdeu, vendeu e o que está com ele agora.
 * Uma chamada a `public.relatorio_comercial` (migração 202611101500), que é
 * `security definer` com checagem de admin na primeira linha. A rota confere
 * admin de novo, e o erro do PostgREST vai para a tela com code e message.
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
  if (!ehDiaValido(de) || !ehDiaValido(ate) || de > ate) {
    return Response.json({ error: "período inválido" }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("relatorio_comercial", {
    p_location: membership.location_id,
    p_de: de,
    p_ate: ate,
  });
  if (error) {
    const detalhe = [error.code, error.message].filter(Boolean).join(" · ");
    console.error(`[relatorios/comercial] rpc falhou: ${detalhe}`);
    return Response.json(
      {
        error:
          error.code === "PGRST202"
            ? "A função do relatório ainda não foi criada no banco (aplicar a migração 202611101500)."
            : `Não foi possível carregar: ${detalhe}`,
      },
      { status: 500 }
    );
  }

  const linhas = ((data ?? []) as any[]).map((r) => ({
    usuario: r.usuario as string,
    nome: r.nome as string,
    departamento: (r.departamento as string | null) ?? null,
    recebidos: Number(r.recebidos ?? 0),
    quentes: Number(r.quentes ?? 0),
    frios: Number(r.frios ?? 0),
    perdidos_espera: Number(r.perdidos_espera ?? 0),
    com_ele_agora: Number(r.com_ele_agora ?? 0),
    sem_resposta: Number(r.sem_resposta ?? 0),
    pendentes: Number(r.pendentes ?? 0),
    ganhos_funil: Number(r.ganhos_funil ?? 0),
    perdidos_funil: Number(r.perdidos_funil ?? 0),
    vendas_guru: Number(r.vendas_guru ?? 0),
    receita_guru: Number(r.receita_guru ?? 0),
  }));

  return Response.json({ periodo: { de, ate }, linhas });
}
