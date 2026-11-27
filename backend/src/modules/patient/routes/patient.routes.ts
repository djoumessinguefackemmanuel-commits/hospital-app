import { Router } from 'express';
import type { Request } from 'express';
import { wrap } from '../../../core/http/async-handler';
import type { Middlewares } from '../../../core/middlewares';
import type { PatientController } from '../controllers/patient.controller';
import { createPatientDto, patientIdParamsDto, searchQueryDto, updatePatientDto } from '../dtos/patient.dto';

export const PATIENT_PERMISSIONS = {
  READ: 'PATIENT_DOSSIER_READ',
  CREATE: 'PATIENT_DOSSIER_CREATE',
  UPDATE: 'PATIENT_DOSSIER_UPDATE',
} as const;

/** Chaîne imposée ; chaque accès à un dossier est audité avec l'identifiant du patient. */
export function createPatientRoutes(c: PatientController, m: Middlewares): Router {
  const r = Router();
  const patientId = (req: Request) => req.params['id'];

  r.get('/', m.authenticate, m.authorize(PATIENT_PERMISSIONS.READ), m.auditLog('PATIENT_SEARCH'), m.validate({ query: searchQueryDto }),
    m.rateLimit({ name: 'patient-search', windowSec: 60, max: 60 }), wrap(c.search));
  r.post('/', m.authenticate, m.authorize(PATIENT_PERMISSIONS.CREATE), m.auditLog('PATIENT_CREATE'), m.validate({ body: createPatientDto }),
    m.rateLimit({ name: 'patient-create', windowSec: 60, max: 30 }), wrap(c.create));
  r.get('/:id', m.authenticate, m.authorize(PATIENT_PERMISSIONS.READ), m.auditLog('PATIENT_READ', { patientId, resourceId: patientId }),
    m.validate({ params: patientIdParamsDto }), m.rateLimit({ name: 'patient-read', windowSec: 60, max: 120 }), wrap(c.get));
  r.patch('/:id', m.authenticate, m.authorize(PATIENT_PERMISSIONS.UPDATE), m.auditLog('PATIENT_UPDATE', { patientId, resourceId: patientId }),
    m.validate({ params: patientIdParamsDto, body: updatePatientDto }), m.rateLimit({ name: 'patient-update', windowSec: 60, max: 60 }), wrap(c.update));
  return r;
}
