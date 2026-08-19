/**
 * Retrato REAL da operação para os relatórios (Análise IA e Desempenho por
 * agente). Roda no servidor com o client da SESSÃO — a RLS de admin já enxerga
 * tudo da location. Métricas de mensagens = últimos 30 dias; oportunidades e
 * conversas = estado atual.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

export const REPORT_WINDOW_DAYS = 30;
// Deltas cliente→resposta acima disso são "no dia seguinte"/ruído.
const MAX_RESPONSE_MIN = 24 * 60;

export function fmtMin(min: number | null): string | null {
  if (min == null) return null;
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h}h ${m}min` : `${h}h`;
}

// Dia no fuso de São Paulo (YYYY-MM-DD) — para "hoje"/"ontem" baterem com o
// relógio do usuário, não com UTC.
function brDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

export interface AtendenteStat {
  userId: string;
  nome: string;
  papel: string;
  departamento: string | null;
  conversas_atribuidas: number;
  mensagens_enviadas_30d: number;
  tempo_medio_resposta: string; // formatado ("12 min") ou "sem dados"
  tempo_medio_resposta_min: number | null;
  respostas_medidas: number;
  atendimentos_hoje: number; // conversas distintas que ele respondeu hoje
  atendimentos_30d: number; // conversas distintas que respondeu no período
  atividade_por_dia: Record<string, { atendimentos: number; mensagens: number }>;
  leads_em_posse: number;
  ganhos: number;
  perdidos: number;
  receita_ganha: number;
}

export interface ReportSnapshot {
  empresa: string;
  data_de_hoje: string;
  periodo: string;
  equipe_total: number;
  atendentes: AtendenteStat[];
  conversas: {
    total: number;
    abertas: number;
    finalizadas: number;
    aguardando_distribuicao: number;
    no_bot: number;
  };
  leads: { total: number; ganhos: number; perdidos: number; receita_ganha_total: number };
  pipeline_por_fase: Record<string, { leads: number; valor: number }>;
}

export async function buildReportSnapshot(
  supabase: any,
  locationId: string,
): Promise<ReportSnapshot> {
  const since = new Date(Date.now() - REPORT_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const [membersRes, convRes, msgRes, oppRes, pipeRes, stageRes, locRes] = await Promise.all([
    supabase.from("location_members").select("user_id, role, department_id").eq("location_id", locationId),
    supabase.from("conversations").select("id, assigned_to, channel_id, closed_at, awaiting_distribution, bot_paused").eq("location_id", locationId),
    supabase.from("messages").select("conversation_id, direction, type, internal, created_at").eq("location_id", locationId).gte("created_at", since).order("created_at"),
    supabase.from("opportunities").select("owner_id, status, value, stage_id, pipeline_id").eq("location_id", locationId),
    supabase.from("pipelines").select("id, name").eq("location_id", locationId),
    supabase.from("stages").select("id, name, pipeline_id"),
    supabase.from("locations").select("name").eq("id", locationId).maybeSingle(),
  ]);

  const members = membersRes.data ?? [];
  const conversations = convRes.data ?? [];
  const messages = msgRes.data ?? [];
  const opportunities = oppRes.data ?? [];
  const pipelines = pipeRes.data ?? [];
  const stages = stageRes.data ?? [];

  const userIds = members.map((m: any) => m.user_id);
  const [profRes, deptRes] = await Promise.all([
    userIds.length
      ? supabase.from("profiles").select("id, name").in("id", userIds)
      : Promise.resolve({ data: [] as any[] }),
    supabase.from("departments").select("id, name").eq("location_id", locationId),
  ]);
  const nameOf = new Map((profRes.data ?? []).map((p: any) => [p.id, p.name]));
  const deptOf = new Map((deptRes.data ?? []).map((d: any) => [d.id, d.name]));
  const stageName = new Map(stages.map((s: any) => [s.id, s.name]));
  const pipeName = new Map(pipelines.map((p: any) => [p.id, p.name]));
  const convOwner = new Map<string, string | null>(
    conversations.map((c: any) => [c.id as string, (c.assigned_to as string | null) ?? null]),
  );

  // Tempo de resposta (delta cliente→resposta) atribuído ao dono da conversa.
  const byConv = new Map<string, any[]>();
  for (const m of messages) {
    if (!byConv.has(m.conversation_id)) byConv.set(m.conversation_id, []);
    byConv.get(m.conversation_id)!.push(m);
  }
  const respByUser = new Map<string, { total: number; count: number }>();
  const sentByUser = new Map<string, number>();
  // owner -> dia (YYYY-MM-DD) -> { conversas atendidas (set), mensagens }
  const dailyByUser = new Map<string, Map<string, { convs: Set<string>; msgs: number }>>();
  for (const [convId, msgs] of byConv) {
    const owner = convOwner.get(convId);
    let lastIn: number | null = null;
    for (const m of msgs) {
      if (m.internal || m.type === "event") continue;
      const t = new Date(m.created_at).getTime();
      if (m.direction === "in") {
        lastIn = t;
      } else if (m.direction === "out") {
        if (owner) {
          sentByUser.set(owner, (sentByUser.get(owner) ?? 0) + 1);
          const day = brDay(m.created_at);
          let dm = dailyByUser.get(owner);
          if (!dm) {
            dm = new Map();
            dailyByUser.set(owner, dm);
          }
          let e = dm.get(day);
          if (!e) {
            e = { convs: new Set(), msgs: 0 };
            dm.set(day, e);
          }
          e.convs.add(convId);
          e.msgs += 1;
        }
        if (owner && lastIn != null) {
          const min = (t - lastIn) / 60000;
          if (min >= 0 && min <= MAX_RESPONSE_MIN) {
            const cur = respByUser.get(owner) ?? { total: 0, count: 0 };
            cur.total += min;
            cur.count += 1;
            respByUser.set(owner, cur);
          }
          lastIn = null;
        }
      }
    }
  }

  const convByUser = new Map<string, number>();
  for (const c of conversations) {
    if (c.assigned_to) convByUser.set(c.assigned_to, (convByUser.get(c.assigned_to) ?? 0) + 1);
  }
  const oppByUser = new Map<string, { total: number; won: number; lost: number; revenue: number }>();
  for (const o of opportunities) {
    if (!o.owner_id) continue;
    const cur = oppByUser.get(o.owner_id) ?? { total: 0, won: 0, lost: 0, revenue: 0 };
    cur.total += 1;
    if (o.status === "won") {
      cur.won += 1;
      cur.revenue += Number(o.value) || 0;
    } else if (o.status === "lost") {
      cur.lost += 1;
    }
    oppByUser.set(o.owner_id, cur);
  }

  const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

  const atendentes: AtendenteStat[] = members.map((m: any) => {
    const resp = respByUser.get(m.user_id);
    const opp = oppByUser.get(m.user_id);
    const avgMin = resp && resp.count ? resp.total / resp.count : null;
    const dm = dailyByUser.get(m.user_id);
    const atividade_por_dia: Record<string, { atendimentos: number; mensagens: number }> = {};
    const convs30d = new Set<string>();
    if (dm) {
      for (const [day, e] of dm) {
        atividade_por_dia[day] = { atendimentos: e.convs.size, mensagens: e.msgs };
        for (const c of e.convs) convs30d.add(c);
      }
    }
    return {
      userId: m.user_id,
      nome: nameOf.get(m.user_id) ?? "—",
      papel: m.role,
      departamento: m.department_id ? deptOf.get(m.department_id) ?? null : null,
      conversas_atribuidas: convByUser.get(m.user_id) ?? 0,
      mensagens_enviadas_30d: sentByUser.get(m.user_id) ?? 0,
      tempo_medio_resposta: avgMin != null ? fmtMin(avgMin)! : "sem dados",
      tempo_medio_resposta_min: avgMin != null ? Math.round(avgMin) : null,
      respostas_medidas: resp?.count ?? 0,
      atendimentos_hoje: atividade_por_dia[hoje]?.atendimentos ?? 0,
      atendimentos_30d: convs30d.size,
      atividade_por_dia,
      leads_em_posse: opp?.total ?? 0,
      ganhos: opp?.won ?? 0,
      perdidos: opp?.lost ?? 0,
      receita_ganha: opp?.revenue ?? 0,
    };
  });

  const pipelineResumo: Record<string, { leads: number; valor: number }> = {};
  for (const o of opportunities) {
    const key = `${pipeName.get(o.pipeline_id) ?? "Funil"} › ${stageName.get(o.stage_id) ?? "—"}`;
    const cur = pipelineResumo[key] ?? { leads: 0, valor: 0 };
    cur.leads += 1;
    cur.valor += Number(o.value) || 0;
    pipelineResumo[key] = cur;
  }

  return {
    empresa: (locRes.data as any)?.name ?? "Empresa",
    data_de_hoje: hoje,
    periodo: `últimos ${REPORT_WINDOW_DAYS} dias (mensagens); oportunidades/conversas: estado atual`,
    equipe_total: members.length,
    atendentes,
    conversas: {
      total: conversations.length,
      abertas: conversations.filter((c: any) => !c.closed_at).length,
      finalizadas: conversations.filter((c: any) => c.closed_at).length,
      aguardando_distribuicao: conversations.filter((c: any) => c.awaiting_distribution).length,
      no_bot: conversations.filter((c: any) => !c.assigned_to && !c.bot_paused).length,
    },
    leads: {
      total: opportunities.length,
      ganhos: opportunities.filter((o: any) => o.status === "won").length,
      perdidos: opportunities.filter((o: any) => o.status === "lost").length,
      receita_ganha_total: opportunities
        .filter((o: any) => o.status === "won")
        .reduce((s: number, o: any) => s + (Number(o.value) || 0), 0),
    },
    pipeline_por_fase: pipelineResumo,
  };
}
