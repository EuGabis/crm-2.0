import type { BotFlow } from "../types";

/**
 * Triagem por assunto — fluxo do Gabriel.
 *
 * Cliente manda mensagem →
 *   - já CADASTRADO (etiqueta "cadastrado")  → pede e-mail → atualiza e-mail
 *   - NÃO cadastrado                          → pede nome  → pede e-mail → atualiza
 *   → pergunta o curso
 *   → lista de ASSUNTO (Documentos/Prova Sub · Imersão Pres. MMA · Outros)
 *   → "como posso te ajudar" → mensagem de fila
 *   → TRANSFERE para um atendente específico (escolhido na aba Bot por assunto).
 *
 * As transferências nascem SEM atendente escolhido (`assignTo` vazio) — abra a
 * aba Bot, escolha a pessoa em cada "Transferir para atendente específico" e
 * salve. Enquanto não escolher, cai no rodízio do setor.
 */
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
    // Garante um card do lead em NOVO LEAD já na 1ª mensagem.
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
    salva_nome: {
      id: "salva_nome",
      type: "set_name",
      fromVar: "nome",
      next: "pede_email",
    },

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

    // ---- Assunto (lista de opções) ----
    pede_assunto: {
      id: "pede_assunto",
      type: "ask",
      text: "Clique em uma das opções sobre o assunto que deseja tratar:",
      var: "assunto",
      listButton: "Ver opções",
      options: [
        { id: "docs", title: "Documentos/Prova Sub", value: "docs" },
        { id: "imersao", title: "Imersão Pres. MMA", value: "imersao" },
        { id: "outros", title: "Outros", value: "outros" },
      ],
      next: "pede_ajuda",
    },

    // ---- Comum a todos os assuntos ----
    pede_ajuda: {
      id: "pede_ajuda",
      type: "ask",
      text: "Agora, me diga como posso te ajudar.",
      var: "detalhe",
      next: "msg_fila",
    },
    msg_fila: {
      id: "msg_fila",
      type: "message",
      text: "Estamos com um número maior de atendimentos, o tempo de resposta aumentou. Por favor, não envie novas mensagens até você ser respondido, para não mudar seu lugar na fila de espera. Basta aguardar que em breve iremos te atender.",
      next: "rota_transfer_1",
    },

    // ---- Roteia a transferência pelo assunto ----
    rota_transfer_1: {
      id: "rota_transfer_1",
      type: "condition",
      var: "assunto",
      equals: "docs",
      ifTrue: "transfere_docs",
      ifFalse: "rota_transfer_2",
    },
    rota_transfer_2: {
      id: "rota_transfer_2",
      type: "condition",
      var: "assunto",
      equals: "imersao",
      ifTrue: "transfere_imersao",
      ifFalse: "transfere_outros",
    },

    // ---- Transferências (escolha o atendente de cada uma na aba Bot) ----
    transfere_docs: {
      id: "transfere_docs",
      type: "handoff",
      to: "usuario",
      assignTo: "",
    },
    transfere_imersao: {
      id: "transfere_imersao",
      type: "handoff",
      to: "usuario",
      assignTo: "",
    },
    transfere_outros: {
      id: "transfere_outros",
      type: "handoff",
      to: "usuario",
      assignTo: "",
    },
  },
};
