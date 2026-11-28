import { NoopUnitOfWork } from '../../src/core/database/prisma';
import { ConflictError } from '../../src/core/errors/app-error';
import type { AppointmentRecord } from '../../src/modules/consultation/models/consultation.model';
import type { ConsultationRepository } from '../../src/modules/consultation/repositories/consultation.repository';
import { ConsultationService } from '../../src/modules/consultation/services/consultation.service';
import { addDays, isoWeekday, parseHm, zonedToUtc } from '../../src/modules/consultation/services/time';

describe('calcul du temps', () => {
  it('convertit l\'heure locale en UTC en tenant compte de l\'heure d\'été', () => {
    expect(zonedToUtc('2026-01-15', 9 * 60, 'Europe/Paris').toISOString()).toBe('2026-01-15T08:00:00.000Z');
    expect(zonedToUtc('2026-07-15', 9 * 60, 'Europe/Paris').toISOString()).toBe('2026-07-15T07:00:00.000Z');
    expect(zonedToUtc('2026-07-15', 9 * 60, 'UTC').toISOString()).toBe('2026-07-15T09:00:00.000Z');
    expect(zonedToUtc('2026-03-29', 9 * 60, 'Europe/Paris').toISOString()).toBe('2026-03-29T07:00:00.000Z'); // jour du passage à l'heure d'été
  });
  it('jour de semaine ISO, ajout de jours et lecture HH:MM', () => {
    expect(isoWeekday('2026-11-30')).toBe(1);
    expect(isoWeekday('2026-11-29')).toBe(7);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(parseHm('08:30')).toBe(510);
  });
});

const NOW = new Date('2026-06-01T08:00:00Z'); // lundi
const actor = (permissions: string[] = []) => ({ userId: 'u1', etablissementId: 'e1', permissions });

function setup(opts: { booked?: { startsAt: Date; endsAt: Date }[]; appt?: Partial<AppointmentRecord> } = {}) {
  const repo = {
    getSchedule: jest.fn(async () => [{ weekday: 2, startMinute: 9 * 60, endMinute: 10 * 60 }]), // mardi 9h-10h
    listBooked: jest.fn(async () => opts.booked ?? []),
    replaceSchedule: jest.fn(async () => undefined),
    createAppointment: jest.fn(async (i) => ({ id: 'a1', status: 'BOOKED', cancelReason: null, cancelledBy: null, cancelledAt: null, ...i }) as AppointmentRecord),
    findAppointment: jest.fn(async () => ({ id: 'a1', etablissementId: 'e1', practitionerId: 'd1', patientId: 'p1', startsAt: new Date('2026-06-02T09:00:00Z'), endsAt: new Date('2026-06-02T09:20:00Z'), status: 'BOOKED', reason: null, cancelReason: null, cancelledBy: null, cancelledAt: null, createdBy: 'u', ...opts.appt }) as AppointmentRecord),
    cancelAppointment: jest.fn(async () => true),
    reassignPatient: jest.fn(async () => 1),
  };
  const events = { publish: jest.fn(async () => ({}) as never) };
  const values: Record<string, unknown> = { 'l10n.timezone': 'UTC', 'appointment.slot_minutes': 20, 'appointment.cancel_deadline_h': 24, 'appointment.reminder_offsets_h': [48, 2] };
  const settings = { get: jest.fn(async (c: string) => values[c]) };
  const access = { getAccess: jest.fn(async (id: string) => (id === 'd1' ? { userId: 'd1', email: 'd', etablissementId: 'e1', roles: [], permissions: ['CONSULT_RDV_PRACTITIONER'], active: true } : null)) };
  const patients = { isAccessible: jest.fn(async () => true) };
  const svc = new ConsultationService(repo as unknown as ConsultationRepository, new NoopUnitOfWork(), events, settings as never, access, patients, () => NOW);
  return { svc, repo, events, patients };
}

describe('ConsultationService', () => {
  it('génère les créneaux de la plage hebdomadaire et retire les créneaux réservés', async () => {
    const { svc } = setup({ booked: [{ startsAt: new Date('2026-06-02T09:20:00Z'), endsAt: new Date('2026-06-02T09:40:00Z') }] });
    const slots = await svc.freeSlots('d1', '2026-06-02', '2026-06-02', actor());
    expect(slots.map((s) => s.startsAt)).toEqual(['2026-06-02T09:00:00.000Z', '2026-06-02T09:40:00.000Z']);
  });

  it('refuse un praticien inconnu et une plage trop longue', async () => {
    const { svc } = setup();
    await expect(svc.freeSlots('x', '2026-06-02', '2026-06-02', actor())).rejects.toMatchObject({ code: 'practitioner_not_found' });
    await expect(svc.freeSlots('d1', '2026-06-01', '2026-07-30', actor())).rejects.toMatchObject({ status: 400 });
  });

  it('réserve un créneau valide, publie rdv.created avec les rappels paramétrés', async () => {
    const { svc, events } = setup();
    const a = await svc.book({ patientId: 'p1', practitionerId: 'd1', startsAt: new Date('2026-06-02T09:20:00Z') }, actor());
    expect(a.endsAt.toISOString()).toBe('2026-06-02T09:40:00.000Z');
    expect(events.publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'rdv.created', data: expect.objectContaining({ reminderOffsetsH: [48, 2] }) }), undefined);
  });

  it('refuse un créneau hors grille, hors horaires ou déjà pris', async () => {
    const hors = setup();
    await expect(hors.svc.book({ patientId: 'p1', practitionerId: 'd1', startsAt: new Date('2026-06-02T09:05:00Z') }, actor())).rejects.toMatchObject({ code: 'invalid_slot' });
    await expect(hors.svc.book({ patientId: 'p1', practitionerId: 'd1', startsAt: new Date('2026-06-02T11:00:00Z') }, actor())).rejects.toMatchObject({ code: 'invalid_slot' });
    const pris = setup({ booked: [{ startsAt: new Date('2026-06-02T09:00:00Z'), endsAt: new Date('2026-06-02T09:20:00Z') }] });
    await expect(pris.svc.book({ patientId: 'p1', practitionerId: 'd1', startsAt: new Date('2026-06-02T09:00:00Z') }, actor())).rejects.toMatchObject({ code: 'invalid_slot' });
  });

  it('refuse un patient inaccessible', async () => {
    const { svc, patients } = setup();
    patients.isAccessible.mockResolvedValue(false);
    await expect(svc.book({ patientId: 'p1', practitionerId: 'd1', startsAt: new Date('2026-06-02T09:00:00Z') }, actor())).rejects.toMatchObject({ code: 'patient_not_found' });
  });

  it('remonte slot_taken quand la contrainte d\'exclusion refuse (course entre deux réservations)', async () => {
    const { svc, repo } = setup();
    repo.createAppointment.mockRejectedValue(new ConflictError('pris', 'slot_taken'));
    await expect(svc.book({ patientId: 'p1', practitionerId: 'd1', startsAt: new Date('2026-06-02T09:00:00Z') }, actor())).rejects.toMatchObject({ code: 'slot_taken' });
  });

  it('annulation : refusée après le délai sauf droit dédié', async () => {
    const { svc, repo } = setup({ appt: { startsAt: new Date('2026-06-01T20:00:00Z') } }); // dans 12 h < 24 h
    await expect(svc.cancel('a1', 'Empêchement', actor())).rejects.toMatchObject({ code: 'cancel_deadline_passed' });
    await expect(svc.cancel('a1', 'Empêchement', actor(['CONSULT_RDV_CANCEL_LATE']))).resolves.toMatchObject({ status: 'CANCELLED' });
    expect(repo.cancelAppointment).toHaveBeenCalledTimes(1);
  });

  it('annulation dans les délais, rendez-vous passé ou déjà clos', async () => {
    expect((await setup({ appt: { startsAt: new Date('2026-06-05T09:00:00Z') } }).svc.cancel('a1', 'Empêchement', actor())).status).toBe('CANCELLED');
    await expect(setup({ appt: { startsAt: new Date('2026-05-30T09:00:00Z') } }).svc.cancel('a1', 'x y z', actor(['CONSULT_RDV_CANCEL_LATE']))).rejects.toMatchObject({ code: 'appointment_past' });
    await expect(setup({ appt: { status: 'CANCELLED' } }).svc.cancel('a1', 'x y z', actor())).rejects.toMatchObject({ code: 'appointment_not_booked' });
    await expect(setup({ appt: { etablissementId: 'autre' } }).svc.cancel('a1', 'x y z', actor())).rejects.toMatchObject({ status: 404 });
  });

  it('déplace les rendez-vous vers le dossier cible quand deux dossiers sont fusionnés', async () => {
    const { svc, repo } = setup();
    await svc.onPatientMerged({ eventId: 'e', type: 'patient.merged', occurredAt: '', data: { sourceId: 's', targetId: 't' } });
    expect(repo.reassignPatient).toHaveBeenCalledWith('s', 't');
  });

  it('refuse des plages qui se chevauchent', async () => {
    const { svc } = setup();
    await expect(svc.setSchedule('d1', { rules: [{ weekday: 1, start: '08:00', end: '10:00' }, { weekday: 1, start: '09:00', end: '11:00' }] }, actor())).rejects.toMatchObject({ status: 400 });
    await expect(svc.setSchedule('d1', { rules: [{ weekday: 1, start: '08:00', end: '10:00' }, { weekday: 2, start: '09:00', end: '11:00' }] }, actor())).resolves.toHaveLength(2);
  });
});
