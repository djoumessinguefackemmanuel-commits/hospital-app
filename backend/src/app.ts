import type { PrismaClient } from '@prisma/client';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { AuditWriter, ContactDirectory, PatientDirectory } from './shared/contracts';
import type { UnitOfWork } from './shared/contracts';
import type { Cache } from './core/cache/cache';
import { EventBus } from './core/events/event-bus';
import type { Logger } from './core/logger/logger';
import { createErrorHandler, createMiddlewares, notFoundHandler, requestContext } from './core/middlewares';
import { JwtService } from './core/security/jwt';
import { createAuthModule } from './modules/auth';
import { PrismaAuthRepository, type AuthRepository } from './modules/auth/repositories/auth.repository';
import { createConsultationModule, PrismaConsultationRepository } from './modules/consultation';
import type { ConsultationRepository } from './modules/consultation/repositories/consultation.repository';
import { createNotificationsModule, PrismaNotificationRepository, type NotificationSender } from './modules/notifications';
import type { NotificationRepository } from './modules/notifications/repositories/notification.repository';
import { createPatientModule, PrismaPatientRepository } from './modules/patients';
import type { PatientRepository } from './modules/patients/repositories/patient.repository';
import { createParametrageModule } from './modules/parametrage';
import { PrismaParametrageRepository, type ParametrageRepository } from './modules/parametrage/repositories/parametrage.repository';

export interface AppDeps {
  logger: Logger;
  bus: EventBus;
  uow: UnitOfWork;
  cache: Cache;
  audit: AuditWriter;
  jwtSecret: string;
  encryptionKey: string;
  corsOrigins: string[];
  /** Dépôts : Prisma en production, doublures en mémoire dans les tests. */
  authRepo: AuthRepository;
  parametrageRepo: ParametrageRepository;
  patientRepo: PatientRepository;
  consultationRepo: ConsultationRepository;
  notificationRepo: NotificationRepository;
  /** Canaux d'envoi réels ; par défaut un canal « journal » qui n'envoie rien. */
  senders?: NotificationSender[];
}

export function prismaRepositories(prisma: PrismaClient) {
  return { authRepo: new PrismaAuthRepository(prisma), parametrageRepo: new PrismaParametrageRepository(prisma), patientRepo: new PrismaPatientRepository(prisma), consultationRepo: new PrismaConsultationRepository(prisma), notificationRepo: new PrismaNotificationRepository(prisma) };
}

/**
 * Racine de composition : seul endroit où les modules sont branchés entre eux
 * (jamais d'import direct d'un module vers un autre, docs/00-conventions.md §5).
 */
export function buildApp(deps: AppDeps): Express {
  return buildContainer(deps).app;
}

export function buildContainer(deps: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: deps.corsOrigins, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(requestContext);

  const jwt = new JwtService(deps.jwtSecret);

  const parametrage = createParametrageModule({
    repo: deps.parametrageRepo,
    uow: deps.uow,
    events: deps.bus,
    bus: deps.bus,
    cache: deps.cache,
  });
  const auth = createAuthModule({
    repo: deps.authRepo,
    uow: deps.uow,
    events: deps.bus,
    settings: parametrage.service,
    cache: deps.cache,
    jwt,
    encryptionKey: deps.encryptionKey,
  });

  const patient = createPatientModule({
    repo: deps.patientRepo,
    uow: deps.uow,
    events: deps.bus,
    settings: parametrage.service,
    encryptionKey: deps.encryptionKey,
  });

  // Contrat PatientDirectory : branché ici pour que consultation n'importe jamais patients.
  const patientDirectory: PatientDirectory = {
    isAccessible: async (patientId, actor) => {
      const p = await deps.patientRepo.findById(patientId);
      if (!p || p.etablissementId !== actor.etablissementId || !p.active || p.mergedIntoId) return false;
      return p.confidentiality === 'NORMAL' || actor.permissions.includes('PATIENT_DOSSIER_READ_RESTRICTED');
    },
  };
  const consultation = createConsultationModule({
    repo: deps.consultationRepo,
    uow: deps.uow,
    events: deps.bus,
    bus: deps.bus,
    settings: parametrage.service,
    access: auth.access,
    patients: patientDirectory,
  });

  const contactDirectory: ContactDirectory = {
    getContact: async (patientId, etablissementId) => {
      let p = await deps.patientRepo.findById(patientId);
      if (p?.mergedIntoId) p = await deps.patientRepo.findById(p.mergedIntoId); // suit un dossier fusionné
      if (!p || p.etablissementId !== etablissementId) return null;
      return { email: p.email ?? undefined, phone: p.phone ?? undefined };
    },
  };
  const notifications = createNotificationsModule({
    repo: deps.notificationRepo,
    bus: deps.bus,
    settings: parametrage.service,
    contacts: contactDirectory,
    logger: deps.logger,
    senders: deps.senders,
  });

  const middlewares = createMiddlewares({
    jwt,
    access: auth.access,
    settings: parametrage.service,
    audit: deps.audit,
    cache: deps.cache,
    logger: deps.logger,
  });

  // Limite globale par IP, en amont de tout le reste.
  app.use(middlewares.rateLimit({ name: 'global', windowSec: 60, max: 600 }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/v1/auth', auth.createRouter(middlewares));
  app.use('/api/v1/patients', patient.createRouter(middlewares));
  app.use('/api/v1/consultation', consultation.createRouter(middlewares));
  app.use('/api/v1/notifications', notifications.createRouter(middlewares));
  app.use('/api/v1/parametrage', parametrage.createRouter(middlewares));

  app.use(notFoundHandler);
  app.use(createErrorHandler(deps.logger));
  return { app, notifications: notifications.service };
}
