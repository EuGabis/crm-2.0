import { diasEntre, hojeSP } from "@/lib/periodo";

/**
 * Em que situação está o prazo de uma tarefa. Pura e em `lib/` para ter teste:
 * "vence hoje" × "atrasada" é conta de DIA em São Paulo, e com `new Date` no
 * fuso do processo (a Vercel roda em UTC) a tarefa das 21h viraria "amanhã".
 */
export type SituacaoPrazo = "concluida" | "atrasada" | "hoje" | "amanha" | "semana" | "depois" | "sem-prazo";

const DIA_SP = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** "AAAA-MM-DD" do prazo no relógio de São Paulo; null sem prazo/inválido. */
export function diaDoPrazo(dueAt: string | null | undefined): string | null {
  if (!dueAt) return null;
  const d = new Date(dueAt);
  if (Number.isNaN(d.getTime())) return null;
  return DIA_SP.format(d);
}

export function situacaoDoPrazo(
  t: { status: string; dueAt: string | null },
  hoje = hojeSP(),
): SituacaoPrazo {
  if (t.status === "done") return "concluida";
  const dia = diaDoPrazo(t.dueAt);
  if (!dia) return "sem-prazo";
  // `diasEntre` é INCLUSIVE (o mesmo dia = 1), daí o -1.
  const n = diasEntre(hoje, dia) - 1;
  if (n < 0) return "atrasada";
  if (n === 0) return "hoje";
  if (n === 1) return "amanha";
  if (n <= 7) return "semana";
  return "depois";
}

/** Dias de atraso (≥1) ou 0. */
export function diasDeAtraso(dueAt: string | null, hoje = hojeSP()): number {
  const dia = diaDoPrazo(dueAt);
  if (!dia) return 0;
  return Math.max(0, 1 - diasEntre(hoje, dia));
}
