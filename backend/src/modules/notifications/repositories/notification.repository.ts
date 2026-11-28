import { Prisma, type PrismaClient } from '@prisma/client';
import type { NewNotification, NotificationFilter, NotificationRecord } from '../models/notification.model';

export interface NotificationRepository {
  /** Création idempotente (clé de déduplication). Retourne le nombre de lignes réellement créées. */
  createMany(items: NewNotification[]): Promise<number>;
  cancelBySubject(subjectType: string, subjectId: string, at: Date): Promise<number>;
  /** Réserve (bail de 60 s) les notifications dues ; sûr avec plusieurs instances. */
  claimDue(limit: number, now: Date): Promise<NotificationRecord[]>;
  markSent(id: string, at: Date): Promise<void>;
  markSkipped(id: string, reason: string): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
  /** Replanifie ; `refundAttempt` rend la tentative consommée au moment de la réservation. */
  reschedule(id: string, at: Date, error: string | undefined, refundAttempt: boolean): Promise<void>;
  findById(id: string): Promise<NotificationRecord | null>;
  requeue(id: string, at: Date): Promise<boolean>;
  list(etablissementId: string, filter: NotificationFilter, limit: number, offset: number): Promise<NotificationRecord[]>;
}

type Row = {
  id: string; etablissementId: string; patientId: string; channel: string; template: string; subjectType: string; subjectId: string;
  payload: unknown; dedupeKey: string; status: string; scheduledFor: Date; attempts: number; lastError: string | null; sentAt: Date | null;
};
const toRecord = (r: Row): NotificationRecord => ({ ...r, channel: r.channel as NotificationRecord['channel'], status: r.status as NotificationRecord['status'], payload: (r.payload ?? {}) as Record<string, unknown> });

export class PrismaNotificationRepository implements NotificationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createMany(items: NewNotification[]) {
    if (items.length === 0) return 0;
    const res = await this.prisma.notification.createMany({ data: items.map((i) => ({ ...i, payload: i.payload as Prisma.InputJsonValue })), skipDuplicates: true });
    return res.count;
  }

  async cancelBySubject(subjectType: string, subjectId: string, at: Date) {
    const res = await this.prisma.notification.updateMany({
      where: { subjectType, subjectId, status: 'PENDING' },
      data: { status: 'CANCELLED', lastError: `annulée le ${at.toISOString()}` },
    });
    return res.count;
  }

  async claimDue(limit: number, now: Date) {
    const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      UPDATE notifications.notifications SET scheduled_for = ${now}::timestamptz + interval '60 seconds', attempts = attempts + 1, updated_at = now()
      WHERE id IN (
        SELECT id FROM notifications.notifications
        WHERE status = 'PENDING' AND scheduled_for <= ${now}::timestamptz
        ORDER BY scheduled_for LIMIT ${limit} FOR UPDATE SKIP LOCKED)
      RETURNING id, etablissement_id AS "etablissementId", patient_id AS "patientId", channel::text AS channel, template,
        subject_type AS "subjectType", subject_id AS "subjectId", payload, dedupe_key AS "dedupeKey", status::text AS status,
        scheduled_for AS "scheduledFor", attempts, last_error AS "lastError", sent_at AS "sentAt"`);
    return rows.map(toRecord);
  }

  async markSent(id: string, at: Date) {
    await this.prisma.notification.update({ where: { id }, data: { status: 'SENT', sentAt: at, lastError: null } });
  }

  async markSkipped(id: string, reason: string) {
    await this.prisma.notification.update({ where: { id }, data: { status: 'SKIPPED', lastError: reason } });
  }

  async markFailed(id: string, error: string) {
    await this.prisma.notification.update({ where: { id }, data: { status: 'FAILED', lastError: error.slice(0, 500) } });
  }

  async reschedule(id: string, at: Date, error: string | undefined, refundAttempt: boolean) {
    await this.prisma.notification.update({
      where: { id },
      data: { scheduledFor: at, ...(error ? { lastError: error.slice(0, 500) } : {}), ...(refundAttempt ? { attempts: { decrement: 1 } } : {}) },
    });
  }

  async findById(id: string) {
    const r = await this.prisma.notification.findUnique({ where: { id } });
    return r ? toRecord(r as Row) : null;
  }

  async requeue(id: string, at: Date) {
    const res = await this.prisma.notification.updateMany({ where: { id, status: 'FAILED' }, data: { status: 'PENDING', attempts: 0, scheduledFor: at } });
    return res.count === 1;
  }

  async list(etablissementId: string, f: NotificationFilter, limit: number, offset: number) {
    const rows = await this.prisma.notification.findMany({
      where: { etablissementId, ...(f.status ? { status: f.status } : {}), ...(f.patientId ? { patientId: f.patientId } : {}) },
      orderBy: { scheduledFor: 'desc' }, take: limit, skip: offset,
    });
    return rows.map((r) => toRecord(r as Row));
  }
}
