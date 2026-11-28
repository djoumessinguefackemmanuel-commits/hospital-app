import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { buildApp, prismaRepositories } from '../../src/app';
import { PrismaAuditWriter } from '../../src/core/audit/audit';
import { MemoryCache } from '../../src/core/cache/cache';
import { PrismaUnitOfWork, createPrisma } from '../../src/core/database/prisma';
import { EventBus, OutboxRelay } from '../../src/core/events/event-bus';
import { PrismaOutboxStore } from '../../src/core/events/prisma-outbox.store';
import { createLogger } from '../../src/core/logger/logger';
import { hashPassword } from '../../src/core/security/password';

const url = process.env['TEST_DATABASE_URL'];
const maybe = url ? describe : describe.skip;
const PASSWORD = 'Tr0ub4dor&Horse-Staple';
const run = randomUUID().slice(0, 8);
const dayPlus = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

maybe('API consultation (PostgreSQL réel)', () => {
  const prisma = createPrisma(url ?? 'postgresql://invalide');
  const logger = createLogger('silent');
  const store = new PrismaOutboxStore(prisma);
  const bus = new EventBus(store);
  const app = buildApp({
    logger, bus, uow: new PrismaUnitOfWork(prisma), cache: new MemoryCache(), audit: new PrismaAuditWriter(prisma),
    jwtSecret: 'j'.repeat(40), encryptionKey: randomBytes(32).toString('base64'), corsOrigins: [], ...prismaRepositories(prisma),
  });
  const relay = new OutboxRelay(store, bus, logger);
  const api = request(app);
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  let desk: string;
  let chief: string;
  let nobody: string;
  let doctorId: string;
  let patientA: string;
  let patientB: string;

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
    const d = await account('rdvdoc', ['CONSULT_RDV_PRACTITIONER', 'CONSULT_RDV_READ']);
    doctorId = d.id;
    desk = (await account('rdvdesk', ['CONSULT_RDV_READ', 'CONSULT_RDV_CREATE', 'CONSULT_RDV_CANCEL', 'PATIENT_DOSSIER_CREATE', 'PATIENT_DOSSIER_READ', 'PATIENT_FUSION_REQUEST'])).token;
    chief = (await account('rdvchief', ['CONSULT_AGENDA_UPDATE', 'CONSULT_RDV_READ', 'PATIENT_FUSION_APPROVE'])).token;
    nobody = (await account('rdvnobody', [])).token;
    const mk = async (n: string) =>
      (await api.post('/api/v1/patients').set(bearer(desk)).send({ lastName: `Rdv${n}${run}`, firstName: 'Test', birthDate: `19${n}0-06-06`, confirmNotDuplicate: true })).body.data.id as string;
    patientA = await mk('1');
    patientB = await mk('2');
  });
  afterAll(async () => {
    // L'audit est écrit à la fin de la réponse (hors requête) : on laisse les écritures en cours se terminer.
    await new Promise((r) => setTimeout(r, 500));
    await prisma.$disconnect();
  });

  const slotsOn = async (day: string) => (await api.get(`/api/v1/consultation/agenda/${doctorId}/slots`).query({ from: day, to: day }).set(bearer(desk))).body.data as { startsAt: string }[];
  let slot: string;
  let apptId: string;

  it('définit l\'agenda (réservé au droit dédié) puis liste les créneaux libres', async () => {
    const rules = { rules: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: '08:00', end: '09:00' })) };
    expect((await api.put(`/api/v1/consultation/agenda/${doctorId}`).set(bearer(desk)).send(rules)).status).toBe(403);
    expect((await api.put(`/api/v1/consultation/agenda/${randomUUID()}`).set(bearer(chief)).send(rules)).status).toBe(404);
    expect((await api.put(`/api/v1/consultation/agenda/${doctorId}`).set(bearer(chief)).send(rules)).status).toBe(200);
    const slots = await slotsOn(dayPlus(5));
    expect(slots).toHaveLength(3); // 3 créneaux de 20 min entre 8h et 9h
    slot = slots[0]!.startsAt;
  });

  it('réserve un créneau, qui disparaît ensuite de la liste', async () => {
    const res = await api.post('/api/v1/consultation/appointments').set(bearer(desk)).send({ patientId: patientA, practitionerId: doctorId, startsAt: slot, reason: 'Contrôle' });
    expect(res.status).toBe(201);
    apptId = res.body.data.id;
    expect((await slotsOn(dayPlus(5))).map((s) => s.startsAt)).not.toContain(slot);
    const again = await api.post('/api/v1/consultation/appointments').set(bearer(desk)).send({ patientId: patientB, practitionerId: doctorId, startsAt: slot });
    expect(again.status).toBe(422);
    expect(again.body.code).toBe('invalid_slot');
  });

  it('deux réservations simultanées du même créneau : une seule réussit', async () => {
    const free = await slotsOn(dayPlus(6));
    const target = free[0]!.startsAt;
    const send = (patientId: string) => api.post('/api/v1/consultation/appointments').set(bearer(desk)).send({ patientId, practitionerId: doctorId, startsAt: target });
    const results = await Promise.all([send(patientA), send(patientB), send(patientA), send(patientB)]);
    const codes = results.map((r) => r.status).sort();
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.filter((c) => c === 201 || c === 409 || c === 422)).toHaveLength(4);
    expect(await prisma.appointment.count({ where: { practitionerId: doctorId, startsAt: new Date(target), status: 'BOOKED' } })).toBe(1);
  });

  it('refuse sans droit, praticien inconnu, créneau hors grille', async () => {
    expect((await api.get('/api/v1/consultation/appointments').set(bearer(nobody))).status).toBe(403);
    const body = { patientId: patientA, practitionerId: randomUUID(), startsAt: slot };
    expect((await api.post('/api/v1/consultation/appointments').set(bearer(desk)).send(body)).status).toBe(404);
    const offGrid = new Date(new Date(slot).getTime() + 5 * 60_000).toISOString();
    expect((await api.post('/api/v1/consultation/appointments').set(bearer(desk)).send({ ...body, practitionerId: doctorId, startsAt: offGrid })).status).toBe(422);
  });

  it('suit le dossier patient lors d\'une fusion (événement patient.merged)', async () => {
    const m = await api.post('/api/v1/patients/merges').set(bearer(desk)).send({ sourceId: patientA, targetId: patientB, reason: 'Même personne' });
    expect(m.status).toBe(202);
    expect((await api.post(`/api/v1/patients/merges/${m.body.data.id}/approve`).set(bearer(chief))).status).toBe(200);
    for (let i = 0; i < 5; i++) await relay.tick();
    const list = await api.get('/api/v1/consultation/appointments').query({ patientId: patientB }).set(bearer(desk));
    expect(list.body.data.map((a: { id: string }) => a.id)).toContain(apptId);
  });

  it('annule un rendez-vous lointain, puis refuse une deuxième annulation', async () => {
    const res = await api.post(`/api/v1/consultation/appointments/${apptId}/cancel`).set(bearer(desk)).send({ reason: 'Empêchement du patient' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CANCELLED');
    expect((await slotsOn(dayPlus(5))).map((s) => s.startsAt)).toContain(slot);
    expect((await api.post(`/api/v1/consultation/appointments/${apptId}/cancel`).set(bearer(desk)).send({ reason: 'Encore une fois' })).status).toBe(409);
  });
});
