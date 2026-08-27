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
  /** CPF/CNPJ (migração 0048) — chave principal do cruzamento com a Guru. */
  doc?: string;
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

/** Quem enxerga o pipeline (migração 0039). Ausente nos repos mock. */
export type PipelineScope = "empresa" | "department" | "user";

export interface Pipeline {
  id: string;
  name: string;
  stages: Stage[];
  scope?: PipelineScope;
  /** Preenchido quando scope = "department". */
  departmentId?: string | null;
  /** Preenchido quando scope = "user". */
  ownerId?: string | null;
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
  /** Curso/formação escolhido para este lead (seletor no card do funil). */
  course?: string;
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
  /** Responder (citação, migração 0077): id da mensagem sendo respondida. */
  replyTo?: string;
  /** WhatsApp: id da mensagem na Meta (casa status) e estado de entrega. */
  waMessageId?: string;
  status?: "sent" | "delivered" | "read" | "failed";
  /** Carimbos de entrega/leitura do WhatsApp (migração 0031) — para o rastreio. */
  deliveredAt?: string;
  readAt?: string;
  /** Motivo da falha de envio/entrega (messages.error_detail, 0031). */
  errorDetail?: string;
  /** Reações (emoji) na mensagem — uma por pessoa, como no WhatsApp. */
  reactions?: { emoji: string; by: string; at: string }[];
  /** Escrita por automação/IA, não por uma pessoa (migração 0027). */
  automated?: boolean;
  /** Transcrição do áudio (migração 0085). */
  transcription?: string;
  transcriptionStatus?: "pendente" | "ok" | "falhou" | "ignorado";
  transcriptionError?: string;
  /** Quem escreveu (migração 0051); nulo nas mensagens anteriores a ela. */
  createdBy?: string | null;
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
  /** Início da conversa (created_at) — usado no relatório. */
  createdAt?: string;
  /** Bot pausado = humano assumiu (migração 0032). false = bot ainda ativo. */
  botPaused?: boolean;
  /** Lead quente qualificado sem ninguém online — aguardando distribuição (0056). */
  awaitingDistribution?: boolean;
  /** Lead distribuído a este atendente enquanto TODOS estavam offline (0060). */
  assignedOffline?: boolean;
  /** Nome/telefone do contato EMBUTIDOS na consulta — para a lista mostrar o nome
   *  sem depender do store inteiro de contatos (não escala com 50 mil). */
  contactFirstName?: string;
  contactLastName?: string;
  contactPhone?: string;
  contactEmail?: string;
}

/** Abas de filtro da caixa de entrada. */
export type ConversationFilter = "unread" | "all" | "recent" | "starred";

/** Escopo do rail: grupo, minhas, ou conversas tocadas por automação/IA. */
export type InboxScope = "group" | "mine" | "bot" | "offline";

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
  /** Parâmetros da ação/gatilho (texto da nota, tag, assunto do e-mail, etc.). */
  config?: Record<string, unknown>;
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
  /** Lead (oportunidade) da negociação — migração 0041. */
  opportunityId?: string | null;
  /** Minutos antes do início para o CRM avisar; null = sem lembrete (0042). */
  reminderMinutes?: number | null;
  /** Dono da agenda; null = compromisso da empresa, visível a todos (0043). */
  ownerId?: string | null;
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
