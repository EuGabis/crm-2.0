import type { BotFlow } from "../types";

/**
 * Triagem por assunto — fluxo do Gabriel.
 *
 * Cliente manda mensagem →
 *   - já CADASTRADO (etiqueta "cadastrado")  → pede e-mail → atualiza e-mail
 *   - NÃO cadastrado                          → pede nome  → pede e-mail → atualiza
 *   → pergunta o curso
 *   → lista de ASSUNTO — CADA opção segue pro SEU ramo:
 *        "como posso te ajudar" → mensagem de fila → TRANSFERE para um atendente
 *        específico (escolhido na aba Bot).
 *
 * As transferências nascem SEM atendente escolhido (`assignTo` vazio) — abra a
 * aba WhatsApp → Bot, escolha a pessoa em cada "Transferir para atendente
 * específico" e salve. Enquanto não escolher, cai no rodízio do setor.
 */
const FILA =
  "Estamos com um número maior de atendimentos, o tempo de resposta aumentou. Por favor, não envie novas mensagens até você ser respondido, para não mudar seu lugar na fila de espera. Basta aguardar que em breve iremos te atender.";

const AJUDA = "Agora, me diga como posso te ajudar.";

export const triagemFlow: BotFlow = {
  key: "triagem",
  name: "Triagem por assunto",
  start: "boas_vindas",
  nodes: {
    boas_vindas: {
      id: "boas_vindas",
      type: "message",
      text: "Saudações Aeronáuticas! 🛩️ Eu sou a Lita, assistente virtual da Lito Academy.",
      next: "cria_card",
    },
    cria_card: {
      id: "cria_card",
      type: "ensure_card",
      pipeline: "Controle de Leads",
      stage: "NOVO LEAD",
      next: "checa_cadastro",
    },
    // Já é da base? (etiqueta "cadastrado" no contato → vars.tem_cadastro="sim").
    checa_cadastro: {
      id: "checa_cadastro",
      type: "condition",
      var: "tem_cadastro",
      equals: "sim",
      ifTrue: "pede_email",
      ifFalse: "pede_nome",
    },

    // ---- Novo contato: pede o nome primeiro ----
    pede_nome: {
      id: "pede_nome",
      type: "ask",
      text: "Para começar, digite seu nome completo:",
      var: "nome",
      validate: "name",
      next: "salva_nome",
    },
    salva_nome: { id: "salva_nome", type: "set_name", fromVar: "nome", next: "pede_email" },

    // ---- Ambos: e-mail cadastrado → atualiza no sistema ----
    pede_email: {
      id: "pede_email",
      type: "ask",
      text: "Digite seu e-mail cadastrado na plataforma:",
      var: "email",
      next: "salva_email",
    },
    salva_email: {
      id: "salva_email",
      type: "set_contact",
      field: "email",
      fromVar: "email",
      next: "pede_curso",
    },

    // ---- Curso ----
    pede_curso: {
      id: "pede_curso",
      type: "ask",
      text: "Ok! Estamos quase lá! Agora digite qual é o seu curso (se for MMA, preciso saber qual especialização). Obrigado!",
      var: "curso",
      next: "pede_assunto",
    },

    // ---- Assunto: cada opção vai pro SEU ramo (sem condição no meio) ----
    pede_assunto: {
      id: "pede_assunto",
      type: "ask",
      text: "Clique em uma das opções sobre o assunto que deseja tratar:",
      var: "assunto",
      listButton: "Ver opções",
      options: [
        { id: "docs", title: "Documentos/Prova Sub", value: "docs", next: "ajuda_docs" },
        { id: "imersao", title: "Imersão Pres. MMA", value: "imersao", next: "ajuda_imersao" },
        { id: "outros", title: "Outros", value: "outros", next: "ajuda_outros" },
      ],
      next: "ajuda_outros",
    },

    // ---- Ramo Documentos/Prova Sub ----
    ajuda_docs: { id: "ajuda_docs", type: "ask", text: AJUDA, var: "detalhe", next: "fila_docs" },
    fila_docs: { id: "fila_docs", type: "message", text: FILA, next: "transfere_docs" },
    transfere_docs: { id: "transfere_docs", type: "handoff", to: "usuario", assignTo: "" },

    // ---- Ramo Imersão Pres. MMA ----
    ajuda_imersao: { id: "ajuda_imersao", type: "ask", text: AJUDA, var: "detalhe", next: "fila_imersao" },
    fila_imersao: { id: "fila_imersao", type: "message", text: FILA, next: "transfere_imersao" },
    transfere_imersao: { id: "transfere_imersao", type: "handoff", to: "usuario", assignTo: "" },

    // ---- Ramo Outros ----
    ajuda_outros: { id: "ajuda_outros", type: "ask", text: AJUDA, var: "detalhe", next: "fila_outros" },
    fila_outros: { id: "fila_outros", type: "message", text: FILA, next: "transfere_outros" },
    transfere_outros: { id: "transfere_outros", type: "handoff", to: "usuario", assignTo: "" },
  },
};
