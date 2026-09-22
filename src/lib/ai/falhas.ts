import { defaultModel, motivoDaFalhaIA } from "./openai";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Registra uma falha de IA em `ai_logs` — a tabela que já existe.
 *
 * 🔴 **Sem isto, "desde quando a Lita parou?" não tem resposta.** `ai_logs` só
 * era escrita no SUCESSO, então uma interrupção de horas não deixava rastro
 * nenhum: o único sinal era um atendente reclamando. E este projeto já aprendeu,
 * caro, que a PRIMEIRA pergunta de toda investigação é *quando parou de
 * funcionar* — foram onze rodadas no áudio recusado pela Meta até alguém dizer
 * "ontem funcionava".
 *
 * ⚠️ **A `feature` leva o sufixo `:erro`**, e isso é de propósito: as telas que
 * leem `ai_logs` filtram por igualdade (`feature = 'reports-analysis'` no
 * histórico da Análise IA), então a linha de falha não polui nenhuma lista
 * existente — e ao mesmo tempo fica achável por quem procurar.
 *
 * ⚠️ **Best-effort.** Falhar ao registrar a falha não pode virar um segundo
 * erro na cara de quem já levou o primeiro.
 */
export async function registrarFalhaIA(
  supabase: any,
  params: {
    locationId: string | null | undefined;
    feature: string;
    prompt: string;
    userId?: string | null;
    erro: unknown;
  }
): Promise<string> {
  const motivo = motivoDaFalhaIA(params.erro);
  // O log do servidor carrega o COMMIT: sem ele, "é o código novo ou o velho?"
  // volta a ser dedução — a lição que custou seis rodadas no envio de áudio.
  console.error(
    `[ia] ${params.feature} falhou · ${motivo} · commit ${process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local"}`
  );
  if (!params.locationId) return motivo;
  try {
    await supabase.from("ai_logs").insert({
      location_id: params.locationId,
      feature: `${params.feature}:erro`,
      model: defaultModel(),
      prompt: params.prompt,
      response: motivo,
      prompt_tokens: 0,
      completion_tokens: 0,
      created_by: params.userId ?? null,
    });
  } catch {
    // Ver o comentário acima: registrar é desejável, travar é pior.
  }
  return motivo;
}
