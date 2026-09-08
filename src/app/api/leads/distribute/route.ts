import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { distributeDepartment, filaProntaDoSetor } from "@/lib/leads/distribution";

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

    /*
     * ⚠️ Passou a usar `filaProntaDoSetor`, a MESMA leitura da varredura de
     * minuto, e não uma consulta própria. A consulta que estava aqui não olhava a
     * sessão do bot: o botão do admin podia distribuir conversa com a triagem EM
     * CURSO, e como `assignLeadTo` põe `bot_paused = true`, isso CALA o bot e
     * entrega ao atendente uma conversa sem nome, sem e-mail e sem assunto.
     *
     * ⚠️ Ela também não filtrava `closed_at`/`archived_at`: conversa finalizada
     * com a flag de fila para trás voltava para a caixa de alguém ao clicar no
     * botão.
     *
     * O teto é alto de propósito (o do tique é 25): aqui é uma ação DELIBERADA
     * do admin, que quer justamente esvaziar o acumulado de uma vez.
     */
    const { prontas } = await filaProntaDoSetor(db, locationId, channelIds, 1000);
    if (!prontas.length) continue;

    distributed += await distributeDepartment(db, locationId, dep.id, prontas, fraction);
  }

  return Response.json({ distributed });
}
