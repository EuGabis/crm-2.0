import type { NodeCategory } from "@/lib/data/types";

export interface CatalogNode {
  key: string;
  label: string;
  category: NodeCategory;
}

export const CATEGORY_LABEL: Record<NodeCategory, string> = {
  contato: "Contato",
  oportunidade: "Oportunidade",
  comunicacao: "Comunicação",
  logica: "Lógica interna",
  ia: "Inteligência Artificial",
  marketing: "Marketing",
};

export const TRIGGERS: CatalogNode[] = [
  { key: "etapa-alterada", label: "Etapa do funil alterada", category: "oportunidade" },
  { key: "tag-contato", label: "Tag de contato", category: "contato" },
  { key: "cliente-respondeu", label: "Cliente enviou mensagem", category: "contato" },
  { key: "compromisso-agendado", label: "Compromisso agendado", category: "contato" },
  { key: "contato-criado", label: "Contato criado", category: "contato" },
  { key: "aniversario", label: "Lembrete de aniversário", category: "contato" },
  { key: "contato-alterado", label: "Contato alterado", category: "contato" },
  { key: "contato-dnd", label: "Contato com DND", category: "contato" },
  { key: "formulario-enviado", label: "Formulário enviado", category: "marketing" },
  { key: "chamada-perdida", label: "Chamada perdida", category: "comunicacao" },
];

export const ACTIONS: CatalogNode[] = [
  { key: "atualizar-oportunidade", label: "Criar/atualizar oportunidade", category: "oportunidade" },
  { key: "atribuir-usuario", label: "Atribuir ao usuário", category: "contato" },
  { key: "adicionar-tag", label: "Adicionar tag", category: "contato" },
  { key: "remover-tag", label: "Remover tag", category: "contato" },
  { key: "atualizar-campo", label: "Atualizar campo de contato", category: "contato" },
  { key: "adicionar-tarefa", label: "Adicionar tarefa", category: "contato" },
  { key: "enviar-whatsapp", label: "Enviar WhatsApp", category: "comunicacao" },
  { key: "enviar-sms", label: "Enviar SMS", category: "comunicacao" },
  { key: "enviar-email", label: "Enviar e-mail", category: "comunicacao" },
  { key: "nota-interna", label: "Nota interna", category: "comunicacao" },
  { key: "if-else", label: "If/Else", category: "logica" },
  { key: "esperar", label: "Esperar", category: "logica" },
  { key: "ir-para", label: "Ir para", category: "logica" },
  { key: "split-test", label: "Dividir (split test)", category: "logica" },
  { key: "webhook", label: "Webhook personalizado", category: "logica" },
  { key: "conversao-meta", label: "API de conversão da Meta", category: "marketing" },
  { key: "agente-ia", label: "Agente de IA", category: "ia" },
];
