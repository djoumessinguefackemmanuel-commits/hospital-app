import type { Middlewares } from '../../core/middlewares';
import type { EventPublisher, SettingsReader, UnitOfWork } from '../../shared/contracts';
import { PatientController } from './controllers/patient.controller';
import type { PatientRepository } from './repositories/patient.repository';
import { createPatientRoutes } from './routes/patient.routes';
import { PatientService } from './services/patient.service';

export interface PatientModuleDeps {
  repo: PatientRepository;
  uow: UnitOfWork;
  events: EventPublisher;
  settings: SettingsReader;
  encryptionKey: string;
}

export function createPatientModule(deps: PatientModuleDeps) {
  const service = new PatientService(deps.repo, deps.uow, deps.events, deps.settings, deps.encryptionKey);
  const controller = new PatientController(service);
  return { service, createRouter: (m: Middlewares) => createPatientRoutes(controller, m) };
}

export { PrismaPatientRepository } from './repositories/patient.repository';
export { PATIENT_PERMISSION_CATALOG } from './catalog';
