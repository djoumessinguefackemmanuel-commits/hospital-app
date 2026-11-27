import type { PrismaClient } from '@prisma/client';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { AuditWriter } from './shared/contracts';
import type { UnitOfWork } from './shared/contracts';
import type { Cache } from './core/cache/cache';
import { EventBus } from './core/events/event-bus';
import type { Logger } from './core/logger/logger';
import { createErrorHandler, createMiddlewares, notFoundHandler, requestContext } from './core/middlewares';
import { JwtService } from './core/security/jwt';
import { createAuthModule } from './modules/auth';
import { PrismaAuthRepository, type AuthRepository } from './modules/auth/repositories/auth.repository';
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
}

export function prismaRepositories(prisma: PrismaClient) {
  return { authRepo: new PrismaAuthRepository(prisma), parametrageRepo: new PrismaParametrageRepository(prisma), patientRepo: new PrismaPatientRepository(prisma) };
}

/**
 * Racine de composition : seul endroit où les modules sont branchés entre eux
 * (jamais d'import direct d'un module vers un autre, docs/00-conventions.md §5).
 */
export function buildApp(deps: AppDeps): Express {
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
  app.use('/api/v1/parametrage', parametrage.createRouter(middlewares));

  app.use(notFoundHandler);
  app.use(createErrorHandler(deps.logger));
  return app;
}
