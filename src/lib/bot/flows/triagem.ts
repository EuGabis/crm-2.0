import type { BotFlow } from "../types";

/**
 * Triagem Comercial — reconstruído do fluxo que o cliente tinha no n8n/RVOPS.
 * Boas-vindas → nome → curso → conhece o Lito → objetivo → situação → SCORING
 * (quente/frio, mesmos pesos do n8n) → quente vira handoff pro consultor / frio
 * recebe o link. Textos e opções ficam aqui pra ajustar fácil.
 */
export const triagemFlow: BotFlow = {
  key: "triagem",
  name: "Triagem Comercial",
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
    // Já na 1ª mensagem: garante um card do lead em "NOVO LEAD" (se não existir).
    cria_card: {
      id: "cria_card",
      type: "ensure_card",
      pipeline: "Controle de Leads",
      stage: "NOVO LEAD",
      next: "pergunta_nome",
    },
    pergunta_nome: {
      id: "pergunta_nome",
      type: "ask",
      text: "Digite o seu nome:",
      var: "name",
      validate: "name",
      next: "salva_nome",
    },
    salva_nome: {
      id: "salva_nome",
      type: "set_name",
      fromVar: "name",
      next: "pergunta_curso",
    },
    pergunta_curso: {
      id: "pergunta_curso",
      type: "ask",
      text: "{{first_name}}, clique em qual curso quer fazer?",
      var: "curso",
      listButton: "Ver cursos",
      options: [
        { id: "curso_mecanico", title: "Mecânico" },
        { id: "curso_comissario", title: "Comissário" },
        { id: "curso_piloto", title: "Piloto" },
        { id: "curso_pos", title: "Pós de Engenheiros" },
        { id: "curso_masterclass", title: "Masterclass" },
      ],
      next: "pergunta_conhece",
    },
    pergunta_conhece: {
      id: "pergunta_conhece",
      type: "ask",
      text: "{{first_name}}, você conhece o Lito?",
      var: "conhece_lito",
      listButton: "Responder",
      options: [
        { id: "conhece_sempre", title: "Conheço e assisto sempre" },
        { id: "conhece_asvezes", title: "Sim e assisto as vezes" },
        { id: "conhece_algum", title: "Já vi algum vídeo" },
        { id: "conhece_nao", title: "Não conheço" },
      ],
      next: "pergunta_objetivo",
    },
    pergunta_objetivo: {
      id: "pergunta_objetivo",
      type: "ask",
      text: "{{first_name}}, em qual momento você está hoje em relação ao seu objetivo na aviação?",
      var: "objetivo",
      listButton: "Responder",
      options: [
        { id: "obj_agora", title: "Agora" },
        { id: "obj_breve", title: "Em breve" },
        { id: "obj_anoquevem", title: "Ano que vem" },
        { id: "obj_curiosidade", title: "Apenas Curiosidade" },
      ],
      next: "pergunta_situacao",
    },
    pergunta_situacao: {
      id: "pergunta_situacao",
      type: "ask",
      text: "{{first_name}}, qual dessas situações mais representa você hoje?",
      var: "situacao",
      listButton: "Responder",
      options: [
        { id: "sit_trabalho", title: "Mudar Trabalho" },
        { id: "sit_financeira", title: "Financeira" },
        { id: "sit_paixao", title: "Paixão pela aviação" },
        { id: "sit_curiosidade", title: "Curiosidade" },
      ],
      next: "qualifica",
    },
    // Scoring: mesmos pesos do n8n (conhece_lito + objetivo). soma >= 11 = quente.
    qualifica: {
      id: "qualifica",
      type: "score",
      var: "qualificacao",
      threshold: 11,
      hotValue: "quente",
      coldValue: "frio",
      weights: {
        conhece_lito: {
          "conheco e assisto sempre": 10,
          "sim e assisto as vezes": 8,
          "ja vi algum video": 4,
          "nao conheco": 0,
        },
        objetivo: {
          agora: 10,
          "em breve": 8,
          "ano que vem": 4,
          "apenas curiosidade": 0,
        },
      },
      next: "atualiza_card",
    },
    // Atualiza o card no funil: nome do lead + move pra etapa conforme quente/frio.
    atualiza_card: {
      id: "atualiza_card",
      type: "sync_card",
      pipeline: "Controle de Leads",
      var: "qualificacao",
      stageMap: {
        quente: "QUENTE",
        frio: "NOVO LEAD",
      },
      next: "rota_qualificacao",
    },
    rota_qualificacao: {
      id: "rota_qualificacao",
      type: "condition",
      var: "qualificacao",
      equals: "quente",
      ifTrue: "pergunta_contato",
      ifFalse: "frio_link",
    },
    // QUENTE: pergunta preferência e passa pro consultor humano.
    pergunta_contato: {
      id: "pergunta_contato",
      type: "ask",
      text: "{{first_name}}, obrigado pela resposta! Você vai ser direcionado para nosso consultor de carreira. Como prefere o contato?",
      var: "pref_contato",
      listButton: "Escolher",
      options: [
        { id: "pref_ligacao", title: "Ligação" },
        { id: "pref_mensagem", title: "Mensagem" },
      ],
      next: "distribuir_lead",
    },
    distribuir_lead: {
      id: "distribuir_lead",
      type: "distribute",
      pipeline: "Controle de Leads",
      text: "Perfeito, {{first_name}}! Já estou passando você para um consultor. Em breve alguém da nossa tripulação fala com você por aqui. ✈️",
    },
    // FRIO: manda o link e deixa o agente de IA seguir tirando dúvidas.
    frio_link: {
      id: "frio_link",
      type: "handoff",
      to: "ia",
      text:
        "Obrigado pelas respostas, {{first_name}}! Você pode ver tudo sobre os nossos cursos neste link: " +
        "https://litoaviationacademy.com.br/\n\nFicou com alguma dúvida? Pode me perguntar por aqui que eu te ajudo. ✈️",
    },
  },
};
