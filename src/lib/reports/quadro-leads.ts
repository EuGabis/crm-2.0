/**
 * O que cada coluna do quadro "Por atendente" CONTA.
 *
 * 🔴 Existe por uma razão só: **o número e a lista que ele abre têm de sair do
 * mesmo predicado.** A rota soma as colunas no servidor e o diálogo filtra os
 * leads no navegador — escritos em dois lugares, eles divergem na primeira
 * mudança, e o resultado é um quadro que diz "95 qualificados" abrindo uma lista
 * de 93. Divergência assim não dá erro: ela só mina a confiança no relatório
 * inteiro, e é o defeito que este projeto já pagou caro em outras telas.
 *
 * Fica em `lib/` e não junto do diálogo porque quem também precisa dele é uma
 * rota de servidor — e porque assim roda em teste sem JSX.
 */

/** O mínimo que os predicados precisam ler de um lead. */
export interface LeadContado {
  /** Desfecho do bot. `null` = não concluiu a triagem, então não tem nota. */
  resultado: string | null;
  finalizada: boolean;
  ganha: boolean;
}

/** Qual número do quadro foi clicado. */
export type Recorte = "recebeu" | "qualificados" | "frios" | "finalizadas" | "ganhas";

/**
 * ⚠️ **Frio NÃO é "o resto".** Quente e frio são os dois lados de uma nota que o
 * bot deu (soma ≥ limiar ou abaixo dele); quem abandonou a triagem não recebeu
 * nota nenhuma e não é nem um nem outro. Somar os sem-nota em "frios"
 * inventaria uma reprovação que nunca houve — e as condutas são opostas: frio
 * recebe conteúdo, quem desistiu precisa ser retomado.
 */
export function noRecorte(l: LeadContado, r: Recorte): boolean {
  switch (r) {
    case "qualificados":
      return l.resultado === "quente";
    case "frios":
      return l.resultado === "frio";
    case "finalizadas":
      return l.finalizada;
    case "ganhas":
      return l.ganha;
    case "recebeu":
      return true;
  }
}

/** As colunas do quadro, contadas a partir dos leads de um atendente. */
export function contarRecortes<T extends LeadContado>(leads: T[]) {
  return {
    recebeu: leads.length,
    qualificados: leads.filter((l) => noRecorte(l, "qualificados")).length,
    frios: leads.filter((l) => noRecorte(l, "frios")).length,
    finalizadas: leads.filter((l) => noRecorte(l, "finalizadas")).length,
    ganhas: leads.filter((l) => noRecorte(l, "ganhas")).length,
  };
}
