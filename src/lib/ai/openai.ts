/**
 * Cliente da OpenAI (Chat Completions). SERVER-ONLY: usa OPENAI_API_KEY, que nunca
 * pode ir ao cliente. Modelo configurável por OPENAI_MODEL (default gpt-4o-mini).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

export function defaultModel(): string {
  return process.env.OPENAI_MODEL || "gpt-4o-mini";
}

function apiKey(): string {
  const k = process.env.OPENAI_API_KEY;
  if (!k) throw new Error("OPENAI_API_KEY ausente no servidor");
  return k;
}

export async function chat(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  /**
   * `json: true` liga o modo JSON da OpenAI (`response_format`), que garante
   * resposta parseável. Sem ele, pedir JSON no prompt funciona na maioria das
   * vezes e falha justamente quando o modelo decide explicar antes — e aí o
   * `JSON.parse` quebra em produção.
   */
  opts?: { model?: string; temperature?: number; json?: boolean },
): Promise<{ text: string; usage: { promptTokens: number; completionTokens: number } }> {
  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: opts?.model || defaultModel(),
      messages,
      temperature: opts?.temperature ?? 0.7,
      ...(opts?.json ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.error?.message || `OpenAI ${res.status}`);
  }
  const text: string = json?.choices?.[0]?.message?.content ?? "";
  const usage = json?.usage ?? {};
  return {
    text,
    usage: {
      promptTokens: usage.prompt_tokens ?? 0,
      completionTokens: usage.completion_tokens ?? 0,
    },
  };
}
