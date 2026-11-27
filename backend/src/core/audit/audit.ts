import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { AuditEntry, AuditWriter } from '../../shared/contracts';

/** Entrée telle qu'elle est hachée : champs normalisés (absent = null) + horodatage. */
export interface HashedAuditInput {
  etablissementId: string | null;
  userId: string | null;
  action: string;
  resource: string;
  resourceId: string | null;
  patientId: string | null;
  result: string;
  ip: string | null;
  userAgent: string | null;
  correlationId: string | null;
  details: unknown;
  occurredAt: string;
}

export function normalizeEntry(entry: AuditEntry, occurredAt: Date): HashedAuditInput {
  return {
    etablissementId: entry.etablissementId ?? null,
    userId: entry.userId ?? null,
    action: entry.action,
    resource: entry.resource,
    resourceId: entry.resourceId ?? null,
    patientId: entry.patientId ?? null,
    result: entry.result,
    ip: entry.ip ?? null,
    userAgent: entry.userAgent ?? null,
    correlationId: entry.correlationId ?? null,
    details: entry.details ?? null,
    occurredAt: occurredAt.toISOString(),
  };
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')}}`;
}

export function computeAuditHash(prevHash: string | null, input: HashedAuditInput): string {
  return createHash('sha256').update(`${prevHash ?? ''}|${stableStringify(input)}`).digest('hex');
}

export interface ChainRow {
  prevHash: string | null;
  hash: string;
  input: HashedAuditInput;
}

/** Retourne l'indice de la première ligne falsifiée, ou -1 si la chaîne est intègre. */
export function verifyAuditChain(rows: ChainRow[]): number {
  let prev: string | null = null;
  for (const [i, row] of rows.entries()) {
    if (row.prevHash !== prev || computeAuditHash(prev, row.input) !== row.hash) return i;
    prev = row.hash;
  }
  return -1;
}

/** Verrou consultatif : sérialise les écritures pour que la chaîne reste linéaire entre réplicas. */
const AUDIT_LOCK_KEY = 727_001;

export class PrismaAuditWriter implements AuditWriter {
  constructor(private readonly prisma: PrismaClient) {}

  async write(entry: AuditEntry): Promise<void> {
    const occurredAt = new Date();
    const input = normalizeEntry(entry, occurredAt);
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${AUDIT_LOCK_KEY})`;
      const last = await tx.auditLog.findFirst({ orderBy: { seq: 'desc' }, select: { hash: true } });
      const prevHash = last?.hash ?? null;
      await tx.auditLog.create({
        data: {
          etablissementId: input.etablissementId,
          userId: input.userId,
          action: input.action,
          resource: input.resource,
          resourceId: input.resourceId,
          patientId: input.patientId,
          result: input.result,
          ip: input.ip,
          userAgent: input.userAgent,
          correlationId: input.correlationId,
          details: (input.details ?? undefined) as Prisma.InputJsonValue | undefined,
          occurredAt,
          prevHash,
          hash: computeAuditHash(prevHash, input),
        },
      });
    });
  }

  /** Relit toute la chaîne et vérifie son intégrité (tâche planifiée de l'auditeur). */
  async verify(): Promise<number> {
    const rows = await this.prisma.auditLog.findMany({ orderBy: { seq: 'asc' } });
    return verifyAuditChain(
      rows.map((r) => ({
        prevHash: r.prevHash,
        hash: r.hash,
        input: {
          etablissementId: r.etablissementId,
          userId: r.userId,
          action: r.action,
          resource: r.resource,
          resourceId: r.resourceId,
          patientId: r.patientId,
          result: r.result,
          ip: r.ip,
          userAgent: r.userAgent,
          correlationId: r.correlationId,
          details: r.details,
          occurredAt: r.occurredAt.toISOString(),
        },
      })),
    );
  }
}

export class MemoryAuditWriter implements AuditWriter {
  readonly rows: (ChainRow & { entry: AuditEntry })[] = [];

  async write(entry: AuditEntry): Promise<void> {
    const prevHash = this.rows.at(-1)?.hash ?? null;
    const input = normalizeEntry(entry, new Date());
    this.rows.push({ prevHash, hash: computeAuditHash(prevHash, input), input, entry });
  }
}
