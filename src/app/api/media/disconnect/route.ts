import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { MediaProvider } from "@/lib/integrations/media-oauth";

export const dynamic = "force-dynamic";

/** Desconecta Google Drive ou Canva. Só admin (a RLS da 0045 reforça). */
export async function POST(request: Request) {
  const { provider } = (await request.json().catch(() => ({}))) as {
    provider?: MediaProvider;
  };
  if (provider !== "google_drive" && provider !== "canva") {
    return Response.json({ error: "provider inválido" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Não autenticado" }, { status: 401 });

  const { data: membership } = await supabase
    .from("location_members")
    .select("location_id, role")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) return Response.json({ error: "Empresa não encontrada" }, { status: 404 });
  if (membership.role !== "admin") {
    return Response.json({ error: "Apenas administradores" }, { status: 403 });
  }

  // Service role: a tabela guarda token e é admin-only; a autorização já foi
  // feita acima com a sessão.
  const db = createAdminClient();
  const { error } = await db
    .from("media_connections")
    .delete()
    .eq("location_id", membership.location_id)
    .eq("provider", provider);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
