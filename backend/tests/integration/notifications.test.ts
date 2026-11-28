import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { buildContainer, prismaRepositories } from '../../src/app';
import { PrismaAuditWriter } from '../../src/core/audit/audit';
import { MemoryCache } from '../../src/core/cache/cache';
import { PrismaUnitOfWork, createPrisma } from '../../src/core/database/prisma';
import { EventBus, OutboxRelay } from '../../src/core/events/event-bus';
import { PrismaOutboxStore } from '../../src/core/events/prisma-outbox.store';
import { createLogger } from '../../src/core/logger/logger';
import { hashPassword } from '../../src/core/security/password';
import type { NotificationSender } from '../../src/modules/notifications';

const url = process.env['TEST_DATABASE_URL'];
const maybe = url ? describe : describe.skip;
const PASSWORD = 'Tr0ub4dor&Horse-Staple';
const run = randomUUID().slice(0, 8);
const dayPlus = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

maybe('Notifications (PostgreSQL réel)', () => {
  const prisma = createPrisma(url ?? 'postgresql://invalide');
  const logger = createLogger('silent');
  const store = new PrismaOutboxStore(prisma);
  const bus = new EventBus(store);
  const sent: { channel: string; to: string; body: string }[] = [];
  const senders: NotificationSender[] = (['EMAIL', 'SMS'] as const).map((channel) => ({ channel, send: async (m) => void sent.push({ channel, to: m.to, body: m.body }) }));
  const { app, notifications } = buildContainer({
    logger, bus, uow: new PrismaUnitOfWork(prisma), cache: new MemoryCache(), audit: new PrismaAuditWriter(prisma),
    jwtSecret: 'j'.repeat(40), encryptionKey: randomBytes(32).toString('base64'), corsOrigins: [], senders, ...prismaRepositories(prisma),
  });
  const relay = new OutboxRelay(store, bus, logger);
  const api = request(app);
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const drain = async () => {
    for (let i = 0; i < 6; i++) await relay.tick();
  };
  // Instant de référence : après la réservation mais bien avant les rappels (J-2 à 12h UTC)
  const REF = new Date(`${dayPlus(2)}T12:00:00Z`);
  let desk: string;
  let reader: string;
  let doctorId: string;
  let patientId: string;
  let apptId: string;

  async function account(label: string, permissions: string[]) {
    const etab = await prisma.etablissement.findFirstOrThrow({ where: { code: 'PRINCIPAL' } });
    const role = await prisma.role.create({ data: { code: `TEST_${label}_${run}`.toUpperCase().replace(/[^A-Z_]/g, 'X'), label } });
    for (const code of permissions) {
      const perm = await prisma.permission.findUniqueOrThrow({ where: { code } });
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: perm.id } });
    }
    const email = `${label}-${run}@test.local`;
    const user = await prisma.user.create({ data: { etablissementId: etab.id, email, displayName: label, passwordHash: await hashPassword(PASSWORD) } });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
    const res = await api.post('/api/v1/auth/login').send({ email, password: PASSWORD });
    return { id: user.id, token: res.body.data.accessToken as string };
  }

  beforeAll(async () => {
    doctorId = (await account('ntfdoc', ['CONSULT_RDV_PRACTITIONER'])).id;
    const chief = (await account('ntfchief', ['CONSULT_AGENDA_UPDATE'])).token;
    desk = (await account('ntfdesk', ['CONSULT_RDV_READ', 'CONSULT_RDV_CREATE', 'CONSULT_RDV_CANCEL', 'PATIENT_DOSSIER_CREATE', 'PATIENT_DOSSIER_READ'])).token;
    reader = (await account('ntfread', ['NOTIF_NOTIFICATION_READ', 'NOTIF_NOTIFICATION_RETRY'])).token;
    await api.put(`/api/v1/consultation/agenda/${doctorId}`).set(bearer(chief)).send({ rules: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: '08:00', end: '09:00' })) });
    const p = await api.post('/api/v1/patients').set(bearer(desk)).send({
      lastName: `Notif${run}`, firstName: 'Test', birthDate: '1980-02-02', phone: '+33 6 12 34 56 78', email: `patient-${run}@mail.test`, confirmNotDuplicate: true,
    });
    patientId = p.body.data.id;
  });
  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 500));
    await prisma.$disconnect();
  });

  const rows = (status?: string) => prisma.notification.findMany({ where: { subjectId: apptId, ...(status ? { status: status as 'PENDING' } : {}) } });

  it('planifie confirmation et rappels à la réservation (idempotent si l\'événement est rejoué)', async () => {
    const slots = await api.get(`/api/v1/consultation/agenda/${doctorId}/slots`).query({ from: dayPlus(5), to: dayPlus(5) }).set(bearer(desk));
    const booked = await api.post('/api/v1/consultation/appointments').set(bearer(desk)).send({ patientId, practitionerId: doctorId, startsAt: slots.body.data[0].startsAt });
    expect(booked.status).toBe(201);
    apptId = booked.body.data.id;
    await drain();
    const all = await rows();
    // 2 canaux × (1 confirmation + rappels à 48 h et 2 h)
    expect(all).toHaveLength(6);
    expect(all.filter((n) => n.template === 'rdv.reminder')).toHaveLength(4);
    const event = await prisma.outboxEvent.findFirstOrThrow({ where: { eventType: 'rdv.created', payload: { path: ['data', 'appointmentId'], equals: apptId } } });
    await bus.dispatch({ eventId: event.id, type: event.eventType, occurredAt: event.createdAt.toISOString(), etablissementId: event.etablissementId ?? undefined, data: (event.payload as { data: unknown }).data });
    expect(await rows()).toHaveLength(6);
  });

  it('envoie les confirmations dues, aux bonnes coordonnées, sans toucher aux rappels futurs', async () => {
    await notifications.dispatchDue(REF);
    expect(sent.map((s) => `${s.channel}:${s.to}`).sort()).toEqual([`EMAIL:patient-${run}@mail.test`, 'SMS:+33 6 12 34 56 78']);
    expect(sent[0]!.body).toContain('confirmé');
    expect((await rows('SENT')).length).toBe(2);
    expect((await rows('PENDING')).length).toBe(4);
  });

  it('liste les notifications (droit requis) et refuse de relancer une notification non échouée', async () => {
    expect((await api.get('/api/v1/notifications').set(bearer(desk))).status).toBe(403);
    const list = await api.get('/api/v1/notifications').query({ patientId, status: 'SENT' }).set(bearer(reader));
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBeGreaterThanOrEqual(2);
    const pending = (await rows('PENDING'))[0]!;
    expect((await api.post(`/api/v1/notifications/${pending.id}/retry`).set(bearer(reader))).status).toBe(409);
    expect((await api.post(`/api/v1/notifications/${randomUUID()}/retry`).set(bearer(reader))).status).toBe(404);
  });

  it('l\'annulation supprime les rappels en attente et prévient le patient', async () => {
    sent.length = 0;
    const res = await api.post(`/api/v1/consultation/appointments/${apptId}/cancel`).set(bearer(desk)).send({ reason: 'Empêchement du patient' });
    expect(res.status).toBe(200);
    await drain();
    expect((await rows('CANCELLED')).length).toBe(4);
    await notifications.dispatchDue(REF);
    expect(sent).toHaveLength(2);
    expect(sent.every((s) => s.body.includes('annulé'))).toBe(true);
    expect((await rows('PENDING')).length).toBe(0);
  });

  it('un échec d\'envoi est réessayé puis marqué en échec, et peut être relancé', async () => {
    const n = await prisma.notification.create({
      data: { etablissementId: (await prisma.patient.findUniqueOrThrow({ where: { id: patientId } })).etablissementId, patientId, channel: 'EMAIL', template: 'rdv.reminder', subjectType: 'APPOINTMENT', subjectId: randomUUID(), payload: { startsAt: REF.toISOString() }, dedupeKey: `t:${run}`, scheduledFor: new Date(REF.getTime() - 1000), attempts: 10 },
    });
    senders[0]!.send = async () => {
      throw new Error('SMTP indisponible');
    };
    await notifications.dispatchDue(REF);
    const failed = await prisma.notification.findUniqueOrThrow({ where: { id: n.id } });
    expect(failed.status).toBe('FAILED');
    expect(failed.lastError).toContain('SMTP');
    expect((await api.post(`/api/v1/notifications/${n.id}/retry`).set(bearer(reader))).status).toBe(202);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: n.id } })).status).toBe('PENDING');
  });
});
