/**
 * Quais mensagens automáticas que falharam podem ser reenviadas — e em que
 * ordem. Função pura, com teste (`npm run test:reenvio-bot`).
 *
 * Origem (2026-10-05): o `WHATSAPP_TOKEN` ficou inválido entre dois redeploys
 * e toda mensagem do bot nesse intervalo foi gravada como `failed`. O cliente
 * não recebeu nada e ficou esperando.
 *
 * ⚠️ Reenviar errado é pior que não reenviar: mensagem antiga chegando depois
 * de a conversa ter seguido confunde o cliente, e repetir a mesma pergunta
 * parece defeito. Por isso as regras abaixo.
 */

export interface MsgDaConversa {
  id: string;
  direction: "in" | "out";
  status: string | null;
  type: string | null;
  automated: boolean | null;
  internal: boolean | null;
  body: string | null;
  /** created_at em ISO */
  at: string;
}

export type MotivoPulo =
  | "janela fechada"
  | "conversa seguiu depois da falha"
  | "nada para reenviar";

export interface Plano {
  reenviar: { id: string; body: string }[];
  pulo?: MotivoPulo;
}

const ENTREGUE = new Set(["sent", "delivered", "read"]);
/** Folga para o reenvio não cair no limite exato das 24h. */
const MARGEM_JANELA_MS = 30 * 60_000;

export function planoDeReenvio(msgs: MsgDaConversa[], agoraMs = Date.now()): Plano {
  const ordem = [...msgs].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  const reais = ordem.filter((m) => m.type !== "event" && !m.internal);

  // 1) Janela de 24h: conta da última mensagem do CLIENTE.
  const ultimaEntrada = [...reais].reverse().find((m) => m.direction === "in");
  if (!ultimaEntrada || agoraMs - Date.parse(ultimaEntrada.at) > 24 * 3600_000 - MARGEM_JANELA_MS) {
    return { reenviar: [], pulo: "janela fechada" };
  }

  // 2) Só o que falhou DEPOIS do último envio bem-sucedido (de qualquer um).
  let corte = -1;
  reais.forEach((m, i) => {
    if (m.direction === "out" && ENTREGUE.has(m.status ?? "")) corte = i;
  });
  const depois = reais.slice(corte + 1);
  const falhas = depois.filter(
    (m) => m.direction === "out" && m.status === "failed" && m.automated && (m.type ?? "text") === "text" && (m.body ?? "").trim()
  );
  if (falhas.length === 0) {
    // Falha do bot ANTES do último envio bem-sucedido = a conversa seguiu.
    const houveFalhaAntes = reais
      .slice(0, corte + 1)
      .some((m) => m.direction === "out" && m.status === "failed" && m.automated);
    return { reenviar: [], pulo: houveFalhaAntes ? "conversa seguiu depois da falha" : "nada para reenviar" };
  }

  // 3) Texto repetido vai uma vez só (o bot reperguntou a cada mensagem do cliente).
  const vistos = new Set<string>();
  const reenviar: { id: string; body: string }[] = [];
  for (const m of falhas) {
    const chave = (m.body ?? "").trim();
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    reenviar.push({ id: m.id, body: chave });
  }
  return { reenviar };
}
