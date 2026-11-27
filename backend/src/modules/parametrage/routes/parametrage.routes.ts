import { Router } from 'express';
import type { Middlewares } from '../../../core/middlewares';
import { wrap } from '../../../core/http/async-handler';
import type { ParametrageController } from '../controllers/parametrage.controller';
import {
  approveDto,
  codeParamsDto,
  definitionsQueryDto,
  effectiveQueryDto,
  historyQueryDto,
  rollbackDto,
  setValueDto,
} from '../dtos/parametrage.dto';

export const PARAM_PERMISSIONS = {
  READ: 'PARAM_PARAMETRE_READ',
  UPDATE: 'PARAM_PARAMETRE_UPDATE',
  APPROVE: 'PARAM_PARAMETRE_APPROVE',
} as const;

/** Chaîne imposée : authenticate → authorize → auditLog → validate → rateLimit → controller. */
export function createParametrageRoutes(c: ParametrageController, m: Middlewares): Router {
  const r = Router();
  const write = m.rateLimit({ name: 'parametrage-write', windowSec: 60, max: 60 });

  r.get(
    '/definitions',
    m.authenticate,
    m.authorize(PARAM_PERMISSIONS.READ),
    m.auditLog('PARAM_DEFINITION_LIST'),
    m.validate({ query: definitionsQueryDto }),
    wrap(c.listDefinitions),
  );

  r.get(
    '/parametres/:code',
    m.authenticate,
    m.authorize(PARAM_PERMISSIONS.READ),
    m.auditLog('PARAM_PARAMETRE_READ'),
    m.validate({ params: codeParamsDto, query: effectiveQueryDto }),
    wrap(c.getEffective),
  );

  r.get(
    '/parametres/:code/history',
    m.authenticate,
    m.authorize(PARAM_PERMISSIONS.READ),
    m.auditLog('PARAM_PARAMETRE_HISTORY'),
    m.validate({ params: codeParamsDto, query: historyQueryDto }),
    wrap(c.history),
  );

  r.put(
    '/parametres/:code',
    m.authenticate,
    m.authorize(PARAM_PERMISSIONS.UPDATE),
    m.auditLog('PARAM_PARAMETRE_UPDATE', { resourceId: (req) => req.params['code'] }),
    m.validate({ params: codeParamsDto, body: setValueDto }),
    write,
    wrap(c.setValue),
  );

  r.post(
    '/parametres/:code/approve',
    m.authenticate,
    m.authorize(PARAM_PERMISSIONS.APPROVE),
    m.auditLog('PARAM_PARAMETRE_APPROVE', { resourceId: (req) => req.params['code'] }),
    m.validate({ params: codeParamsDto, body: approveDto }),
    write,
    wrap(c.approve),
  );

  r.post(
    '/parametres/:code/rollback',
    m.authenticate,
    m.authorize(PARAM_PERMISSIONS.UPDATE),
    m.auditLog('PARAM_PARAMETRE_ROLLBACK', { resourceId: (req) => req.params['code'] }),
    m.validate({ params: codeParamsDto, body: rollbackDto }),
    write,
    wrap(c.rollback),
  );

  return r;
}
