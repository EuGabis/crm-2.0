/**
 * Núcleo da distribuição de leads (rodízio). Usado em 2 lugares:
 *  - tempo real: o nó `distribute` do bot, quando o lead vira quente;
 *  - manual: /api/leads/distribute (admin) força a distribuição dos "aguardando".
 * Roda sempre com um client de service role (ignora RLS). Presença = ≤ 5 min.
 */
import { normalize } from "@/lib/bot/types";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const PRESENCE_MS = 5 * 60 * 1000;

/** Status da oportunidade deduzido do nome da etapa (igual ao pipeline.ts). */
function statusForStageName(name: string): "open" | "won" | "lost" {
  const n = (name ?? "").toUpperCase();
  if (n.includes("PERDID")) return "lost";
  if (n.includes("ASSINOU") || n.includes("GANHO") || n.includes("GANHA")) return "won";
  return "open";
}

/** Departamento vinculado a um número (o primeiro, se houver mais de um). */
export async function channelDepartmentId(db: any, channelId: string): Promise<string | null> {
  const { data } = await db
    .from("department_channels")
    .select("department_id")
    .eq("channel_id", channelId)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  return data?.department_id ?? null;
}

/** Pool + cursor do departamento. Pool vazio = todos os membros do departamento. */
export async function departmentPool(
  db: any,
  locationId: string,
  deptId: string,
): Promise<{ pool: string[]; cursor: number }> {
  const { data: dep } = await db
    .from("departments")
    .select("lead_pool, rr_cursor")
    .eq("id", deptId)
    .maybeSingle();
  let pool: string[] = dep?.lead_pool ?? [];
  if (!pool.length) {
    const { data: mem } = await db
      .from("location_members")
      .select("user_id")
      .eq("location_id", locationId)
      .eq("department_id", deptId);
    pool = (mem ?? []).map((m: any) => m.user_id);
  }
  return { pool, cursor: dep?.rr_cursor ?? 0 };
}

/** Quais desses user_ids estão online (last_seen_at ≤ 5 min), na ordem do pool. */
export async function onlineOrdered(
  db: any,
  locationId: string,
  pool: string[],
): Promise<string[]> {
  if (!pool.length) return [];
  const since = new Date(Date.now() - PRESENCE_MS).toISOString();
  const { data } = await db
    .from("location_members")
    .select("user_id")
    .eq("location_id", locationId)
    .in("user_id", pool)
    .gte("last_seen_at", since);
  const online = new Set((data ?? []).map((m: any) => m.user_id));
  return pool.filter((u) => online.has(u));
}

/** Funil de leads para setar o dono do card: por nome, senão pelas etapas típicas. */
async function leadsPipelineId(
  db: any,
  locationId: string,
  pipelineName?: string,
): Promise<string | null> {
  const { data: pipelines } = await db
    .from("pipelines")
    .select("id, name, position")
    .eq("location_id", locationId)
    .order("position");
  if (!pipelines?.length) return null;
  if (pipelineName) {
    const byName = pipelines.find((p: any) => normalize(p.name).includes(normalize(pipelineName)));
    if (byName) return byName.id;
  }
  const { data: stages } = await db
    .from("stages")
    .select("name, pipeline_id")
    .in("pipeline_id", pipelines.map((p: any) => p.id));
  const hints = ["quente", "novo lead"];
  let best: any = null;
  let bestScore = -1;
  for (const p of pipelines) {
    const names = (stages ?? [])
      .filter((s: any) => s.pipeline_id === p.id)
      .map((s: any) => normalize(s.name));
    const score = hints.reduce((a, h) => a + (names.some((n: string) => n.includes(h)) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return (bestScore > 0 ? best : pipelines[0]).id;
}

/** Atribui o lead ao atendente: conversa + dono do card no funil de leads. */
export async function assignLeadTo(
  db: any,
  p: { conversationId: string; contactId: string; locationId: string; pipelineName?: string },
  userId: string,
  offline = false,
) {
  await db
    .from("conversations")
    .update({
      assigned_to: userId,
      bot_paused: true,
      awaiting_distribution: false,
      // caiu enquanto o atendente estava offline → aparece na aba "Offline" dele
      assigned_offline: offline,
    })
    .eq("id", p.conversationId);
  const pid = await leadsPipelineId(db, p.locationId, p.pipelineName);
  if (!pid) return;
  const { data: opp } = await db
    .from("opportunities")
    .select("id, stage_id, name")
    .eq("contact_id", p.contactId)
    .eq("pipeline_id", pid)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (opp) await db.from("opportunities").update({ owner_id: userId }).eq("id", opp.id);
}

/**
 * Escolhe UM atendente do departamento por rodízio e atribui a conversa.
 * Regra: se ALGUÉM está online, distribui só entre os online (rodízio). Se TODOS
 * estão offline, distribui igualitário entre todos do pool e marca "offline".
 * Avança o cursor. Retorna o user escolhido ou null (sem pool = aguardando).
 */
export async function distributeOne(
  db: any,
  args: {
    locationId: string;
    deptId: string;
    conversationId: string;
    contactId: string;
    pipelineName?: string;
  },
): Promise<string | null> {
  const { pool, cursor } = await departmentPool(db, args.locationId, args.deptId);
  if (!pool.length) return null; // sem pool/departamento → segura (aguardando)
  const online = await onlineOrdered(db, args.locationId, pool);
  const offline = online.length === 0;
  const list = offline ? pool : online; // todos off → todos entram no rodízio
  const user = list[cursor % list.length];
  await db.from("departments").update({ rr_cursor: cursor + 1 }).eq("id", args.deptId);
  await assignLeadTo(
    db,
    {
      conversationId: args.conversationId,
      contactId: args.contactId,
      locationId: args.locationId,
      pipelineName: args.pipelineName,
    },
    user,
    offline,
  );
  return user;
}

/**
 * Distribui uma fração dos leads "aguardando" de um departamento entre os online,
 * em rodízio. `fraction` 1 = todos; 0.3 = 30%. Retorna quantos foram atribuídos.
 */
export async function distributeDepartment(
  db: any,
  locationId: string,
  deptId: string,
  convs: { id: string; contact_id: string }[],
  fraction: number,
): Promise<number> {
  if (!convs.length) return 0;
  const { pool, cursor } = await departmentPool(db, locationId, deptId);
  const online = await onlineOrdered(db, locationId, pool);
  if (!online.length) return 0;

  const take = Math.min(convs.length, Math.max(1, Math.ceil(convs.length * fraction)));
  for (let i = 0; i < take; i++) {
    const conv = convs[i];
    const user = online[(cursor + i) % online.length];
    await assignLeadTo(
      db,
      {
        conversationId: conv.id,
        contactId: conv.contact_id,
        locationId,
        pipelineName: "Controle de Leads",
      },
      user,
    );
  }
  await db.from("departments").update({ rr_cursor: cursor + take }).eq("id", deptId);
  return take;
}

export { statusForStageName };
