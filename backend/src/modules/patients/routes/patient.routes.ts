import { Router } from 'express';
import type { Request } from 'express';
import { wrap } from '../../../core/http/async-handler';
import type { Middlewares } from '../../../core/middlewares';
import type { PatientController } from '../controllers/patient.controller';
import { createPatientDto, listMergesQueryDto, mergeIdParamsDto, patientIdParamsDto, rejectMergeDto, requestMergeDto, searchQueryDto, updatePatientDto } from '../dtos/patient.dto';

export const PATIENT_PERMISSIONS = {
  READ: 'PATIENT_DOSSIER_READ',
  CREATE: 'PATIENT_DOSSIER_CREATE',
  UPDATE: 'PATIENT_DOSSIER_UPDATE',
  MERGE_REQUEST: 'PATIENT_FUSION_REQUEST',
  MERGE_APPROVE: 'PATIENT_FUSION_APPROVE',
} as const;

/** Chaîne imposée ; chaque accès à un dossier est audité avec l'identifiant du patient. */
export function createPatientRoutes(c: PatientController, m: Middlewares): Router {
  const r = Router();
  const patientId = (req: Request) => req.params['id'];

  // Les routes /merges sont déclarées avant /:id pour ne pas être prises pour un identifiant.
  r.get('/merges', m.authenticate, m.authorize(PATIENT_PERMISSIONS.MERGE_REQUEST), m.auditLog('PATIENT_MERGE_LIST'), m.validate({ query: listMergesQueryDto }), wrap(c.listMerges));
  r.post('/merges', m.authenticate, m.authorize(PATIENT_PERMISSIONS.MERGE_REQUEST), m.auditLog('PATIENT_MERGE_REQUEST'), m.validate({ body: requestMergeDto }),
    m.rateLimit({ name: 'patient-merge', windowSec: 60, max: 10 }), wrap(c.requestMerge));
  r.post('/merges/:id/approve', m.authenticate, m.authorize(PATIENT_PERMISSIONS.MERGE_APPROVE), m.auditLog('PATIENT_MERGE_APPROVE', { resourceId: patientId }),
    m.validate({ params: mergeIdParamsDto }), m.rateLimit({ name: 'patient-merge', windowSec: 60, max: 10 }), wrap(c.approveMerge));
  r.post('/merges/:id/reject', m.authenticate, m.authorize(PATIENT_PERMISSIONS.MERGE_APPROVE), m.auditLog('PATIENT_MERGE_REJECT', { resourceId: patientId }),
    m.validate({ params: mergeIdParamsDto, body: rejectMergeDto }), m.rateLimit({ name: 'patient-merge', windowSec: 60, max: 10 }), wrap(c.rejectMerge));

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
