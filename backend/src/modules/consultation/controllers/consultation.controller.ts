import type { Request, Response } from 'express';
import type { CreateAppointmentDto, ListAppointmentsQueryDto, ScheduleDto, SlotsQueryDto } from '../dtos/consultation.dto';
import type { ConsultActor } from '../models/consultation.model';
import type { ConsultationService } from '../services/consultation.service';

export class ConsultationController {
  constructor(private readonly service: ConsultationService) {}

  private actor(req: Request): ConsultActor {
    const u = req.user!;
    return { userId: u.userId, etablissementId: u.etablissementId, permissions: u.permissions, correlationId: req.ctx.correlationId };
  }

  setSchedule = async (req: Request, res: Response) => {
    const { practitionerId } = req.validated.params as { practitionerId: string };
    res.json({ data: await this.service.setSchedule(practitionerId, req.validated.body as ScheduleDto, this.actor(req)) });
  };

  slots = async (req: Request, res: Response) => {
    const { practitionerId } = req.validated.params as { practitionerId: string };
    const { from, to } = req.validated.query as SlotsQueryDto;
    res.json({ data: await this.service.freeSlots(practitionerId, from, to, this.actor(req)) });
  };

  book = async (req: Request, res: Response) => {
    res.status(201).json({ data: await this.service.book(req.validated.body as CreateAppointmentDto, this.actor(req)) });
  };

  list = async (req: Request, res: Response) => {
    res.json({ data: await this.service.list(req.validated.query as ListAppointmentsQueryDto, this.actor(req)) });
  };

  cancel = async (req: Request, res: Response) => {
    const { id } = req.validated.params as { id: string };
    const { reason } = req.validated.body as { reason: string };
    res.json({ data: await this.service.cancel(id, reason, this.actor(req)) });
  };
}
