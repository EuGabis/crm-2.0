/**
 * Modelo de um fluxo de bot conversacional. Um fluxo é um grafo de nós; o motor
 * (engine.ts) caminha pelos nós, mandando mensagem/lista, esperando a resposta
 * do cliente e roteando por condição/score. A definição vive em código por
 * enquanto (config-driven) — ex.: flows/triagem.ts.
 */

export interface BotOption {
  /** Volta no webhook quando o cliente clica (list_reply.id). */
  id: string;
  /** Texto do botão/linha (a Meta limita: lista 24, botão 20 chars). */
  title: string;
  /** Valor guardado na variável (default = title). Usado no score/condição. */
  value?: string;
}

export type BotNode =
  // Manda um texto e segue.
  | { id: string; type: "message"; text: string; next: string | null }
  // Pergunta e ESPERA: sem `options` = texto livre; com `options` = lista.
  | {
      id: string;
      type: "ask";
      text: string;
      /** Nome da variável onde guarda a resposta (ex.: "curso"). */
      var: string;
      options?: BotOption[];
      /** Rótulo do botão que abre a lista (default "Ver opções"). */
      listButton?: string;
      next: string | null;
    }
  // Grava a resposta num campo do contato (ex.: first_name a partir de "name").
  | { id: string; type: "set_contact"; field: string; fromVar: string; next: string | null }
  // Grava um NOME completo separando: 1ª palavra = first_name, resto = last_name.
  | { id: string; type: "set_name"; fromVar: string; next: string | null }
  // Scoring com pesos: soma pesos das variáveis e classifica >= limiar.
  | {
      id: string;
      type: "score";
      /** Variável de saída (ex.: "qualificacao"). */
      var: string;
      /** { variavel: { respostaNormalizada: peso } }. */
      weights: Record<string, Record<string, number>>;
      threshold: number;
      hotValue: string;
      coldValue: string;
      next: string | null;
    }
  // Desvia conforme uma variável coletada.
  | {
      id: string;
      type: "condition";
      var: string;
      equals: string;
      ifTrue: string | null;
      ifFalse: string | null;
    }
  // Encerra o bot e passa pro humano (bot_paused = true).
  | { id: string; type: "handoff"; text?: string }
  // Encerra o bot sem handoff.
  | { id: string; type: "end"; text?: string };

export interface BotFlow {
  key: string;
  name: string;
  /** Nó inicial. */
  start: string;
  nodes: Record<string, BotNode>;
}

/** Normaliza texto p/ casar respostas no score/condição (igual ao n8n do cliente). */
export function normalize(s: string | null | undefined): string {
  return (s ?? "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();
}
