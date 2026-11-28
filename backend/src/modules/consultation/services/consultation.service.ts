import { BusinessRuleError, ConflictError, NotFoundError, ValidationError } from '../../../core/errors/app-error';
import { EventTypes, type AccessProvider, type DomainEvent, type EventPublisher, type PatientDirectory, type SettingsReader, type UnitOfWork } from '../../../shared/contracts';
import type { CreateAppointmentDto, ListAppointmentsQueryDto, ScheduleDto } from '../dtos/consultation.dto';
import type { AppointmentRecord, ConsultActor, ScheduleRuleRecord, Slot } from '../models/consultation.model';
import type { ConsultationRepository } from '../repositories/consultation.repository';
import { addDays, isoWeekday, parseHm, zonedToUtc } from './time';

export const PRACTITIONER_PERMISSION = 'CONSULT_RDV_PRACTITIONER';
export const CANCEL_LATE_PERMISSION = 'CONSULT_RDV_CANCEL_LATE';
const MAX_RANGE_DAYS = 14;

export class ConsultationService {
  constructor(
    private readonly repo: ConsultationRepository,
    private readonly uow: UnitOfWork,
    private readonly events: EventPublisher,
    private readonly settings: SettingsReader,
    private readonly access: AccessProvider,
    private readonly patients: PatientDirectory,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /** Un praticien est un utilisateur actif du même établissement détenant CONSULT_RDV_PRACTITIONER. */
  private async assertPractitioner(practitionerId: string, actor: ConsultActor) {
    const a = await this.access.getAccess(practitionerId);
    if (!a || !a.active || a.etablissementId !== actor.etablissementId || !a.permissions.includes(PRACTITIONER_PERMISSION)) {
      throw new NotFoundError('Praticien introuvable', 'practitioner_not_found');
    }
  }

  async setSchedule(practitionerId: string, input: ScheduleDto, actor: ConsultActor): Promise<ScheduleRuleRecord[]> {
    await this.assertPractitioner(practitionerId, actor);
    const rules = input.rules.map((r) => ({ weekday: r.weekday, startMinute: parseHm(r.start), endMinute: parseHm(r.end) }));
    for (const a of rules) {
      for (const b of rules) {
        if (a !== b && a.weekday === b.weekday && a.startMinute < b.endMinute && b.startMinute < a.endMinute) {
          throw new ValidationError('Plages qui se chevauchent', [{ path: 'rules', message: `Chevauchement le jour ${a.weekday}` }]);
        }
      }
    }
    await this.uow.run((tx) => this.repo.replaceSchedule(actor.etablissementId, practitionerId, rules, tx));
    return rules;
  }

  /** Créneaux libres (heure de l'établissement convertie en UTC), passés et réservés exclus. */
  async freeSlots(practitionerId: string, from: string, to: string, actor: ConsultActor): Promise<Slot[]> {
    await this.assertPractitioner(practitionerId, actor);
    return this.computeSlots(practitionerId, from, to, actor.etablissementId);
  }

  private async computeSlots(practitionerId: string, from: string, to: string, etablissementId: string): Promise<Slot[]> {
    const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
    if (days > MAX_RANGE_DAYS) throw new ValidationError(`Plage limitée à ${MAX_RANGE_DAYS} jours`);
    const scope = { etablissementId };
    const [tz, slotMinutes, rules] = await Promise.all([
      this.settings.get<string>('l10n.timezone', scope),
      this.settings.get<number>('appointment.slot_minutes', scope),
      this.repo.getSchedule(practitionerId),
    ]);

    const candidates: { start: Date; end: Date }[] = [];
    for (let i = 0; i < days; i++) {
      const day = addDays(from, i);
      for (const r of rules.filter((x) => x.weekday === isoWeekday(day))) {
        for (let m = r.startMinute; m + slotMinutes <= r.endMinute; m += slotMinutes) {
          candidates.push({ start: zonedToUtc(day, m, tz), end: zonedToUtc(day, m + slotMinutes, tz) });
        }
      }
    }
    if (candidates.length === 0) return [];
    const first = candidates.reduce((a, c) => (c.start < a ? c.start : a), candidates[0]!.start);
    const last = candidates.reduce((a, c) => (c.end > a ? c.end : a), candidates[0]!.end);
    const booked = await this.repo.listBooked(practitionerId, first, last);
    const now = this.clock();
    return candidates
      .filter((c) => c.start > now && !booked.some((b) => b.startsAt < c.end && c.start < b.endsAt))
      .sort((a, b) => a.start.getTime() - b.start.getTime())
      .map((c) => ({ startsAt: c.start.toISOString(), endsAt: c.end.toISOString() }));
  }

  async book(input: CreateAppointmentDto, actor: ConsultActor): Promise<AppointmentRecord> {
    await this.assertPractitioner(input.practitionerId, actor);
    if (!(await this.patients.isAccessible(input.patientId, actor))) throw new NotFoundError('Dossier introuvable', 'patient_not_found');

    // Le créneau demandé doit être exactement l'un des créneaux libres calculés (grille, horaires, passé).
    const day = input.startsAt.toISOString().slice(0, 10);
    const slots = await this.computeSlots(input.practitionerId, addDays(day, -1), addDays(day, 1), actor.etablissementId);
    const slot = slots.find((s) => s.startsAt === input.startsAt.toISOString());
    if (!slot) throw new BusinessRuleError('Ce créneau n\'est pas disponible', 'invalid_slot');

    const offsets = await this.settings.get<number[]>('appointment.reminder_offsets_h', { etablissementId: actor.etablissementId });
    return this.uow.run(async (tx) => {
      const appt = await this.repo.createAppointment(
        { etablissementId: actor.etablissementId, practitionerId: input.practitionerId, patientId: input.patientId, startsAt: new Date(slot.startsAt), endsAt: new Date(slot.endsAt), reason: input.reason, createdBy: actor.userId },
        tx,
      );
      await this.events.publish(
        {
          type: EventTypes.RDV_CREATED,
          data: { appointmentId: appt.id, patientId: appt.patientId, practitionerId: appt.practitionerId, startsAt: slot.startsAt, reminderOffsetsH: offsets },
          actorId: actor.userId, etablissementId: actor.etablissementId, correlationId: actor.correlationId,
        },
        tx,
      );
      return appt;
    });
  }

  async cancel(id: string, reason: string, actor: ConsultActor): Promise<AppointmentRecord> {
    const appt = await this.repo.findAppointment(id);
    if (!appt || appt.etablissementId !== actor.etablissementId) throw new NotFoundError('Rendez-vous introuvable', 'appointment_not_found');
    if (appt.status !== 'BOOKED') throw new ConflictError('Rendez-vous déjà clos', 'appointment_not_booked');

    const now = this.clock();
    const deadlineH = await this.settings.get<number>('appointment.cancel_deadline_h', { etablissementId: actor.etablissementId });
    const hoursLeft = (appt.startsAt.getTime() - now.getTime()) / 3_600_000;
    if (hoursLeft < deadlineH && !actor.permissions.includes(CANCEL_LATE_PERMISSION)) {
      throw new BusinessRuleError(`Annulation impossible moins de ${deadlineH} h avant le rendez-vous`, 'cancel_deadline_passed');
    }
    if (hoursLeft < 0) throw new BusinessRuleError('Le rendez-vous est passé', 'appointment_past');

    await this.uow.run(async (tx) => {
      if (!(await this.repo.cancelAppointment(id, actor.userId, reason, now, tx))) throw new ConflictError('Rendez-vous déjà clos', 'appointment_not_booked');
      await this.events.publish(
        { type: EventTypes.RDV_CANCELLED, data: { appointmentId: id, patientId: appt.patientId, practitionerId: appt.practitionerId, reason }, actorId: actor.userId, etablissementId: actor.etablissementId, correlationId: actor.correlationId },
        tx,
      );
    });
    return { ...appt, status: 'CANCELLED', cancelReason: reason, cancelledBy: actor.userId, cancelledAt: now };
  }

  list(q: ListAppointmentsQueryDto, actor: ConsultActor) {
    const { limit, offset, ...filter } = q;
    return this.repo.listAppointments(actor.etablissementId, filter, limit, offset);
  }

  /** Abonné à `patient.merged` : les rendez-vous du dossier fusionné suivent le dossier cible (idempotent). */
  async onPatientMerged(event: DomainEvent): Promise<void> {
    const { sourceId, targetId } = event.data as { sourceId: string; targetId: string };
    await this.repo.reassignPatient(sourceId, targetId);
  }
}
