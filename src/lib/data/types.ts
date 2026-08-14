export type Channel = "whatsapp" | "instagram" | "facebook" | "sms" | "email";

export interface User {
  id: string;
  name: string;
  email: string;
  role: "admin" | "user";
  color: string;
}

export interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  company?: string;
  tags: string[];
  ownerId: string;
  createdAt: string;
  lastActivityAt: string;
  lastActivityChannel: Channel;
  dnd: boolean;
  customFields: Record<string, string>;
}

export interface Stage {
  id: string;
  name: string;
  color: string;
  order: number;
}

export interface Pipeline {
  id: string;
  name: string;
  stages: Stage[];
}

export interface Opportunity {
  id: string;
  contactId: string;
  pipelineId: string;
  stageId: string;
  name: string;
  source: string;
  value: number;
  ownerId?: string;
  status: "open" | "won" | "lost";
  createdAt: string;
}

export type MessageType = "text" | "audio" | "image" | "file" | "event" | "video";

/** Ciclo de vida de uma mensagem agendada (migração 0028). */
export type ScheduleStatus = "pendente" | "enviando" | "enviada" | "falhou" | "cancelada";

export interface Message {
  id: string;
  conversationId: string;
  direction: "in" | "out";
  type: MessageType;
  channel: Channel;
  body: string;
  at: string;
  internal?: boolean;
  scheduledFor?: string;
  /** Mídia (image/file/audio): caminho no bucket privado conversation-media. */
  mediaPath?: string;
  mediaName?: string;
  mediaMime?: string;
  mediaSize?: number;
  /** WhatsApp: id da mensagem na Meta (casa status) e estado de entrega. */
  waMessageId?: string;
  status?: "sent" | "delivered" | "read" | "failed";
  /** Escrita por automação/IA, não por uma pessoa (migração 0027). */
  automated?: boolean;
  /** Log do agendamento (migração 0028) — só preenchido se scheduledFor existe. */
  scheduledBy?: string | null;
  scheduleStatus?: ScheduleStatus;
  dispatchedAt?: string;
  scheduleError?: string;
}

export interface Conversation {
  id: string;
  contactId: string;
  channel: Channel;
  unreadCount: number;
  lastMessageAt: string;
  lastMessagePreview: string;
  starred: boolean;
  slaDays: number;
  /** WhatsApp: canal/número que originou a conversa (nulo p/ outros canais). */
  channelId?: string;
  /** Responsável pelo atendimento; null = caixa do grupo (migração 0024). */
  assignedTo?: string | null;
  /** Finalizada e arquivada são independentes (migração 0029): null = não. */
  closedAt?: string | null;
  closedBy?: string | null;
  archivedAt?: string | null;
  archivedBy?: string | null;
}

/** Abas de filtro da caixa de entrada. */
export type ConversationFilter = "unread" | "all" | "recent" | "starred";

/** Escopo do rail: grupo, minhas, ou conversas tocadas por automação/IA. */
export type InboxScope = "group" | "mine" | "bot";

/** Qual pilha a caixa está mostrando (migração 0029). */
export type InboxStatusView = "abertas" | "finalizadas" | "arquivadas" | "todas";

/** Estado da caixa de entrada guardado numa visualização salva (migração 0027). */
export interface InboxViewConfig {
  scope: InboxScope;
  filter: ConversationFilter;
  sort: string;
  query: string;
  /** Ausente nas visualizações salvas antes da 0029 → "abertas". */
  status: InboxStatusView;
}

export interface InboxView {
  id: string;
  name: string;
  config: InboxViewConfig;
}

export type NodeCategory =
  | "contato"
  | "oportunidade"
  | "comunicacao"
  | "logica"
  | "ia"
  | "marketing";

export interface WorkflowNode {
  id: string;
  kind: "trigger" | "action";
  key: string;
  label: string;
  category: NodeCategory;
}

export interface Workflow {
  id: string;
  name: string;
  folder: string | null;
  status: "published" | "draft";
  enrolledTotal: number;
  enrolledActive: number;
  createdAt: string;
  updatedAt: string;
  trigger: WorkflowNode | null;
  actions: WorkflowNode[];
}

export interface Appointment {
  id: string;
  contactId: string | null;
  title: string;
  start: string;
  end: string;
  calendar: string;
  source: "google" | "crm";
}

export interface FormField {
  key: string;
  label: string;
  type: "text" | "email" | "tel" | "textarea";
  required: boolean;
  /** name | email | phone | company | custom:<nome do campo> */
  mapsTo: string;
}

export interface LeadForm {
  id: string;
  slug: string;
  name: string;
  description: string;
  fields: FormField[];
  successAction: "redirect" | "message";
  successValue: string;
  tag: string;
  smartListId: string | null;
  active: boolean;
  createdAt: string;
}
