export type Channel = 'EMAIL' | 'SMS';
export type NotificationStatus = 'PENDING' | 'SENT' | 'FAILED' | 'CANCELLED' | 'SKIPPED';

export interface NewNotification {
  etablissementId: string;
  patientId: string;
  channel: Channel;
  template: string;
  subjectType: string;
  subjectId: string;
  payload: Record<string, unknown>;
  dedupeKey: string;
  scheduledFor: Date;
}

export interface NotificationRecord extends NewNotification {
  id: string;
  status: NotificationStatus;
  attempts: number;
  lastError: string | null;
  sentAt: Date | null;
}

export interface OutgoingMessage {
  to: string;
  subject?: string;
  body: string;
}

/** Canal d'envoi réel (e-mail, SMS) : branché par l'infrastructure, le module ne connaît aucun fournisseur. */
export interface NotificationSender {
  readonly channel: Channel;
  send(message: OutgoingMessage): Promise<void>;
}

export interface NotificationFilter {
  status?: NotificationStatus;
  patientId?: string;
}

export interface NotifActor {
  userId: string;
  etablissementId: string;
  permissions: string[];
  correlationId?: string;
}
