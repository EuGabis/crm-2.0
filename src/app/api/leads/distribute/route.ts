import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { distributeDepartment } from "@/lib/leads/distribution";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

/**
 * Distribuição MANUAL disparada pelo admin (Etapa B, painel do Relatório).
 * Distribui os leads "aguardando distribuição" da empresa, em rodízio, para quem
 * estiver online — `pct`% deles (100 = todos). Valida a sessão e exige admin.
 */
export async function POST(request: Request) {
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

  const body = await request.json().catch(() => ({}));
  const pct = Math.min(100, Math.max(1, Number(body?.pct) || 100));
  const fraction = pct / 100;
  const locationId = membership.location_id;

  let db: any;
  try {
    db = createAdminClient();
  } catch {
    return Response.json({ error: "sem credenciais no servidor" }, { status: 503 });
  }

  const { data: deps } = await db.from("departments").select("id").eq("location_id", locationId);
  let distributed = 0;
  for (const dep of deps ?? []) {
    const { data: dcs } = await db
      .from("department_channels")
      .select("channel_id")
      .eq("department_id", dep.id);
    const channelIds = (dcs ?? []).map((d: any) => d.channel_id);
    if (!channelIds.length) continue;

    const { data: convs } = await db
      .from("conversations")
      .select("id, contact_id")
      .eq("location_id", locationId)
      .eq("awaiting_distribution", true)
      .in("channel_id", channelIds)
      .order("last_message_at", { ascending: true });
    if (!convs?.length) continue;

    distributed += await distributeDepartment(db, locationId, dep.id, convs, fraction);
  }

  return Response.json({ distributed });
}
