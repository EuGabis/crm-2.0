import { createClient } from "@/lib/supabase/server";
import { chat, defaultModel } from "@/lib/ai/openai";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

const FEATURE = "lita-assist";
/** Quantas mensagens entram na leitura. */
const JANELA = 60;

/** Categorias de chamado. A tela usa a chave para escolher rótulo e cor. */
const TIPOS = ["vendas", "aluno", "cobranca", "suporte", "outro"] as const;

/**
 * "Lita ajuda": a IA lê o atendimento e ajuda QUEM ESTÁ ATENDENDO.
 *
 * Diferente do resumo (que conta o passado para o próximo atendente), aqui a
 * pergunta é "e agora?": que tipo de chamado é este, o que o cliente realmente
 * quer, o que fazer em seguida e o que está sendo feito mal.
 *
 * ⚠️ A classificação do tipo vem primeiro no prompt de propósito. Um chamado de
 * VENDAS e uma dúvida de ALUNO pedem condutas opostas — no primeiro o objetivo é
 * avançar para a matrícula, no segundo é resolver e não empurrar venda. Sem
 * classificar, a IA dá o mesmo conselho genérico para os dois.
 *
 * A sessão do usuário lê as mensagens: a RLS decide o que a Lita pode ver, e quem
 * não enxerga a conversa recebe 404 sem gastar chamada.
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
    .select("id, location_id, channel, closed_at, contact:contacts(first_name, last_name, tags)")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conversa) return Response.json({ error: "conversa não encontrada" }, { status: 404 });

  const [{ data: mensagens }, { data: resumoAnterior }] = await Promise.all([
    supabase
      .from("messages")
      .select("direction, body, type, internal, transcription, created_at, handoff_kind")
      .eq("conversation_id", conversationId)
      .neq("type", "event")
      .order("created_at", { ascending: false })
      .limit(JANELA),
    // O resumo do último repasse (0087) entra junto: ele carrega o combinado de
    // um atendimento anterior que talvez não esteja mais na janela de mensagens.
    supabase.rpc("last_handoff_summary", { conv_id: conversationId }),
  ]);

  const linhas = (mensagens ?? [])
    .slice()
    .reverse()
    .map((m: any) => {
      const quem = m.internal ? "NOTA INTERNA" : m.direction === "in" ? "CLIENTE" : "ATENDENTE";
      // Áudio entra pela transcrição (0085): sem isso, conversa em áudio chega
      // como uma pilha de "(áudio)" e a Lita não tem o que analisar.
      const texto =
        m.type === "audio"
          ? m.transcription
            ? `(áudio) ${m.transcription}`
            : "(áudio ainda sem transcrição)"
          : m.type === "image"
            ? "(imagem)"
            : m.type === "file"
              ? "(arquivo)"
              : (m.body ?? "");
      return `${quem}: ${String(texto).slice(0, 900)}`;
    })
    .filter((l) => l.trim().length > 0);

  if (linhas.length === 0) {
    return Response.json({ error: "conversa sem mensagens para analisar" }, { status: 400 });
  }

  const contato = Array.isArray(conversa.contact) ? conversa.contact[0] : conversa.contact;
  const nome = `${(contato as any)?.first_name ?? ""} ${(contato as any)?.last_name ?? ""}`.trim();
  const resumo = ((resumoAnterior ?? []) as any[])[0]?.body ?? null;
  const ultimaMensagem = (mensagens ?? [])[0];
  const clienteEsperando = ultimaMensagem?.direction === "in";

  const system =
    "Você é a Lita, assistente de atendimento do CRM. Ajuda QUEM ESTÁ ATENDENDO, " +
    "não o cliente: fale com o atendente, na segunda pessoa, em português do Brasil. " +
    "Responda SEMPRE um objeto JSON com estas chaves: " +
    '"tipo" (um de: vendas, aluno, cobranca, suporte, outro), ' +
    '"tipo_motivo" (uma frase curta dizendo por que classificou assim), ' +
    '"situacao" (2 frases: o que o cliente quer e em que pé está), ' +
    '"proximo_passo" (a ÚNICA próxima ação mais importante, imperativa e concreta), ' +
    '"sugestoes" (2 a 4 strings: o que fazer/dizer, com conteúdo específico deste caso), ' +
    '"atencao" (0 a 3 strings: riscos, promessas não cumpridas, pedidos do cliente que ' +
    "ficaram sem resposta, tom inadequado — se não houver nada, devolva lista vazia). " +
    "Regras: tipo 'vendas' é quem ainda não é cliente e avalia comprar — o objetivo é " +
    "avançar para a matrícula; 'aluno' é quem já estuda e tem dúvida — resolva e NÃO " +
    "empurre venda; 'cobranca' é pagamento, parcela, reembolso ou cancelamento. " +
    "Baseie-se SÓ na conversa e no resumo fornecidos; não invente valor, prazo, nome de " +
    "curso nem política da empresa. Se falta informação para orientar, diga o que o " +
    "atendente precisa perguntar. Seja específico: 'confirme se as três parcelas " +
    "pendentes serão abatidas' vale; 'seja atencioso' não vale. Nada de markdown.";

  const contexto = [
    `CLIENTE: ${nome || "não identificado"}`,
    `CANAL: ${conversa.channel ?? "whatsapp"}`,
    `CONVERSA ESTÁ: ${conversa.closed_at ? "finalizada" : "aberta"}`,
    `ÚLTIMA MENSAGEM É DO: ${clienteEsperando ? "CLIENTE (ele está esperando resposta)" : "ATENDENTE"}`,
    resumo ? `RESUMO DO ATENDIMENTO ANTERIOR:\n${resumo}` : "SEM RESUMO ANTERIOR REGISTRADO.",
    `\nCONVERSA:\n${linhas.join("\n")}`,
  ].join("\n");

  let bruto = "";
  let usage = { promptTokens: 0, completionTokens: 0 };
  try {
    const res = await chat(
      [
        { role: "system", content: system },
        { role: "user", content: contexto },
      ],
      { temperature: 0.3, json: true }
    );
    bruto = res.text;
    usage = res.usage;
  } catch (e: any) {
    return Response.json(
      {
        error: e?.message?.includes("OPENAI_API_KEY")
          ? "IA não configurada no servidor"
          : "Falha ao consultar a Lita",
      },
      { status: 503 }
    );
  }

  // Mesmo com o modo JSON ligado, o parse é defensivo: uma resposta fora do
  // formato não pode virar erro 500 na cara do atendente.
  let analise: any = null;
  try {
    analise = JSON.parse(bruto);
  } catch {
    return Response.json({ error: "A Lita respondeu num formato inesperado" }, { status: 502 });
  }

  const lista = (v: any): string[] =>
    Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, 4) : [];
  const resultado = {
    tipo: TIPOS.includes(analise?.tipo) ? analise.tipo : "outro",
    tipoMotivo: String(analise?.tipo_motivo ?? "").trim(),
    situacao: String(analise?.situacao ?? "").trim(),
    proximoPasso: String(analise?.proximo_passo ?? "").trim(),
    sugestoes: lista(analise?.sugestoes),
    atencao: lista(analise?.atencao),
    usouResumo: Boolean(resumo),
    mensagensLidas: linhas.length,
  };

  const { error: erroLog } = await supabase.from("ai_logs").insert({
    location_id: conversa.location_id,
    feature: FEATURE,
    model: defaultModel(),
    prompt: `Lita ajuda · conversa ${conversationId}`,
    response: bruto,
    prompt_tokens: usage.promptTokens,
    completion_tokens: usage.completionTokens,
    created_by: user.id,
  });
  if (erroLog) console.warn("[lita] falha ao registrar em ai_logs:", erroLog.message);

  return Response.json(resultado);
}
