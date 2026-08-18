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
  // Garante que o contato tenha um CARD no funil de leads. Se não tiver, cria na
  // etapa de entrada (ex.: "NOVO LEAD") já na 1ª mensagem. Se já tiver, não mexe.
  | {
      id: string;
      type: "ensure_card";
      /** Nome do funil de leads (ex.: "Controle de Leads"). */
      pipeline?: string;
      /** Etapa de entrada onde o card nasce (ex.: "NOVO LEAD"). */
      stage: string;
      next: string | null;
    }
  // Sincroniza o CARD (oportunidade) do contato no funil de leads: atualiza o nome
  // e move pra etapa mapeada pela variável (ex.: qualificacao=quente → "QUENTE").
  // Cria a oportunidade se ainda não existir.
  | {
      id: string;
      type: "sync_card";
      /** Nome do funil de leads (ex.: "Controle de Leads"). Cai no melhor palpite. */
      pipeline?: string;
      /** Variável que decide a etapa (ex.: "qualificacao"). */
      var: string;
      /** valor da variável → nome da etapa (match por "contém", ignora emoji/acento). */
      stageMap: Record<string, string>;
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
  // Encerra o script e entrega a conversa. `to`:
  //  - "humano" (padrão): pausa o bot (bot_paused = true), um atendente assume.
  //  - "ia": deixa o Agente de IA principal responder as próximas mensagens.
  | { id: string; type: "handoff"; text?: string; to?: "humano" | "ia" }
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
