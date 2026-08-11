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

export type MessageType = "text" | "audio" | "image" | "file" | "event";

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
