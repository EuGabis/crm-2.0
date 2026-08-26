import type { BotFlow } from "../types";

/**
 * Bot Financeiro — Lito Academy (desenho da Cibelle).
 *
 * Saudação (Lita) → escolhe o SETOR:
 *   1. Financeiro → sub-menu (Pagamento / Regularização / Acordo) → pede
 *      e-mail ou CPF cadastrado → transfere para um atendente do Financeiro.
 *   2. Secretaria → encaminha para um atendente da Secretaria.
 *   3. Vendas     → encaminha para um atendente de Vendas.
 *
 * As transferências nascem SEM atendente escolhido (`assignTo` vazio): abra a
 * aba WhatsApp → Bot → Bot Financeiro, escolha a pessoa de cada "Transferir para
 * atendente específico" e salve. Enquanto não escolher, cai no rodízio do número.
 * Ligue o bot ao número em Canais → editar → Bot de atendimento.
 */
const PEDE_DOC =
  "Ok! Para agilizar o seu atendimento, me informe o seu e-mail ou CPF cadastrado:";

const CONFIRMA = "Perfeito! Um atendente já vai falar com você. 😊";

export const financeiroFlow: BotFlow = {
  key: "bot-financeiro",
  name: "Bot Financeiro",
  start: "boas_vindas",
  nodes: {
    boas_vindas: {
      id: "boas_vindas",
      type: "message",
      text: "Saudações Aeronáuticas! 🛩️ Eu sou a Lita, assistente virtual da Lito Academy.",
      next: "menu_setor",
    },

    // ---- Setor ----
    menu_setor: {
      id: "menu_setor",
      type: "ask",
      text: "Com qual setor você quer falar? Toque em uma opção:",
      var: "setor",
      listButton: "Ver setores",
      options: [
        { id: "financeiro", title: "Financeiro", value: "financeiro", next: "menu_financeiro" },
        { id: "secretaria", title: "Secretaria", value: "secretaria", next: "sec_fim" },
        { id: "vendas", title: "Vendas", value: "vendas", next: "vendas_fim" },
      ],
      next: "menu_financeiro",
    },

    // ---- Financeiro: sub-assunto ----
    menu_financeiro: {
      id: "menu_financeiro",
      type: "ask",
      text: "Certo! Sobre o Financeiro, qual é o assunto?",
      var: "motivo",
      listButton: "Ver opções",
      options: [
        {
          id: "pagamento",
          title: "Pagamento",
          description: "Quero gerar o link de pagamento",
          value: "pagamento",
          next: "fin_pede_doc",
        },
        {
          id: "regularizacao",
          title: "Regularização",
          description: "Quero regularizar meu pagamento",
          value: "regularizacao",
          next: "fin_pede_doc",
        },
        {
          id: "acordo",
          title: "Acordo financeiro",
          description: "Quero falar sobre um acordo",
          value: "acordo",
          next: "fin_pede_doc",
        },
      ],
      next: "fin_pede_doc",
    },
    fin_pede_doc: {
      id: "fin_pede_doc",
      type: "ask",
      text: PEDE_DOC,
      var: "email_cpf",
      next: "fin_confirma",
    },
    fin_confirma: {
      id: "fin_confirma",
      type: "message",
      text: CONFIRMA,
      next: "fin_transfere",
    },
    // Financeiro: escolha o atendente na aba Bot (assignTo vazio = rodízio do número).
    fin_transfere: { id: "fin_transfere", type: "handoff", to: "usuario", assignTo: "" },

    // ---- Secretaria: manda o número e encerra (não transfere) ----
    sec_fim: {
      id: "sec_fim",
      type: "end",
      text: "Para falar com a Secretaria, chame diretamente no número +55 11 94767-1223. 😊",
    },

    // ---- Vendas: manda o número e encerra (não transfere) ----
    vendas_fim: {
      id: "vendas_fim",
      type: "end",
      text: "Para falar com o time de Vendas, chame diretamente no número +55 11 99009-3005. 😊",
    },
  },
};
