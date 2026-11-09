/**
 * Junta o par "Devolvida à fila do setor" + "Atribuída a X" que a devolução por
 * espera grava no mesmo instante (são dois updates, e o gatilho escreve um
 * evento para cada). No fio viravam duas pílulas por volta — ilegível
 * (relato de 2026-11-09). Só na TELA: o banco segue com os dois eventos.
 */
type Msg = { type?: string; body?: string | null; at: string };

const JANELA_MS = 60_000;

export function juntarRedistribuicoes<T extends Msg>(msgs: T[]): T[] {
  const out: T[] = [];
  for (let i = 0; i < msgs.length; i++) {
    const a = msgs[i];
    const b = msgs[i + 1];
    if (
      a.type === "event" && b?.type === "event" &&
      (a.body ?? "").startsWith("Devolvida à fila do setor") &&
      (b.body ?? "").startsWith("Atribuída a ") &&
      Math.abs(new Date(b.at).getTime() - new Date(a.at).getTime()) <= JANELA_MS
    ) {
      const nome = (b.body ?? "").slice("Atribuída a ".length).split(" · ")[0];
      const motivo = (a.body ?? "").split("devolvida: ")[1];
      out.push({
        ...b,
        body: `Redistribuída para ${nome}${motivo ? ` · ${motivo}` : ""}`,
      });
      i++;
      continue;
    }
    out.push(a);
  }
  return out;
}
