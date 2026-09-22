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

/**
 * A falha da OpenAI com o que ela DISSE, não só "deu erro".
 *
 * 🔴 Existe por causa do relato de 2026-09-22: *"estamos com problemas para
 * consultar a Lita, está dando falha em tudo relacionado a ela"* — e o CRM não
 * tinha como responder POR QUÊ. As três rotas da Lita (`assist`, `summary`,
 * `analise`) capturavam a exceção e devolviam `"Falha ao consultar a Lita"`,
 * **jogando fora `e.message`**. Chave recusada, conta sem crédito, limite por
 * minuto e modelo inexistente chegavam ao atendente com o MESMO texto, e as
 * quatro condutas são diferentes.
 *
 * ⚠️ É a mesma lição que custou quinze rodadas no áudio recusado pela Meta ("o
 * motivo nunca era gravado") e uma rodada no `42804` do relatório ("erro de RPC
 * sempre carrega code e message"). Terceira vez: **quando há mais de um motivo
 * de falha e eles pedem condutas diferentes, o retorno tem de dizer QUAL.**
 */
export class ErroOpenAI extends Error {
  /*
   * ⚠️ Campos declarados e atribuídos À MÃO, e não como parameter properties
   * (`constructor(readonly status: number)`). O Node roda TypeScript em modo
   * "strip-only", que **não** suporta parameter property — e é assim que os
   * testes deste repositório rodam, sem runner e sem bundler. Com o atalho, o
   * `npm run test:ia` morre em `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`, ou seja
   * justamente a peça que carrega o diagnóstico ficaria sem teste.
   */
  readonly status: number;
  /** `insufficient_quota`, `credit_balance_exhausted`, `invalid_api_key`… */
  readonly code?: string;
  readonly tipo?: string;

  constructor(message: string, status: number, code?: string, tipo?: string) {
    super(message);
    this.name = "ErroOpenAI";
    this.status = status;
    this.code = code;
    this.tipo = tipo;
  }
}

/**
 * O motivo em PORTUGUÊS, com a conduta — é isso que vai para a tela do
 * atendente.
 *
 * ⚠️ **Traduzir não é enfeite.** O texto cru da OpenAI ("You exceeded your
 * current quota") lido dentro do CRM leva o atendente a concluir coisas erradas
 * e a insistir no botão — exatamente o que aconteceu com o `#131042` do
 * WhatsApp, cujo "your payment method" fazia pensar no cartão do ALUNO. A frase
 * diz de quem é o problema e o que fazer.
 *
 * ⚠️ E o detalhe técnico vai JUNTO, entre parênteses: sem ele, quem for
 * investigar precisa do log da Vercel — que é justamente onde este projeto já
 * perdeu três rodadas procurando.
 */
export function motivoDaFalhaIA(e: unknown): string {
  if (e instanceof ErroOpenAI) {
    const tecnico = [e.status, e.code].filter(Boolean).join(" · ");
    /*
     * 🔴 **O CÓDIGO decide antes do status, e essa ordem é o cerne.** A primeira
     * versão perguntava `status === 429` antes de olhar o código — e
     * `credit_balance_exhausted` vem com **429**. Resultado medido em produção
     * (22/09): a tela dizia *"tente de novo em alguns instantes"* para uma conta
     * SEM SALDO, que é o conselho exatamente oposto ao certo. O atendente
     * reclica para sempre e ninguém vai ao painel de faturamento.
     *
     * A lição é a mesma do `#131042` do WhatsApp: **mensagem de erro que aponta
     * a conduta errada é pior que mensagem genérica** — a genérica ao menos faz
     * a pessoa perguntar.
     */
    if (semCredito(e)) {
      return (
        "A conta da OpenAI está SEM CRÉDITO — nenhuma função de IA (Lita, resumo, " +
        "transcrição de áudio, análise) volta a funcionar até recarregar em " +
        `platform.openai.com → Billing. Não adianta tentar de novo (${tecnico}).`
      );
    }
    if (e.status === 401 || e.status === 403 || e.code === "invalid_api_key") {
      return `A chave da OpenAI foi recusada — ela precisa ser renovada em OPENAI_API_KEY na Vercel (${tecnico}).`;
    }
    if (e.code === "model_not_found" || e.status === 404) {
      return `O modelo configurado em OPENAI_MODEL não existe nesta conta da OpenAI (${tecnico}).`;
    }
    if (e.status === 429) {
      return `Limite de chamadas por minuto da OpenAI atingido — tente de novo em alguns instantes (${tecnico}).`;
    }
    if (e.status >= 500) {
      return `A OpenAI está fora do ar neste momento (${tecnico}).`;
    }
    return `${e.message} (${tecnico})`;
  }
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("OPENAI_API_KEY")) {
    return "A IA não está configurada no servidor — falta OPENAI_API_KEY na Vercel.";
  }
  return msg || "Falha desconhecida ao consultar a IA";
}

/**
 * A conta ficou sem saldo.
 *
 * ⚠️ São TRÊS códigos para a mesma coisa, e a OpenAI usa um ou outro conforme o
 * tipo de plano: `insufficient_quota` (limite de uso), `credit_balance_exhausted`
 * (créditos pré-pagos zerados — o que aconteceu aqui) e
 * `billing_hard_limit_reached` (teto de gasto configurado). Casar só com o
 * primeiro, como a versão anterior fazia, deixa os outros dois caírem no ramo
 * genérico de 429.
 *
 * O casamento é por SUBSTRING de propósito: um código novo da OpenAI que
 * mencione crédito ou cobrança deve ser tratado como sem saldo, não ignorado em
 * silêncio.
 */
function semCredito(e: ErroOpenAI): boolean {
  const c = (e.code ?? "").toLowerCase();
  if (e.status === 402) return true;
  return c.includes("credit") || c.includes("quota") || c.includes("billing");
}

/**
 * A falha é da CONTA (saldo, chave, limite, OpenAI fora do ar) e não da
 * requisição.
 *
 * 🔴 Existe para a transcrição decidir entre `pendente` e `falhou`. São coisas
 * opostas: arquivo ruim NÃO melhora tentando de novo, e conta sem saldo VOLTA a
 * funcionar sozinha quando alguém recarregar. Tratar as duas como "falhou"
 * marcava como definitivamente perdidos os áudios que só precisavam esperar —
 * e a fila do tique só olha `pendente`, então eles nunca mais seriam tentados.
 *
 * ⚠️ 400 fica de FORA: é o arquivo (formato recusado, tamanho, áudio corrompido)
 * e retentar seria laço infinito — a mesma razão de `ignorado` existir.
 */
export function falhaDeConta(e: unknown): boolean {
  if (!(e instanceof ErroOpenAI)) {
    return e instanceof Error && e.message.includes("OPENAI_API_KEY");
  }
  return e.status === 401 || e.status === 403 || e.status === 429 || e.status >= 500 || semCredito(e);
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
    // ⚠️ `status` e `code` viajam JUNTO da mensagem: é o par que separa "sem
    // crédito" de "chave inválida" de "modelo inexistente", e sem ele quem
    // recebe a exceção só pode dizer "falhou".
    throw new ErroOpenAI(
      json?.error?.message || `OpenAI ${res.status}`,
      res.status,
      json?.error?.code,
      json?.error?.type
    );
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
