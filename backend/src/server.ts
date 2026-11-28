import { buildContainer, prismaRepositories } from './app';
import { PrismaAuditWriter } from './core/audit/audit';
import { MemoryCache, RedisCache, type Cache } from './core/cache/cache';
import { PrismaUnitOfWork, createPrisma } from './core/database/prisma';
import { EventBus, OutboxRelay } from './core/events/event-bus';
import { PrismaOutboxStore } from './core/events/prisma-outbox.store';
import { createLogger } from './core/logger/logger';
import { loadEnv } from './config/env';
import Redis from 'ioredis';

async function main() {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL);
  const prisma = createPrisma(env.DATABASE_URL);

  let cache: Cache = new MemoryCache();
  let redis: Redis | undefined;
  if (env.REDIS_URL) {
    redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2 });
    cache = new RedisCache(redis);
  } else if (env.NODE_ENV === 'production') {
    logger.warn('REDIS_URL absent : cache et limitation en mémoire (non partagés entre instances)');
  }

  const store = new PrismaOutboxStore(prisma);
  const bus = new EventBus(store);
  const { app, notifications } = buildContainer({
    logger,
    bus,
    uow: new PrismaUnitOfWork(prisma),
    cache,
    audit: new PrismaAuditWriter(prisma),
    jwtSecret: env.JWT_ACCESS_SECRET,
    encryptionKey: env.DATA_ENCRYPTION_KEY,
    corsOrigins: env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean),
    ...prismaRepositories(prisma),
  });

  const relay = new OutboxRelay(store, bus, logger);
  relay.start(env.OUTBOX_POLL_MS);
  notifications.start(30_000);

  const server = app.listen(env.PORT, () => logger.info({ port: env.PORT }, 'HMS backend démarré'));

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'arrêt en cours');
    relay.stop();
    notifications.stop();
    server.close(async () => {
      await prisma.$disconnect();
      redis?.disconnect();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Échec du démarrage', err);
  process.exit(1);
});
