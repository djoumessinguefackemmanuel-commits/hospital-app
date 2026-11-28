import type { Request, Response } from 'express';
import type { NotifActor, NotificationFilter } from '../models/notification.model';
import type { NotificationService } from '../services/notification.service';

export class NotificationController {
  constructor(private readonly service: NotificationService) {}

  private actor(req: Request): NotifActor {
    const u = req.user!;
    return { userId: u.userId, etablissementId: u.etablissementId, permissions: u.permissions, correlationId: req.ctx.correlationId };
  }

  list = async (req: Request, res: Response) => {
    const { limit, offset, ...filter } = req.validated.query as NotificationFilter & { limit: number; offset: number };
    res.json({ data: await this.service.list(filter, limit, offset, this.actor(req)) });
  };

  retry = async (req: Request, res: Response) => {
    const { id } = req.validated.params as { id: string };
    await this.service.retry(id, this.actor(req));
    res.status(202).end();
  };
}
