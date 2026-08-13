import { createClient } from "@/lib/supabase/server";
import { chat } from "@/lib/ai/openai";

/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Não autenticado" }, { status: 401 });
  if (!process.env.OPENAI_API_KEY) {
    return Response.json({ error: "IA não configurada (OPENAI_API_KEY ausente)" }, { status: 503 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "payload inválido" }, { status: 400 });
  }
  const agentId = body?.agentId;
  const rawMessages: any[] = Array.isArray(body?.messages) ? body.messages : [];
  if (rawMessages.length === 0) return Response.json({ error: "Sem mensagens" }, { status: 400 });

  const { data: agent } = await supabase
    .from("ai_agents")
    .select("*")
    .eq("id", agentId)
    .maybeSingle();
  if (!agent) return Response.json({ error: "Agente não encontrado" }, { status: 404 });

  const parts = [
    agent.personality,
    agent.goal ? `Objetivo: ${agent.goal}` : "",
    agent.extra_info ? `Informações: ${agent.extra_info}` : "",
  ].filter((p: string) => p && p.trim());
  const system = parts.join("\n\n") || "Você é um assistente prestativo.";

  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: system },
    ...rawMessages.map((m) => ({
      role: m?.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: String(m?.content ?? ""),
    })),
  ];

  let result;
  try {
    result = await chat(messages, { model: agent.model });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Falha na OpenAI" },
      { status: 502 },
    );
  }

  const lastUser = [...rawMessages].reverse().find((m) => m?.role !== "assistant");
  await supabase.from("ai_logs").insert({
    location_id: agent.location_id,
    feature: "agent-test",
    model: agent.model,
    prompt: String(lastUser?.content ?? ""),
    response: result.text,
    prompt_tokens: result.usage.promptTokens,
    completion_tokens: result.usage.completionTokens,
    created_by: user.id,
  });

  return Response.json({ text: result.text, usage: result.usage });
}
