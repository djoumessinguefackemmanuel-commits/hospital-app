import type { EventBus } from '../../core/events/event-bus';
import type { Middlewares } from '../../core/middlewares';
import { EventTypes, type AccessProvider, type EventPublisher, type PatientDirectory, type SettingsReader, type UnitOfWork } from '../../shared/contracts';
import { ConsultationController } from './controllers/consultation.controller';
import type { ConsultationRepository } from './repositories/consultation.repository';
import { createConsultationRoutes } from './routes/consultation.routes';
import { ConsultationService } from './services/consultation.service';

export interface ConsultationModuleDeps {
  repo: ConsultationRepository;
  uow: UnitOfWork;
  events: EventPublisher;
  bus: EventBus;
  settings: SettingsReader;
  access: AccessProvider;
  patients: PatientDirectory;
}

export function createConsultationModule(deps: ConsultationModuleDeps) {
  const service = new ConsultationService(deps.repo, deps.uow, deps.events, deps.settings, deps.access, deps.patients);
  deps.bus.subscribe(EventTypes.PATIENT_MERGED, (e) => service.onPatientMerged(e));
  const controller = new ConsultationController(service);
  return { service, createRouter: (m: Middlewares) => createConsultationRoutes(controller, m) };
}

export { PrismaConsultationRepository } from './repositories/consultation.repository';
export { CONSULT_PERMISSION_CATALOG } from './catalog';
