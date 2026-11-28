import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { buildApp, prismaRepositories } from '../../src/app';
import { PrismaAuditWriter } from '../../src/core/audit/audit';
import { MemoryCache } from '../../src/core/cache/cache';
import { PrismaUnitOfWork, createPrisma } from '../../src/core/database/prisma';
import { EventBus } from '../../src/core/events/event-bus';
import { PrismaOutboxStore } from '../../src/core/events/prisma-outbox.store';
import { createLogger } from '../../src/core/logger/logger';
import { hashPassword } from '../../src/core/security/password';

const url = process.env['TEST_DATABASE_URL'];
const maybe = url ? describe : describe.skip;
const PASSWORD = 'Tr0ub4dor&Horse-Staple';
const run = randomUUID().slice(0, 8);

maybe('API patients (PostgreSQL réel)', () => {
  const prisma = createPrisma(url ?? 'postgresql://invalide');
  const app = buildApp({
    logger: createLogger('silent'), bus: new EventBus(new PrismaOutboxStore(prisma)), uow: new PrismaUnitOfWork(prisma), cache: new MemoryCache(),
    audit: new PrismaAuditWriter(prisma), jwtSecret: 'j'.repeat(40), encryptionKey: randomBytes(32).toString('base64'), corsOrigins: [], ...prismaRepositories(prisma),
  });
  const api = request(app);
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  let reception: string;
  let nobody: string;
  let vip: string;
  let approver: string;
  let both: string;

  async function token(label: string, permissions: string[]): Promise<string> {
    const etab = await prisma.etablissement.findFirstOrThrow({ where: { code: 'PRINCIPAL' } });
    const role = await prisma.role.create({ data: { code: `TEST_${label.toUpperCase()}_${run.toUpperCase()}`.replace(/[^A-Z_]/g, 'X'), label } });
    for (const code of permissions) {
      const perm = await prisma.permission.findUniqueOrThrow({ where: { code } });
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: perm.id } });
    }
    const email = `${label}-${run}@test.local`;
    const user = await prisma.user.create({ data: { etablissementId: etab.id, email, displayName: label, passwordHash: await hashPassword(PASSWORD) } });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
    const res = await api.post('/api/v1/auth/login').send({ email, password: PASSWORD });
    expect(res.body.data.status).toBe('AUTHENTICATED');
    return res.body.data.accessToken as string;
  }

  beforeAll(async () => {
    reception = await token('pat-reception', ['PATIENT_DOSSIER_READ', 'PATIENT_DOSSIER_CREATE', 'PATIENT_DOSSIER_UPDATE', 'PATIENT_FUSION_REQUEST']);
    approver = await token('pat-approver', ['PATIENT_DOSSIER_READ', 'PATIENT_FUSION_APPROVE']);
    both = await token('pat-both', ['PATIENT_DOSSIER_READ', 'PATIENT_FUSION_REQUEST', 'PATIENT_FUSION_APPROVE']);
    nobody = await token('pat-nobody', []);
    vip = await token('pat-vip', ['PATIENT_DOSSIER_READ', 'PATIENT_DOSSIER_CREATE', 'PATIENT_DOSSIER_READ_RESTRICTED']);
  });
  afterAll(async () => {
    // L'audit est écrit à la fin de la réponse (hors requête) : on laisse les écritures en cours se terminer.
    await new Promise((r) => setTimeout(r, 500));
    await prisma.$disconnect();
  });

  const body = (over: object = {}) => ({ lastName: `Zorglub${run}`, firstName: 'Étienne', birthDate: '1985-03-12', sex: 'M', nationalId: `NID${run}`, ...over });
  let id: string;

  it('crée un dossier avec numéro unique et identifiant national masqué', async () => {
    const res = await api.post('/api/v1/patients').set(bearer(reception)).send(body());
    expect(res.status).toBe(201);
    expect(res.body.data.mrn).toMatch(/^PRINCIPAL-\d{4}-\d{6}$/);
    expect(res.body.data.nationalIdMasked).toMatch(/^\*+/);
    expect(JSON.stringify(res.body)).not.toContain(`NID${run}`);
    id = res.body.data.id;
    const second = await api.post('/api/v1/patients').set(bearer(reception)).send(body({ lastName: `Autre${run}`, firstName: 'Zoé', birthDate: '1970-01-01', nationalId: undefined }));
    expect(second.body.data.mrn).not.toBe(res.body.data.mrn);
  });

  it('détecte le doublon (même identifiant national) puis accepte la confirmation', async () => {
    const dup = await api.post('/api/v1/patients').set(bearer(reception)).send(body({ lastName: `Diff${run}`, firstName: `Nom${run}` }));
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('possible_duplicate');
    expect(dup.body.candidates.map((c: { id: string }) => c.id)).toContain(id);
    const ok = await api.post('/api/v1/patients').set(bearer(reception)).send(body({ lastName: `Diff${run}`, firstName: `Nom${run}`, confirmNotDuplicate: true }));
    expect(ok.status).toBe(201);
  });

  it('recherche sans tenir compte des accents et lit/modifie un dossier', async () => {
    const found = await api.get('/api/v1/patients').query({ q: `zorglub${run}` }).set(bearer(reception));
    expect(found.status).toBe(200);
    expect(found.body.data.map((p: { id: string }) => p.id)).toContain(id);
    expect((await api.get(`/api/v1/patients/${id}`).set(bearer(reception))).body.data.firstName).toBe('Étienne');
    const upd = await api.patch(`/api/v1/patients/${id}`).set(bearer(reception)).send({ phone: '+33 6 12 34 56 78' });
    expect(upd.body.data.phone).toBe('+33 6 12 34 56 78');
    expect((await api.patch(`/api/v1/patients/${id}`).set(bearer(reception)).send({})).status).toBe(400);
  });

  it('refuse sans permission et valide les entrées', async () => {
    expect((await api.get(`/api/v1/patients/${id}`).set(bearer(nobody))).status).toBe(403);
    expect((await api.get('/api/v1/patients')).status).toBe(401);
    expect((await api.post('/api/v1/patients').set(bearer(reception)).send({ lastName: 'x' })).status).toBe(400);
    expect((await api.get('/api/v1/patients').set(bearer(reception))).status).toBe(400);
  });

  it('dossier restreint : invisible sans le droit dédié', async () => {
    const denied = await api.post('/api/v1/patients').set(bearer(reception)).send(body({ lastName: `Secret${run}`, nationalId: undefined, birthDate: '1960-02-02', confidentiality: 'RESTRICTED' }));
    expect(denied.status).toBe(403);
    const made = await api.post('/api/v1/patients').set(bearer(vip)).send(body({ lastName: `Secret${run}`, nationalId: undefined, birthDate: '1960-02-02', confidentiality: 'RESTRICTED' }));
    expect(made.status).toBe(201);
    expect((await api.get(`/api/v1/patients/${made.body.data.id}`).set(bearer(reception))).status).toBe(403);
    const search = await api.get('/api/v1/patients').query({ q: `secret${run}` }).set(bearer(reception));
    expect(search.body.data).toHaveLength(0);
    expect((await api.get(`/api/v1/patients/${made.body.data.id}`).set(bearer(vip))).status).toBe(200);
  });

  it('journalise la lecture avec l\'identifiant du patient', async () => {
    await new Promise((r) => setTimeout(r, 300));
    const logs = await prisma.auditLog.findMany({ where: { patientId: id, action: 'PATIENT_READ' } });
    expect(logs.length).toBeGreaterThan(0);
  });

  it('fusion : demande, séparation des tâches, approbation, dossier source désactivé', async () => {
    const mk = async (n: string) =>
      (await api.post('/api/v1/patients').set(bearer(reception)).send({ lastName: `Fus${n}${run}`, firstName: `P${n}`, birthDate: `19${n}0-01-01`, sex: 'F', confirmNotDuplicate: true })).body.data.id as string;
    const [src, dst] = [await mk('1'), await mk('2')];

    expect((await api.post('/api/v1/patients/merges').set(bearer(nobody)).send({ sourceId: src, targetId: dst, reason: 'Doublon avéré' })).status).toBe(403);
    const req = await api.post('/api/v1/patients/merges').set(bearer(both)).send({ sourceId: src, targetId: dst, reason: 'Doublon avéré' });
    expect(req.status).toBe(202);
    expect(req.body.data.status).toBe('PENDING');
    const mid = req.body.data.id as string;

    expect((await api.post('/api/v1/patients/merges').set(bearer(reception)).send({ sourceId: src, targetId: dst, reason: 'Encore' })).status).toBe(409);
    const self = await api.post(`/api/v1/patients/merges/${mid}/approve`).set(bearer(both));
    expect(self.status).toBe(403);
    expect(self.body.code).toBe('sod_violation');
    expect((await api.post(`/api/v1/patients/merges/${mid}/approve`).set(bearer(reception))).status).toBe(403);

    const ok = await api.post(`/api/v1/patients/merges/${mid}/approve`).set(bearer(approver));
    expect(ok.status).toBe(200);
    expect(ok.body.data.status).toBe('COMPLETED');
    expect((await api.post(`/api/v1/patients/merges/${mid}/approve`).set(bearer(approver))).status).toBe(409);

    const source = (await api.get(`/api/v1/patients/${src}`).set(bearer(reception))).body.data;
    expect(source).toMatchObject({ active: false, mergedIntoId: dst });
    expect((await api.patch(`/api/v1/patients/${src}`).set(bearer(reception)).send({ phone: '+33 1 02 03 04 05' })).status).toBe(422);
    const found = await api.get('/api/v1/patients').query({ q: `fus1${run}` }).set(bearer(reception));
    expect(found.body.data).toHaveLength(0);
    expect((await api.get('/api/v1/patients/merges').query({ status: 'COMPLETED' }).set(bearer(reception))).body.data.length).toBeGreaterThan(0);
  });
});
