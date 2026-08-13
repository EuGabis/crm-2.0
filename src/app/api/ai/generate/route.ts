import { createClient } from "@/lib/supabase/server";
import { chat, defaultModel } from "@/lib/ai/openai";

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
  const prompt = (body?.prompt ?? "").toString().trim();
  if (!prompt) return Response.json({ error: "Prompt vazio" }, { status: 400 });

  const { data: membership } = await supabase
    .from("location_members")
    .select("location_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  const locationId = (membership as any)?.location_id ?? null;

  const model = (body?.model || defaultModel()) as string;
  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [];
  if (body?.system) messages.push({ role: "system", content: String(body.system) });
  messages.push({ role: "user", content: prompt });

  let result;
  try {
    result = await chat(messages, {
      model,
      temperature: typeof body?.temperature === "number" ? body.temperature : undefined,
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Falha na OpenAI" },
      { status: 502 },
    );
  }

  if (locationId) {
    await supabase.from("ai_logs").insert({
      location_id: locationId,
      feature: (body?.feature || "generate") as string,
      model,
      prompt,
      response: result.text,
      prompt_tokens: result.usage.promptTokens,
      completion_tokens: result.usage.completionTokens,
      created_by: user.id,
    });
  }

  return Response.json({ text: result.text, usage: result.usage });
}
