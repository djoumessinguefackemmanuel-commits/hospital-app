import type { EventBus } from '../../core/events/event-bus';
import type { Logger } from '../../core/logger/logger';
import type { Middlewares } from '../../core/middlewares';
import { EventTypes, type ContactDirectory, type SettingsReader } from '../../shared/contracts';
import { NotificationController } from './controllers/notification.controller';
import type { NotificationSender } from './models/notification.model';
import type { NotificationRepository } from './repositories/notification.repository';
import { createNotificationRoutes } from './routes/notification.routes';
import { LogSender } from './services/log.sender';
import { NotificationService } from './services/notification.service';

export interface NotificationsModuleDeps {
  repo: NotificationRepository;
  bus: EventBus;
  settings: SettingsReader;
  contacts: ContactDirectory;
  logger: Logger;
  /** Canaux réels ; à défaut, un canal « journal » qui n'envoie rien. */
  senders?: NotificationSender[];
}

export function createNotificationsModule(deps: NotificationsModuleDeps) {
  const senders = deps.senders ?? [new LogSender('EMAIL', deps.logger), new LogSender('SMS', deps.logger)];
  const service = new NotificationService(deps.repo, deps.settings, deps.contacts, senders, deps.logger);
  deps.bus.subscribe(EventTypes.RDV_CREATED, (e) => service.onRdvCreated(e));
  deps.bus.subscribe(EventTypes.RDV_CANCELLED, (e) => service.onRdvCancelled(e));
  const controller = new NotificationController(service);
  return { service, createRouter: (m: Middlewares) => createNotificationRoutes(controller, m) };
}

export { PrismaNotificationRepository } from './repositories/notification.repository';
export { NOTIF_PERMISSION_CATALOG } from './catalog';
export type { NotificationSender } from './models/notification.model';
