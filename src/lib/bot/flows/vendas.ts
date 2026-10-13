import type { BotFlow } from "../types";

/**
 * Triagem Vendas — a qualificação NOVA do Gabriel (2026-10-13).
 *
 * ⚠️ **É um bot NOVO, não substitui a "Triagem Comercial" (`triagem`).** Pedido
 * explícito: "crie um bot novo e não substitua o atual, para não termos
 * problemas". Os dois coexistem; quem decide qual roda é o seletor "Bot de
 * atendimento" do NÚMERO, em Canais. Trocar de volta é um clique.
 *
 * ⚠️ **O bot que RODA é a cópia no banco**, criada pela migração
 * 202610131500 a partir da Triagem Comercial de produção (funil, etapas e textos
 * dela, só com as duas perguntas que pontuam e a régua trocadas). Este arquivo é
 * só o padrão em código, usado quando a empresa não tem a linha em `bot_flows`.
 *
 * Perguntas: nome → curso → quando começa → como investe → situação.
 * **Só as perguntas 3 e 4 pontuam.** Soma ≥ 10 = qualificado (quente) e vai
 * para o rodízio; abaixo disso recebe o agradecimento com o site.
 *
 * ⚠️ O peso é casado pelo `value` da opção (normalizado: minúsculo, sem acento),
 * não pelo título. O título é o que cabe na lista do WhatsApp (24 caracteres);
 * o `value` é a frase inteira, que é o que fica gravado no relatório e na
 * auditoria da nota (`bot_desfechos.respostas`). Mudar o `value` de uma opção
 * no editor sem mudar a chave correspondente em `weights` zera aquele peso.
 */
export const vendasFlow: BotFlow = {
  key: "triagem-vendas",
  name: "Triagem Vendas (nova qualificação)",
  start: "boas_vindas",
  nodes: {
    boas_vindas: {
      id: "boas_vindas",
      type: "message",
      text:
        "Saudações Aeronáuticas, eu sou a Lita, assistente virtual da Lito Academy.\n" +
        "Para ser atendido mais rapidamente pela nossa tripulação humana, você precisa responder 5 perguntinhas muito rápidas:",
      next: "cria_card",
    },
    cria_card: {
      id: "cria_card",
      type: "ensure_card",
      pipeline: "Controle de Leads",
      stage: "NOVO LEAD",
      next: "pergunta_nome",
    },

    // ---- 1. Nome ----
    pergunta_nome: {
      id: "pergunta_nome",
      type: "ask",
      text: "Qual o seu nome?",
      var: "name",
      validate: "name",
      next: "salva_nome",
    },
    salva_nome: { id: "salva_nome", type: "set_name", fromVar: "name", next: "pergunta_curso" },

    // ---- 2. Curso ----
    pergunta_curso: {
      id: "pergunta_curso",
      type: "ask",
      text: "{{first_name}}, clique no seu curso de interesse:",
      var: "curso",
      listButton: "Ver cursos",
      options: [
        { id: "curso_mecanico", title: "Mecânico" },
        { id: "curso_comissario", title: "Comissário" },
        { id: "curso_piloto", title: "Piloto" },
        { id: "curso_pos", title: "Pós de Engenheiros" },
        { id: "curso_masterclass", title: "Masterclass" },
      ],
      next: "pergunta_inicio",
    },

    // ---- 3. Quando começa (PONTUA) ----
    pergunta_inicio: {
      id: "pergunta_inicio",
      type: "ask",
      text: "{{first_name}}, quando você pretende começar o curso?",
      var: "inicio",
      listButton: "Responder",
      options: [
        { id: "ini_agora", title: "Quero começar agora", value: "Quero começar agora" },
        {
          id: "ini_2a3",
          title: "Em 2 ou 3 meses",
          description: "Nos próximos 2 ou 3 meses",
          value: "Nos próximos 2 ou 3 meses",
        },
        {
          id: "ini_12",
          title: "Nos próximos 12 meses",
          value: "Nos próximos 12 meses",
        },
        {
          id: "ini_pesquisando",
          title: "Só pesquisando",
          description: "Só estou pesquisando por enquanto",
          value: "Só estou pesquisando por enquanto",
        },
      ],
      next: "pergunta_investimento",
    },

    // ---- 4. Como investe (PONTUA) ----
    pergunta_investimento: {
      id: "pergunta_investimento",
      type: "ask",
      text: "{{first_name}}, se você gostar das condições, como pretende fazer o investimento?",
      var: "investimento",
      listButton: "Responder",
      options: [
        { id: "inv_avista", title: "À vista", value: "À vista" },
        { id: "inv_cartao", title: "Parcelado no cartão", value: "Parcelado no cartão" },
        {
          id: "inv_ajuda",
          title: "Preciso de ajuda",
          description: "Preciso de ajuda pra encontrar uma condição que caiba no meu bolso",
          value: "Preciso de ajuda pra encontrar uma condição que caiba no meu bolso",
        },
        {
          id: "inv_nao",
          title: "Não consigo investir",
          description: "No momento não consigo investir",
          value: "No momento não consigo investir",
        },
      ],
      next: "pergunta_situacao",
    },

    // ---- 5. Situação (NÃO pontua) ----
    pergunta_situacao: {
      id: "pergunta_situacao",
      type: "ask",
      text: "{{first_name}}, qual dessas situações mais representa você hoje?",
      var: "situacao",
      listButton: "Responder",
      options: [
        { id: "sit_trabalho", title: "Mudar Trabalho", description: "Quero mudar de trabalho pois não estou feliz com o meu" },
        { id: "sit_financeira", title: "Financeira", description: "Quero melhorar minha situação financeira" },
        { id: "sit_paixao", title: "Paixão pela aviação", description: "Sou apaixonado pela aviação e sempre quis trabalhar nela" },
        { id: "sit_curiosidade", title: "Curiosidade", description: "Quero conhecer o curso por curiosidade" },
      ],
      next: "qualifica",
    },

    // Só `inicio` + `investimento`. Soma ≥ 10 = quente. Máximo possível: 20.
    qualifica: {
      id: "qualifica",
      type: "score",
      var: "qualificacao",
      threshold: 10,
      hotValue: "quente",
      coldValue: "frio",
      weights: {
        inicio: {
          "quero comecar agora": 10,
          "nos proximos 2 ou 3 meses": 6,
          "nos proximos 12 meses": 3,
          "so estou pesquisando por enquanto": 0,
        },
        investimento: {
          "a vista": 10,
          "parcelado no cartao": 8,
          "preciso de ajuda pra encontrar uma condicao que caiba no meu bolso": 4,
          "no momento nao consigo investir": 0,
        },
      },
      next: "atualiza_card",
    },
    atualiza_card: {
      id: "atualiza_card",
      type: "sync_card",
      pipeline: "Controle de Leads",
      var: "qualificacao",
      stageMap: { quente: "Qualificado", frio: "Perdido" },
      next: "rota_qualificacao",
    },
    rota_qualificacao: {
      id: "rota_qualificacao",
      type: "condition",
      var: "qualificacao",
      equals: "quente",
      ifTrue: "distribuir_lead",
      ifFalse: "frio_link",
    },
    distribuir_lead: {
      id: "distribuir_lead",
      type: "distribute",
      pipeline: "Controle de Leads",
      text: "Perfeito, {{first_name}}! Já estou passando você para um consultor. Em breve alguém da nossa tripulação fala com você por aqui. ✈️",
    },
    frio_link: {
      id: "frio_link",
      type: "handoff",
      to: "ia",
      text:
        "Obrigado pelas respostas, você pode verificar todas as informações do nosso curso nesse link, " +
        "caso ainda tenha dúvidas, é só voltar aqui que eu te atendo: https://litoaviationacademy.com.br/",
    },
  },
};
