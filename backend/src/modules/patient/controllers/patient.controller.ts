import type { Request, Response } from 'express';
import type { CreatePatientDto, SearchQueryDto, UpdatePatientDto } from '../dtos/patient.dto';
import type { PatientActor } from '../models/patient.model';
import type { PatientService } from '../services/patient.service';

export class PatientController {
  constructor(private readonly service: PatientService) {}

  private actor(req: Request): PatientActor {
    const u = req.user!;
    return { userId: u.userId, etablissementId: u.etablissementId, permissions: u.permissions, correlationId: req.ctx.correlationId };
  }

  create = async (req: Request, res: Response) => {
    res.status(201).json({ data: await this.service.create(req.validated.body as CreatePatientDto, this.actor(req)) });
  };

  get = async (req: Request, res: Response) => {
    const { id } = req.validated.params as { id: string };
    res.json({ data: await this.service.get(id, this.actor(req)) });
  };

  update = async (req: Request, res: Response) => {
    const { id } = req.validated.params as { id: string };
    res.json({ data: await this.service.update(id, req.validated.body as UpdatePatientDto, this.actor(req)) });
  };

  search = async (req: Request, res: Response) => {
    res.json({ data: await this.service.search(req.validated.query as SearchQueryDto, this.actor(req)) });
  };
}
