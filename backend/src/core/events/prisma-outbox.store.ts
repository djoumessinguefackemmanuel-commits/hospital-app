import type { Prisma, PrismaClient } from '@prisma/client';
import type { DomainEvent, Tx } from '../../shared/contracts';
import { dbOf } from '../database/prisma';
import type { OutboxStore, StoredEvent } from './event-bus';

/** Bail pendant lequel un événement réservé n'est pas redistribué à un autre réplica. */
const LEASE_MS = 60_000;

export class PrismaOutboxStore implements OutboxStore {
  constructor(private readonly prisma: PrismaClient) {}

  async add(event: DomainEvent, tx?: Tx): Promise<void> {
    await dbOf(this.prisma, tx).outboxEvent.create({
      data: {
        id: event.eventId,
        eventType: event.type,
        etablissementId: event.etablissementId,
        correlationId: event.correlationId,
        actorId: event.actorId,
        payload: { occurredAt: event.occurredAt, data: event.data } as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Plusieurs réplicas peuvent tourner : `FOR UPDATE SKIP LOCKED` + bail évitent les doublons de distribution.
   * Les abonnés restent idempotents (livraison au moins une fois).
   */
  async claimPending(limit: number, now: Date): Promise<StoredEvent[]> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM shared.outbox_events
        WHERE status = 'PENDING'::shared.outbox_status AND available_at <= ${now}
        ORDER BY created_at
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED`;
      if (rows.length === 0) return [];
      const ids = rows.map((r) => r.id);
      await tx.outboxEvent.updateMany({
        where: { id: { in: ids } },
        data: { availableAt: new Date(now.getTime() + LEASE_MS) },
      });
      const events = await tx.outboxEvent.findMany({ where: { id: { in: ids } }, orderBy: { createdAt: 'asc' } });
      return events.map((e): StoredEvent => {
        const payload = e.payload as { occurredAt: string; data: unknown };
        return {
          eventId: e.id,
          type: e.eventType,
          occurredAt: payload.occurredAt,
          actorId: e.actorId ?? undefined,
          etablissementId: e.etablissementId ?? undefined,
          correlationId: e.correlationId ?? undefined,
          data: payload.data,
          attempts: e.attempts,
        };
      });
    });
  }

  async markPublished(eventId: string, at: Date): Promise<void> {
    await this.prisma.outboxEvent.update({ where: { id: eventId }, data: { status: 'PUBLISHED', publishedAt: at } });
  }

  async markFailed(eventId: string, error: string, nextAttemptAt: Date, giveUp: boolean): Promise<void> {
    await this.prisma.outboxEvent.update({
      where: { id: eventId },
      data: {
        status: giveUp ? 'FAILED' : 'PENDING',
        attempts: { increment: 1 },
        lastError: error.slice(0, 1000),
        availableAt: nextAttemptAt,
      },
    });
  }
}
