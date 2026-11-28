import { Prisma, type PrismaClient } from '@prisma/client';
import { dbOf } from '../../../core/database/prisma';
import { ConflictError } from '../../../core/errors/app-error';
import type { Tx } from '../../../shared/contracts';
import type { AppointmentFilter, AppointmentRecord, NewAppointment, ScheduleRuleRecord } from '../models/consultation.model';

export interface ConsultationRepository {
  replaceSchedule(etablissementId: string, practitionerId: string, rules: ScheduleRuleRecord[], tx?: Tx): Promise<void>;
  getSchedule(practitionerId: string): Promise<ScheduleRuleRecord[]>;
  listBooked(practitionerId: string, from: Date, to: Date): Promise<{ startsAt: Date; endsAt: Date }[]>;
  /** Lève ConflictError('slot_taken') si le créneau vient d'être pris (contrainte d'exclusion). */
  createAppointment(input: NewAppointment, tx?: Tx): Promise<AppointmentRecord>;
  findAppointment(id: string): Promise<AppointmentRecord | null>;
  listAppointments(etablissementId: string, filter: AppointmentFilter, limit: number, offset: number): Promise<AppointmentRecord[]>;
  /** Annule seulement si le rendez-vous est encore réservé. Retourne false sinon. */
  cancelAppointment(id: string, by: string, reason: string, at: Date, tx?: Tx): Promise<boolean>;
  reassignPatient(fromPatientId: string, toPatientId: string): Promise<number>;
}

function isExclusionViolation(err: unknown): boolean {
  const text = err instanceof Error ? `${err.message} ${JSON.stringify((err as { meta?: unknown }).meta ?? '')}` : String(err);
  return /23P01|appointments_no_overlap|exclusion/i.test(text);
}

export class PrismaConsultationRepository implements ConsultationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async replaceSchedule(etablissementId: string, practitionerId: string, rules: ScheduleRuleRecord[], tx?: Tx) {
    const db = dbOf(this.prisma, tx);
    await db.scheduleRule.deleteMany({ where: { practitionerId } });
    if (rules.length > 0) await db.scheduleRule.createMany({ data: rules.map((r) => ({ ...r, etablissementId, practitionerId })) });
  }

  async getSchedule(practitionerId: string) {
    const rows = await this.prisma.scheduleRule.findMany({ where: { practitionerId }, orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }] });
    return rows.map((r) => ({ weekday: r.weekday, startMinute: r.startMinute, endMinute: r.endMinute }));
  }

  async listBooked(practitionerId: string, from: Date, to: Date) {
    const rows = await this.prisma.appointment.findMany({
      where: { practitionerId, status: 'BOOKED', startsAt: { lt: to }, endsAt: { gt: from } },
      select: { startsAt: true, endsAt: true },
    });
    return rows;
  }

  async createAppointment(input: NewAppointment, tx?: Tx) {
    try {
      return (await dbOf(this.prisma, tx).appointment.create({ data: input })) as AppointmentRecord;
    } catch (err) {
      if (isExclusionViolation(err)) throw new ConflictError('Ce créneau vient d\'être réservé', 'slot_taken');
      throw err;
    }
  }

  async findAppointment(id: string) {
    return (await this.prisma.appointment.findUnique({ where: { id } })) as AppointmentRecord | null;
  }

  async listAppointments(etablissementId: string, f: AppointmentFilter, limit: number, offset: number) {
    const where: Prisma.AppointmentWhereInput = {
      etablissementId,
      ...(f.practitionerId ? { practitionerId: f.practitionerId } : {}),
      ...(f.patientId ? { patientId: f.patientId } : {}),
      ...(f.status ? { status: f.status } : {}),
      ...(f.from || f.to ? { startsAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lt: f.to } : {}) } } : {}),
    };
    return (await this.prisma.appointment.findMany({ where, orderBy: { startsAt: 'asc' }, take: limit, skip: offset })) as AppointmentRecord[];
  }

  async cancelAppointment(id: string, by: string, reason: string, at: Date, tx?: Tx) {
    const res = await dbOf(this.prisma, tx).appointment.updateMany({
      where: { id, status: 'BOOKED' },
      data: { status: 'CANCELLED', cancelledBy: by, cancelReason: reason, cancelledAt: at },
    });
    return res.count === 1;
  }

  async reassignPatient(fromPatientId: string, toPatientId: string) {
    const res = await this.prisma.appointment.updateMany({ where: { patientId: fromPatientId }, data: { patientId: toPatientId } });
    return res.count;
  }
}
