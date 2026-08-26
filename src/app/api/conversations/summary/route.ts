import { createClient } from "@/lib/supabase/server";
import { chat, defaultModel } from "@/lib/ai/openai";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Chave em `ai_logs` — separa este uso do Content AI e da Análise IA. */
const FEATURE = "handoff-summary";
/** Últimas mensagens usadas como base. */
const JANELA = 40;

/**
 * Rascunho do resumo do atendimento, para a pessoa revisar antes de finalizar ou
 * transferir.
 *
 * ⚠️ É RASCUNHO, nunca resumo definitivo: quem confirma é o atendente, e o texto
 * que vai para a nota é o que ELE deixou no campo. Sem essa revisão, um resumo
 * errado escrito por máquina viraria a memória oficial do atendimento — pior que
 * não ter resumo, porque o próximo atendente confiaria nele.
 *
 * A sessão do usuário lê as mensagens, então a RLS decide o que entra no resumo:
 * quem não pode ver a conversa recebe 404 e nunca chega a gastar uma chamada.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "não autenticado" }, { status: 401 });

  const { conversationId } = await req.json().catch(() => ({}) as { conversationId?: string });
  if (!conversationId) {
    return Response.json({ error: "conversationId ausente" }, { status: 400 });
  }

  const { data: conversa } = await supabase
    .from("conversations")
    .select("id, location_id, contact:contacts(first_name, last_name)")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conversa) return Response.json({ error: "conversa não encontrada" }, { status: 404 });

  const { data: mensagens } = await supabase
    .from("messages")
    .select("direction, body, type, internal, transcription, created_at")
    .eq("conversation_id", conversationId)
    .neq("type", "event")
    .order("created_at", { ascending: false })
    .limit(JANELA);

  // Ordem cronológica para a IA: a conversa lida de baixo para cima confunde
  // quem pediu o quê.
  const linhas = (mensagens ?? [])
    .slice()
    .reverse()
    .map((m: any) => {
      const quem = m.internal ? "NOTA INTERNA" : m.direction === "in" ? "CLIENTE" : "ATENDENTE";
      // Áudio entra pela transcrição (migração 0085) — sem isso, uma conversa
      // toda em áudio chegaria à IA como uma pilha de "[audio]" e o resumo sairia
      // vazio de conteúdo.
      const texto =
        m.type === "audio"
          ? m.transcription
            ? `(áudio) ${m.transcription}`
            : "(áudio sem transcrição)"
          : m.type === "image"
            ? "(imagem enviada)"
            : m.type === "file"
              ? "(arquivo enviado)"
              : (m.body ?? "");
      return `${quem}: ${String(texto).slice(0, 900)}`;
    })
    .filter((l) => l.trim().length > 0);

  if (linhas.length === 0) {
    return Response.json({ error: "conversa sem mensagens para resumir" }, { status: 400 });
  }

  const contato = Array.isArray(conversa.contact) ? conversa.contact[0] : conversa.contact;
  const nome = `${(contato as any)?.first_name ?? ""} ${(contato as any)?.last_name ?? ""}`.trim();

  const system =
    "Você resume atendimentos de um CRM para o PRÓXIMO atendente ler. Responda em " +
    "português do Brasil, no máximo 4 linhas curtas, sem saudação e sem repetir o nome do " +
    "cliente em toda frase. Diga: o que o cliente quis, o que já foi feito/informado e o que " +
    "ficou pendente. Se algo foi combinado (valor, prazo, retorno), cite. Não invente nada " +
    "que não esteja nas mensagens; se a conversa não deixa claro o desfecho, escreva que " +
    "ficou sem definição. Não use markdown nem listas com asterisco.";

  let texto = "";
  let usage = { promptTokens: 0, completionTokens: 0 };
  try {
    const res = await chat(
      [
        { role: "system", content: system },
        {
          role: "user",
          content: `CLIENTE: ${nome || "não identificado"}\n\nCONVERSA:\n${linhas.join("\n")}`,
        },
      ],
      { temperature: 0.3 }
    );
    texto = res.text.trim();
    usage = res.usage;
  } catch (e: any) {
    return Response.json(
      {
        error: e?.message?.includes("OPENAI_API_KEY")
          ? "IA não configurada no servidor"
          : "Falha ao gerar o resumo",
      },
      { status: 503 }
    );
  }

  // Best-effort: o log não pode impedir o rascunho de chegar.
  const { error: erroLog } = await supabase.from("ai_logs").insert({
    location_id: conversa.location_id,
    feature: FEATURE,
    model: defaultModel(),
    prompt: `resumo do atendimento · conversa ${conversationId}`,
    response: texto,
    prompt_tokens: usage.promptTokens,
    completion_tokens: usage.completionTokens,
    created_by: user.id,
  });
  if (erroLog) console.warn("[resumo] falha ao registrar em ai_logs:", erroLog.message);

  return Response.json({ resumo: texto });
}
