import type { Cache } from '../../core/cache/cache';
import type { EventBus } from '../../core/events/event-bus';
import type { Middlewares } from '../../core/middlewares';
import type { EventPublisher, UnitOfWork } from '../../shared/contracts';
import { ParametrageController } from './controllers/parametrage.controller';
import type { ParametrageRepository } from './repositories/parametrage.repository';
import { createParametrageRoutes } from './routes/parametrage.routes';
import { ParametrageService } from './services/parametrage.service';
import { EventTypes } from '../../shared/contracts';

export interface ParametrageModuleDeps {
  repo: ParametrageRepository;
  uow: UnitOfWork;
  events: EventPublisher;
  bus: EventBus;
  cache: Cache;
}

/** Point d'entrée du module : la racine de composition (src/app.ts) l'assemble. */
export function createParametrageModule(deps: ParametrageModuleDeps) {
  const service = new ParametrageService(deps.repo, deps.uow, deps.events, deps.cache);
  deps.bus.subscribe(EventTypes.PARAMETRE_UPDATED, (e) => service.onParametreUpdated(e));
  const controller = new ParametrageController(service);
  /** Les routes sont montées après création des middlewares (qui dépendent du service et de l'accès). */
  const createRouter = (middlewares: Middlewares) => createParametrageRoutes(controller, middlewares);
  return { service, createRouter };
}

export { PrismaParametrageRepository } from './repositories/parametrage.repository';
export { PARAMETRE_CATALOG, PARAMETRAGE_PERMISSIONS } from './catalog';
