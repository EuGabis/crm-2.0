import { createAdminClient } from "@/lib/supabase/admin";
import { distributeDepartment } from "@/lib/leads/distribution";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Nunca cachear: é o batimento da varredura. */
export const dynamic = "force-dynamic";

/**
 * Varredura horária de distribuição (Etapa B). Chamada pelo pg_cron com o
 * cabeçalho `x-automation-secret`. Para cada departamento com varredura ligada,
 * pega os leads "aguardando distribuição" (quentes que ficaram sem ninguém online)
 * dos números do departamento e escoa `sweep_pct`% deles, em rodízio, para quem
 * estiver online AGORA. Independe da distribuição em tempo real.
 */
export async function POST(request: Request) {
  const expected = process.env.AUTOMATION_SECRET;
  if (!expected) {
    return Response.json({ error: "varredura não configurada (AUTOMATION_SECRET)" }, { status: 503 });
  }
  const secret = request.headers.get("x-automation-secret");
  if (!secret || secret !== expected) {
    return Response.json({ error: "não autorizado" }, { status: 401 });
  }

  let db: any;
  try {
    db = createAdminClient();
  } catch {
    return Response.json({ error: "sem credenciais no servidor" }, { status: 503 });
  }

  const { data: deps } = await db
    .from("departments")
    .select("id, location_id, sweep_pct")
    .eq("sweep_enabled", true);

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
      .eq("location_id", dep.location_id)
      .eq("awaiting_distribution", true)
      .in("channel_id", channelIds)
      .order("last_message_at", { ascending: true });
    if (!convs?.length) continue;

    distributed += await distributeDepartment(
      db,
      dep.location_id,
      dep.id,
      convs,
      (dep.sweep_pct ?? 30) / 100,
    );
  }

  return Response.json({ distributed });
}
