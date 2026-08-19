import { createClient } from "@/lib/supabase/server";
import { chat } from "@/lib/ai/openai";
import { buildReportSnapshot } from "@/lib/reports/snapshot";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

/**
 * Aba "Análise IA" do Relatórios (admin). Monta um retrato dos dados REAIS da
 * empresa e pede para a IA responder a pergunta do admin com base só nesse
 * retrato. RLS de admin já enxerga tudo da location.
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

  const snapshot = await buildReportSnapshot(supabase, membership.location_id);

  const system =
    "Você é um analista de dados do CRM Lito. Responda SEMPRE em português do Brasil, " +
    "de forma objetiva e direta, baseando-se EXCLUSIVAMENTE no JSON de dados fornecido. " +
    "O JSON é o retrato real da empresa. O campo 'data_de_hoje' diz qual é o dia de hoje " +
    "(fuso de São Paulo); use-o para interpretar 'hoje', 'ontem' e 'esta semana'. Cada " +
    "atendente tem 'atendimentos_hoje' (conversas distintas que respondeu hoje) e " +
    "'atividade_por_dia' (por data: atendimentos e mensagens) — some os dias certos para " +
    "períodos como 'esta semana'. 'atendimento' = conversa que o atendente respondeu naquele " +
    "dia. Se a informação pedida não estiver no JSON, diga claramente que não há dado " +
    "suficiente — nunca invente números. Ao citar atendentes, use os nomes exatamente como " +
    "aparecem. Tempos já vêm formatados (ex.: '12 min'). Valores em reais como R$ com duas " +
    "casas. Seja conciso; use listas curtas ao comparar pessoas. Não exponha ids nem campos " +
    "técnicos do JSON.";

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
