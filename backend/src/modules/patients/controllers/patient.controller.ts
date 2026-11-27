import type { Request, Response } from 'express';
import type { CreatePatientDto, SearchQueryDto, UpdatePatientDto } from '../dtos/patient.dto';
import type { PatientActor } from '../models/patient.model';
import type { MergeService } from '../services/merge.service';
import type { PatientService } from '../services/patient.service';
import type { MergeStatus } from '../models/patient.model';

export class PatientController {
  constructor(
    private readonly service: PatientService,
    private readonly merges: MergeService,
  ) {}

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

  requestMerge = async (req: Request, res: Response) => {
    const merge = await this.merges.request(req.validated.body as { sourceId: string; targetId: string; reason: string }, this.actor(req));
    res.status(merge.status === 'COMPLETED' ? 201 : 202).json({ data: merge });
  };

  approveMerge = async (req: Request, res: Response) => {
    const { id } = req.validated.params as { id: string };
    res.json({ data: await this.merges.approve(id, this.actor(req)) });
  };

  rejectMerge = async (req: Request, res: Response) => {
    const { id } = req.validated.params as { id: string };
    const { note } = req.validated.body as { note: string };
    res.json({ data: await this.merges.reject(id, note, this.actor(req)) });
  };

  listMerges = async (req: Request, res: Response) => {
    const q = req.validated.query as { status?: MergeStatus; limit: number; offset: number };
    res.json({ data: await this.merges.list(q.status, q.limit, q.offset, this.actor(req)) });
  };
}
