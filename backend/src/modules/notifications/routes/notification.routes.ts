import { Router } from 'express';
import { wrap } from '../../../core/http/async-handler';
import type { Middlewares } from '../../../core/middlewares';
import type { NotificationController } from '../controllers/notification.controller';
import { listNotificationsQueryDto, notificationIdParamsDto } from '../dtos/notification.dto';

export const NOTIF_PERMISSIONS = { READ: 'NOTIF_NOTIFICATION_READ', RETRY: 'NOTIF_NOTIFICATION_RETRY' } as const;

export function createNotificationRoutes(c: NotificationController, m: Middlewares): Router {
  const r = Router();
  r.get('/', m.authenticate, m.authorize(NOTIF_PERMISSIONS.READ), m.auditLog('NOTIF_LIST'), m.validate({ query: listNotificationsQueryDto }),
    m.rateLimit({ name: 'notif-list', windowSec: 60, max: 120 }), wrap(c.list));
  r.post('/:id/retry', m.authenticate, m.authorize(NOTIF_PERMISSIONS.RETRY), m.auditLog('NOTIF_RETRY', { resourceId: (req) => req.params['id'] }),
    m.validate({ params: notificationIdParamsDto }), m.rateLimit({ name: 'notif-retry', windowSec: 60, max: 30 }), wrap(c.retry));
  return r;
}
