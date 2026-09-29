export type CampaignStatus =
  | "draft"
  | "scheduled"
  | "sending"
  | "sent"
  | "paused"
  | "failed";

export type AudienceType = "all" | "tag" | "smart_list";

export interface Audience {
  type: AudienceType;
  /** tag (nome), smart_list (id) ou null para "todos". Com várias, a PRIMEIRA. */
  value: string | null;
  /**
   * Todas as tags / listas escolhidas (o público é a UNIÃO delas).
   *
   * ⚠️ `value` continua gravado com a primeira: campanha antiga não tem
   * `values`, e `private.materialize_recipients` (0010) só lê `value` — com
   * várias, quem manda os destinatários é o navegador (`contactIds`).
   */
  values?: string[];
}

/** As tags/listas do público, também para campanha antiga (só `value`). */
export function valoresDoPublico(a: Audience): string[] {
  if (a.values?.length) return a.values;
  return a.value ? [a.value] : [];
}

export interface Campaign {
  id: string;
  name: string;
  subject: string;
  fromEmail: string;
  replyTo: string | null;
  bodyHtml: string;
  bodyText: string;
  audience: Audience;
  accentColor: string | null;
  status: CampaignStatus;
  scheduledAt: string | null;
  total: number;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  bounced: number;
  failed: number;
  unsubscribed: number;
  createdAt: string;
}

export type RecipientStatus =
  | "pending"
  | "sent"
  | "delivered"
  | "opened"
  | "clicked"
  | "bounced"
  | "failed"
  | "skipped";

export interface Recipient {
  id: string;
  contactId: string;
  email: string;
  status: RecipientStatus;
  sentAt: string | null;
  deliveredAt: string | null;
  openedAt: string | null;
  clickedAt: string | null;
  error: string | null;
}
