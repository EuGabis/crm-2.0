import { createClient } from "@/lib/supabase/server";
import { chat, defaultModel, motivoDaFalhaIA } from "@/lib/ai/openai";
import { transcribeModel } from "@/lib/ai/transcribe";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

/**
 * O que a OPENAI diz sobre a nossa conta — por que a Lita parou.
 *
 * 🔴 **Por que esta rota existe.** Relato de 2026-09-22: *"estamos com problemas
 * para consultar a Lita, está dando falha em tudo relacionado a ela"*. O CRM não
 * tinha como responder POR QUÊ: as três rotas da Lita devolviam "Falha ao
 * consultar a Lita" para qualquer causa, `ai_logs` só era escrita no sucesso, e
 * a única pista viva era um `console.log` num painel da Vercel — que é
 * exatamente onde este projeto já perdeu três rodadas procurando, na novela do
 * áudio.
 *
 * ⚠️ **É o mesmo movimento de `/api/whatsapp/diagnostico`, e pelo mesmo motivo:
 * o que dá para MEDIR não se deduz.** Quatro causas produzem o mesmo sintoma
 * ("tudo de IA falhou") e pedem condutas completamente diferentes:
 *
 * | causa | onde se resolve |
 * |---|---|
 * | conta sem crédito (`insufficient_quota`) | painel de faturamento da OpenAI |
 * | chave revogada/rotacionada (401) | `OPENAI_API_KEY` na Vercel |
 * | `OPENAI_MODEL` apontando para modelo que a conta não tem (404) | a env |
 * | limite por minuto (429) | esperar — não é defeito |
 *
 * A rota pergunta à própria OpenAI e responde qual é, em segundos.
 *
 * ⚠️ **Faz uma chamada REAL de chat, não só um `GET /models`.** Listar modelos
 * responde com chave válida mesmo numa conta sem crédito — o erro de cota só
 * aparece quando se pede geração. Testar o caminho barato daria "está tudo bem"
 * no caso mais provável.
 *
 * ⚠️ **A CHAVE NUNCA é devolvida** — só o prefixo e o tamanho, que é o bastante
 * para saber se a variável foi trocada por engano sem expor nada.
 *
 * Admin-only: o estado da conta não é segredo, mas não é assunto de todo
 * atendente.
 */
export async function GET() {
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

  const chave = process.env.OPENAI_API_KEY ?? "";
  const base = {
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
    modelo: defaultModel(),
    modeloDeTranscricao: transcribeModel(),
    chave: chave
      ? { presente: true, prefixo: chave.slice(0, 7), tamanho: chave.length }
      : { presente: false },
  };

  if (!chave) {
    return Response.json({
      ...base,
      ok: false,
      leitura:
        "OPENAI_API_KEY não está definida no servidor. Nenhuma função de IA funciona — " +
        "defina a variável na Vercel (production, preview e development) e refaça o deploy.",
    });
  }

  /*
   * A chamada mais barata possível que ainda exercita geração: uma palavra.
   * ⚠️ Best-effort por construção — esta rota existe para diagnosticar a falha,
   * então a falha É a resposta, e não uma exceção que derruba a rota.
   */
  const inicio = Date.now();
  try {
    const res = await chat([{ role: "user", content: "responda apenas: ok" }], {
      temperature: 0,
    });
    return Response.json({
      ...base,
      ok: true,
      ms: Date.now() - inicio,
      resposta: res.text.slice(0, 40),
      leitura: `A OpenAI respondeu normalmente com o modelo ${base.modelo}. Se a Lita ainda falha na tela, o problema não é a conta nem a chave — veja as linhas "…:erro" em ai_logs.`,
    });
  } catch (e: any) {
    return Response.json({
      ...base,
      ok: false,
      ms: Date.now() - inicio,
      status: e?.status ?? null,
      code: e?.code ?? null,
      tipo: e?.tipo ?? null,
      mensagemDaOpenAI: e?.message ?? String(e),
      // A mesma frase que o atendente vê na tela, para não existirem duas
      // leituras do mesmo erro.
      leitura: motivoDaFalhaIA(e),
    });
  }
}
