import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import type { Tx, UnitOfWork } from '../../shared/contracts';

export function createPrisma(connectionString: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

/** Les repositories reçoivent `tx` (client transactionnel) ou, à défaut, le client global. */
export function dbOf(prisma: PrismaClient, tx?: Tx): PrismaClient | Prisma.TransactionClient {
  return (tx as Prisma.TransactionClient | undefined) ?? prisma;
}

export class PrismaUnitOfWork implements UnitOfWork {
  constructor(private readonly prisma: PrismaClient) {}

  run<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction((tx) => fn(tx), { timeout: 15_000 });
  }
}

/** Sans base : les opérations s'exécutent sans transaction (tests unitaires). */
export class NoopUnitOfWork implements UnitOfWork {
  run<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return fn(undefined);
  }
}
