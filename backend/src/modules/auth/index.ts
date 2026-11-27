import type { PrismaClient } from '@prisma/client';
import type { Cache } from '../../core/cache/cache';
import type { Middlewares } from '../../core/middlewares';
import type { JwtService } from '../../core/security/jwt';
import type { EventPublisher, SettingsReader, UnitOfWork } from '../../shared/contracts';
import { AuthController } from './controllers/auth.controller';
import { PrismaAuthRepository, type AuthRepository } from './repositories/auth.repository';
import { createAuthRoutes } from './routes/auth.routes';
import { AccessService } from './services/access.service';
import { AuthService } from './services/auth.service';
import { UsersService } from './services/users.service';

export interface AuthModuleDeps {
  repo: AuthRepository;
  uow: UnitOfWork;
  events: EventPublisher;
  settings: SettingsReader;
  cache: Cache;
  jwt: JwtService;
  encryptionKey: string;
}

/** Racine du module : retourne aussi l'AccessProvider, que app.ts branche dans les middlewares. */
export function createAuthModule(deps: AuthModuleDeps) {
  const access = new AccessService(deps.repo, deps.cache);
  const auth = new AuthService({ repo: deps.repo, jwt: deps.jwt, settings: deps.settings, events: deps.events, encryptionKey: deps.encryptionKey });
  const users = new UsersService(deps.repo, deps.uow, deps.events, deps.settings, access);
  const controller = new AuthController(auth, users);
  const createRouter = (middlewares: Middlewares) => createAuthRoutes(controller, middlewares);
  return { access, auth, users, createRouter };
}

export function createPrismaAuthRepository(prisma: PrismaClient): AuthRepository {
  return new PrismaAuthRepository(prisma);
}
export { AUTH_PERMISSION_CATALOG } from './catalog';
