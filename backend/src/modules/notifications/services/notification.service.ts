import type { Logger } from '../../../core/logger/logger';
import { ConflictError, NotFoundError } from '../../../core/errors/app-error';
import type { ContactDirectory, DomainEvent, SettingsReader } from '../../../shared/contracts';
import type { Channel, NewNotification, NotifActor, NotificationFilter, NotificationRecord, NotificationSender } from '../models/notification.model';
import type { NotificationRepository } from '../repositories/notification.repository';
import { renderTemplate } from './templates';
import { quietHoursEnd } from './time';

const HOUR = 3_600_000;
const SUBJECT = 'APPOINTMENT';

interface RdvCreated { appointmentId: string; patientId: string; startsAt: string; reminderOffsetsH?: number[] }
interface RdvCancelled { appointmentId: string; patientId: string; startsAt?: string }

export class NotificationService {
  private readonly senders = new Map<Channel, NotificationSender>();
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly repo: NotificationRepository,
    private readonly settings: SettingsReader,
    private readonly contacts: ContactDirectory,
    senders: NotificationSender[],
    private readonly logger: Logger,
    private readonly clock: () => Date = () => new Date(),
  ) {
    for (const s of senders) this.senders.set(s.channel, s);
  }

  private async channels(etablissementId: string): Promise<Channel[]> {
    const enabled = await this.settings.get<string[]>('notif.channels.enabled', { etablissementId });
    return enabled.map((c) => c.toUpperCase()).filter((c): c is Channel => c === 'EMAIL' || c === 'SMS');
  }

  private build(event: DomainEvent, appointmentId: string, patientId: string, channel: Channel, key: string, template: string, at: Date, payload: Record<string, unknown>): NewNotification {
    return {
      etablissementId: event.etablissementId as string, patientId, channel, template, subjectType: SUBJECT, subjectId: appointmentId,
      payload, dedupeKey: `rdv:${appointmentId}:${key}:${channel}`, scheduledFor: at,
    };
  }

  /** `rdv.created` : confirmation immédiate + un rappel par délai paramétré (idempotent). */
  async onRdvCreated(event: DomainEvent): Promise<void> {
    if (!event.etablissementId) return;
    const d = event.data as RdvCreated;
    const now = this.clock();
    const start = new Date(d.startsAt);
    const items: NewNotification[] = [];
    for (const channel of await this.channels(event.etablissementId)) {
      items.push(this.build(event, d.appointmentId, d.patientId, channel, 'confirm', 'rdv.confirmation', now, { startsAt: d.startsAt }));
      for (const h of d.reminderOffsetsH ?? []) {
        const at = new Date(start.getTime() - h * HOUR);
        if (at > now) items.push(this.build(event, d.appointmentId, d.patientId, channel, `h${h}`, 'rdv.reminder', at, { startsAt: d.startsAt, offsetH: h }));
      }
    }
    await this.repo.createMany(items);
  }

  /** `rdv.cancelled` : annule les rappels en attente et prévient le patient. */
  async onRdvCancelled(event: DomainEvent): Promise<void> {
    if (!event.etablissementId) return;
    const d = event.data as RdvCancelled;
    const now = this.clock();
    await this.repo.cancelBySubject(SUBJECT, d.appointmentId, now);
    const channels = await this.channels(event.etablissementId);
    await this.repo.createMany(channels.map((c) => this.build(event, d.appointmentId, d.patientId, c, 'cancelled', 'rdv.cancelled', now, { startsAt: d.startsAt })));
  }

  /** Envoie les notifications dues : silence nocturne, contact introuvable, réessais avec temporisation. */
  async dispatchDue(now = this.clock(), batch = 50): Promise<number> {
    const due = await this.repo.claimDue(batch, now);
    for (const n of due) {
      try {
        await this.deliver(n, now);
      } catch (err) {
        this.logger.error({ err, notificationId: n.id }, 'échec inattendu de notification');
        await this.repo.reschedule(n.id, new Date(now.getTime() + 5 * 60_000), 'erreur interne', false).catch(() => undefined);
      }
    }
    return due.length;
  }

  private async deliver(n: NotificationRecord, now: Date): Promise<void> {
    const scope = { etablissementId: n.etablissementId };
    const [tz, quiet, maxRetry] = await Promise.all([
      this.settings.get<string>('l10n.timezone', scope),
      this.settings.get<{ start: string; end: string }>('notif.quiet_hours', scope),
      this.settings.get<number>('notif.retry.max', scope),
    ]);
    const quietEnd = quietHoursEnd(now, quiet, tz);
    if (quietEnd) return this.repo.reschedule(n.id, quietEnd, undefined, true);

    const contact = await this.contacts.getContact(n.patientId, n.etablissementId);
    const to = n.channel === 'EMAIL' ? contact?.email : contact?.phone;
    if (!to) return this.repo.markSkipped(n.id, 'aucun contact pour ce canal');
    const sender = this.senders.get(n.channel);
    if (!sender) return this.repo.markFailed(n.id, `aucun fournisseur pour le canal ${n.channel}`);

    try {
      await sender.send({ to, ...renderTemplate(n.template, n.channel, n.payload, tz) });
      await this.repo.markSent(n.id, now);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (n.attempts > maxRetry) return this.repo.markFailed(n.id, message);
      await this.repo.reschedule(n.id, new Date(now.getTime() + 5 * 60_000 * 2 ** (n.attempts - 1)), message, false);
    }
  }

  list(filter: NotificationFilter, limit: number, offset: number, actor: NotifActor) {
    return this.repo.list(actor.etablissementId, filter, limit, offset);
  }

  async retry(id: string, actor: NotifActor): Promise<void> {
    const n = await this.repo.findById(id);
    if (!n || n.etablissementId !== actor.etablissementId) throw new NotFoundError('Notification introuvable', 'notification_not_found');
    if (!(await this.repo.requeue(id, this.clock()))) throw new ConflictError('Seules les notifications en échec peuvent être relancées', 'notification_not_failed');
  }

  start(intervalMs: number): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = true;
      this.dispatchDue()
        .catch((err) => this.logger.error({ err }, 'erreur du dispatcher de notifications'))
        .finally(() => {
          this.running = false;
        });
    }, intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
