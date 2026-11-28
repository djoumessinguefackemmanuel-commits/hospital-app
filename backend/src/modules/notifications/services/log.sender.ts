import type { Logger } from '../../../core/logger/logger';
import type { Channel, NotificationSender, OutgoingMessage } from '../models/notification.model';

/** Destinataire masqué pour les journaux (jamais d'adresse ou de numéro complet). */
export function maskRecipient(to: string): string {
  if (to.includes('@')) {
    const [user = '', domain = ''] = to.split('@');
    return `${user.slice(0, 1)}***@${domain}`;
  }
  return `${'*'.repeat(Math.max(0, to.length - 3))}${to.slice(-3)}`;
}

/**
 * Canal de développement : n'envoie rien, journalise l'envoi (destinataire masqué, sans contenu).
 * À remplacer par un fournisseur réel (SMTP, passerelle SMS) implémentant NotificationSender.
 */
export class LogSender implements NotificationSender {
  constructor(
    readonly channel: Channel,
    private readonly logger: Logger,
  ) {}

  async send(message: OutgoingMessage): Promise<void> {
    this.logger.info({ channel: this.channel, to: maskRecipient(message.to) }, 'notification (mode journal, non envoyée)');
  }
}
