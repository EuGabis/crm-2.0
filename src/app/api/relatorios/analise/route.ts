import { createClient } from "@/lib/supabase/server";
import { chat } from "@/lib/ai/openai";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

const WINDOW_DAYS = 30;
// Deltas cliente→resposta acima disso são "no dia seguinte"/ruído — não contam
// para a média de tempo de resposta.
const MAX_RESPONSE_MIN = 24 * 60;

function fmtMin(min: number | null): string | null {
  if (min == null) return null;
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h}h ${m}min` : `${h}h`;
}

/**
 * Aba "Análise IA" do Relatórios (admin). Monta um retrato dos dados REAIS da
 * empresa (últimos 30 dias) e pede para a IA responder a pergunta do admin com
 * base só nesse retrato. RLS de admin já enxerga tudo da location.
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
  const question = String(body?.question ?? "").trim();
  if (!question) return Response.json({ error: "pergunta vazia" }, { status: 400 });
  if (question.length > 500) {
    return Response.json({ error: "pergunta muito longa" }, { status: 400 });
  }

  const locationId = membership.location_id;
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // ---- Coleta (RLS admin = tudo da location) ----
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

  // Nomes dos usuários (profiles) e departamentos.
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

  const convOwner = new Map(conversations.map((c: any) => [c.id, c.assigned_to]));

  // ---- Tempo de resposta por atendente (delta cliente→resposta) ----
  // Agrupa mensagens por conversa (já vêm ordenadas por created_at) e, a cada
  // par entrada→saída (não interna, não evento), soma o delta ao dono da conversa.
  const byConv = new Map<string, any[]>();
  for (const m of messages) {
    if (!byConv.has(m.conversation_id)) byConv.set(m.conversation_id, []);
    byConv.get(m.conversation_id)!.push(m);
  }
  const respByUser = new Map<string, { total: number; count: number }>();
  const sentByUser = new Map<string, number>();
  for (const [convId, msgs] of byConv) {
    const owner = convOwner.get(convId);
    let lastIn: number | null = null;
    for (const m of msgs) {
      if (m.internal || m.type === "event") continue;
      const t = new Date(m.created_at).getTime();
      if (m.direction === "in") {
        lastIn = t;
      } else if (m.direction === "out") {
        if (owner) sentByUser.set(owner, (sentByUser.get(owner) ?? 0) + 1);
        if (owner && lastIn != null) {
          const min = (t - lastIn) / 60000;
          if (min >= 0 && min <= MAX_RESPONSE_MIN) {
            const cur = respByUser.get(owner) ?? { total: 0, count: 0 };
            cur.total += min;
            cur.count += 1;
            respByUser.set(owner, cur);
          }
          lastIn = null; // um par por entrada
        }
      }
    }
  }

  // ---- Conversas e oportunidades por atendente ----
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

  const atendentes = members.map((m: any) => {
    const resp = respByUser.get(m.user_id);
    const opp = oppByUser.get(m.user_id);
    return {
      nome: nameOf.get(m.user_id) ?? "—",
      papel: m.role,
      departamento: m.department_id ? deptOf.get(m.department_id) ?? null : null,
      conversas_atribuidas: convByUser.get(m.user_id) ?? 0,
      mensagens_enviadas_30d: sentByUser.get(m.user_id) ?? 0,
      tempo_medio_resposta: resp && resp.count ? fmtMin(resp.total / resp.count) : "sem dados",
      respostas_medidas: resp?.count ?? 0,
      leads_em_posse: opp?.total ?? 0,
      ganhos: opp?.won ?? 0,
      perdidos: opp?.lost ?? 0,
      receita_ganha: opp?.revenue ?? 0,
    };
  });

  // ---- Agregados gerais ----
  const porCanal: Record<string, number> = {};
  for (const c of conversations) {
    const k = c.channel_id ?? "sem-canal";
    porCanal[k] = (porCanal[k] ?? 0) + 1;
  }
  const pipelineResumo: Record<string, { leads: number; valor: number }> = {};
  for (const o of opportunities) {
    const key = `${pipeName.get(o.pipeline_id) ?? "Funil"} › ${stageName.get(o.stage_id) ?? "—"}`;
    const cur = pipelineResumo[key] ?? { leads: 0, valor: 0 };
    cur.leads += 1;
    cur.valor += Number(o.value) || 0;
    pipelineResumo[key] = cur;
  }

  const snapshot = {
    empresa: (locRes.data as any)?.name ?? "Empresa",
    periodo: `últimos ${WINDOW_DAYS} dias (mensagens); oportunidades/conversas: estado atual`,
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

  const system =
    "Você é um analista de dados do CRM Lito. Responda SEMPRE em português do Brasil, " +
    "de forma objetiva e direta, baseando-se EXCLUSIVAMENTE no JSON de dados fornecido. " +
    "O JSON é o retrato real da empresa. Se a informação pedida não estiver no JSON, diga " +
    "claramente que não há dado suficiente — nunca invente números. Ao citar atendentes, use " +
    "os nomes exatamente como aparecem. Tempos já vêm formatados (ex.: '12 min', '2h 5min'). " +
    "Valores em reais devem ser formatados como R$ com duas casas. Seja conciso; use listas " +
    "curtas quando comparar pessoas. Não exponha ids nem detalhes técnicos do JSON.";

  let answer = "";
  try {
    const res = await chat(
      [
        { role: "system", content: system },
        { role: "user", content: `DADOS (JSON):\n${JSON.stringify(snapshot)}\n\nPERGUNTA DO ADMIN:\n${question}` },
      ],
      { temperature: 0.2 },
    );
    answer = res.text.trim();
  } catch (e: any) {
    return Response.json(
      { error: e?.message?.includes("OPENAI_API_KEY") ? "IA não configurada no servidor" : "Falha ao consultar a IA" },
      { status: 503 },
    );
  }

  return Response.json({ answer });
}
