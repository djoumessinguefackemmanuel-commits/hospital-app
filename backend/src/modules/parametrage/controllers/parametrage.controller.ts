import type { Request, Response } from 'express';
import type { ParametrageService } from '../services/parametrage.service';
import type { ApproveDto, RollbackDto, SetValueDto } from '../dtos/parametrage.dto';

/** Contrôleur : lit req, appelle le service, écrit res. Aucune règle métier, aucun accès aux données. */
export class ParametrageController {
  constructor(private readonly service: ParametrageService) {}

  private actor(req: Request) {
    const user = req.user!;
    return {
      userId: user.userId,
      etablissementId: user.etablissementId,
      permissions: user.permissions,
      correlationId: req.ctx.correlationId,
      ip: req.ctx.ip,
    };
  }

  listDefinitions = async (req: Request, res: Response) => {
    const { module } = req.validated.query as { module?: string };
    res.json({ data: await this.service.listDefinitions(module) });
  };

  getEffective = async (req: Request, res: Response) => {
    const { code } = req.validated.params as { code: string };
    const scope = req.validated.query as { etablissementId?: string; serviceId?: string; roleCode?: string };
    res.json({ data: await this.service.resolve(code, scope) });
  };

  setValue = async (req: Request, res: Response) => {
    const { code } = req.validated.params as { code: string };
    const body = req.validated.body as SetValueDto;
    const created = await this.service.setValue(
      code,
      { scopeType: body.scopeType, scopeId: body.scopeId ?? '', value: body.value, reason: body.reason, effectiveFrom: body.effectiveFrom },
      this.actor(req),
    );
    res.status(created.status === 'PUBLISHED' ? 201 : 202).json({ data: created });
  };

  approve = async (req: Request, res: Response) => {
    const { code } = req.validated.params as { code: string };
    const body = req.validated.body as ApproveDto;
    const value = await this.service.approve(code, { scopeType: body.scopeType, scopeId: body.scopeId ?? '', version: body.version }, this.actor(req));
    res.json({ data: value });
  };

  rollback = async (req: Request, res: Response) => {
    const { code } = req.validated.params as { code: string };
    const body = req.validated.body as RollbackDto;
    const value = await this.service.rollback(
      code,
      { scopeType: body.scopeType, scopeId: body.scopeId ?? '', toVersion: body.toVersion, reason: body.reason },
      this.actor(req),
    );
    res.status(value.status === 'PUBLISHED' ? 201 : 202).json({ data: value });
  };

  history = async (req: Request, res: Response) => {
    const { code } = req.validated.params as { code: string };
    const q = req.validated.query as { scopeType?: 'GLOBAL' | 'ETABLISSEMENT' | 'SERVICE' | 'ROLE'; scopeId?: string };
    const scope = q.scopeType ? { scopeType: q.scopeType, scopeId: q.scopeId ?? '*' } : undefined;
    res.json({ data: await this.service.history(code, scope) });
  };
}
