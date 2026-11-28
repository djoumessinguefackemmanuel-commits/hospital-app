import { Router } from 'express';
import type { Request } from 'express';
import { wrap } from '../../../core/http/async-handler';
import type { Middlewares } from '../../../core/middlewares';
import type { ConsultationController } from '../controllers/consultation.controller';
import { appointmentIdParamsDto, cancelDto, createAppointmentDto, listAppointmentsQueryDto, practitionerParamsDto, scheduleDto, slotsQueryDto } from '../dtos/consultation.dto';

export const CONSULT_PERMISSIONS = {
  RDV_READ: 'CONSULT_RDV_READ',
  RDV_CREATE: 'CONSULT_RDV_CREATE',
  RDV_CANCEL: 'CONSULT_RDV_CANCEL',
  AGENDA_UPDATE: 'CONSULT_AGENDA_UPDATE',
} as const;

export function createConsultationRoutes(c: ConsultationController, m: Middlewares): Router {
  const r = Router();
  const bodyPatientId = (req: Request) => (req.body as { patientId?: string } | undefined)?.patientId;
  const queryPatientId = (req: Request) => (typeof req.query['patientId'] === 'string' ? req.query['patientId'] : undefined);

  r.put('/agenda/:practitionerId', m.authenticate, m.authorize(CONSULT_PERMISSIONS.AGENDA_UPDATE), m.auditLog('CONSULT_AGENDA_UPDATE', { resourceId: (req) => req.params['practitionerId'] }),
    m.validate({ params: practitionerParamsDto, body: scheduleDto }), m.rateLimit({ name: 'agenda-update', windowSec: 60, max: 20 }), wrap(c.setSchedule));
  r.get('/agenda/:practitionerId/slots', m.authenticate, m.authorize(CONSULT_PERMISSIONS.RDV_READ), m.auditLog('CONSULT_SLOTS_READ', { resourceId: (req) => req.params['practitionerId'] }),
    m.validate({ params: practitionerParamsDto, query: slotsQueryDto }), m.rateLimit({ name: 'slots', windowSec: 60, max: 120 }), wrap(c.slots));

  r.post('/appointments', m.authenticate, m.authorize(CONSULT_PERMISSIONS.RDV_CREATE), m.auditLog('CONSULT_RDV_CREATE', { patientId: bodyPatientId }),
    m.validate({ body: createAppointmentDto }), m.rateLimit({ name: 'rdv-create', windowSec: 60, max: 60 }), wrap(c.book));
  r.get('/appointments', m.authenticate, m.authorize(CONSULT_PERMISSIONS.RDV_READ), m.auditLog('CONSULT_RDV_LIST', { patientId: queryPatientId }),
    m.validate({ query: listAppointmentsQueryDto }), m.rateLimit({ name: 'rdv-list', windowSec: 60, max: 120 }), wrap(c.list));
  r.post('/appointments/:id/cancel', m.authenticate, m.authorize(CONSULT_PERMISSIONS.RDV_CANCEL), m.auditLog('CONSULT_RDV_CANCEL', { resourceId: (req) => req.params['id'] }),
    m.validate({ params: appointmentIdParamsDto, body: cancelDto }), m.rateLimit({ name: 'rdv-cancel', windowSec: 60, max: 30 }), wrap(c.cancel));
  return r;
}
