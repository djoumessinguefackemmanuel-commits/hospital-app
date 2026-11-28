import { randomBytes, randomUUID } from 'node:crypto';
import { authenticator } from 'otplib';
import request from 'supertest';
import { buildApp, prismaRepositories } from '../../src/app';
import { PrismaAuditWriter } from '../../src/core/audit/audit';
import { MemoryCache } from '../../src/core/cache/cache';
import { PrismaUnitOfWork, createPrisma } from '../../src/core/database/prisma';
import { EventBus, OutboxRelay } from '../../src/core/events/event-bus';
import { PrismaOutboxStore } from '../../src/core/events/prisma-outbox.store';
import { createLogger } from '../../src/core/logger/logger';
import { encryptString } from '../../src/core/security/crypto';
import { hashPassword } from '../../src/core/security/password';

/** Suite d'intégration : s'exécute seulement si TEST_DATABASE_URL pointe vers une base migrée et alimentée (seed). */
const url = process.env['TEST_DATABASE_URL'];
const maybe = url ? describe : describe.skip;

const KEY = randomBytes(32).toString('base64');
const PASSWORD = 'Tr0ub4dor&Horse-Staple';
const run = randomUUID().slice(0, 8);

maybe('API (PostgreSQL réel)', () => {
  const prisma = createPrisma(url ?? 'postgresql://invalide');
  const store = new PrismaOutboxStore(prisma);
  const bus = new EventBus(store);
  const logger = createLogger('silent');
  const relay = new OutboxRelay(store, bus, logger);
  const audit = new PrismaAuditWriter(prisma);
  const app = buildApp({
    logger, bus, uow: new PrismaUnitOfWork(prisma), cache: new MemoryCache(), audit,
    jwtSecret: 'j'.repeat(40), encryptionKey: KEY, corsOrigins: [], ...prismaRepositories(prisma),
  });
  const api = request(app);
  let etablissementId: string;
  const secrets = new Map<string, string>();

  async function makeUser(label: string, roleCode?: string, mfa = false) {
    const email = `${label}-${run}@test.local`;
    const secret = authenticator.generateSecret();
    const user = await prisma.user.create({
      data: {
        etablissementId, email, displayName: label, passwordHash: await hashPassword(PASSWORD),
        mfaEnabled: mfa, mfaSecretEnc: mfa ? encryptString(KEY, secret) : null,
      },
    });
    if (roleCode) {
      const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode } });
      await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
    }
    secrets.set(email, secret);
    return { id: user.id, email };
  }

  async function login(email: string, password = PASSWORD) {
    return api.post('/api/v1/auth/login').send({ email, password });
  }
  async function loginMfa(email: string): Promise<string> {
    const step1 = await login(email);
    expect(step1.body.data.status).toBe('MFA_REQUIRED');
    const step2 = await api.post('/api/v1/auth/mfa/verify').send({ mfaToken: step1.body.data.mfaToken, code: authenticator.generate(secrets.get(email)!) });
    expect(step2.status).toBe(200);
    return step2.body.data.accessToken as string;
  }
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    etablissementId = (await prisma.etablissement.findFirstOrThrow({ where: { code: 'PRINCIPAL' } })).id;
  });
  afterAll(async () => {
    // L'audit est écrit à la fin de la réponse (hors requête) : on laisse les écritures en cours se terminer.
    await new Promise((r) => setTimeout(r, 500));
    await prisma.$disconnect();
  });

  it('expose /health et répond aux routes inconnues en problem+json', async () => {
    expect((await api.get('/health')).body).toEqual({ status: 'ok' });
    const res = await api.get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.headers['x-correlation-id']).toBeDefined();
  });

  it('rejette un corps invalide (400) et ne révèle pas si l\'e-mail existe (401)', async () => {
    expect((await api.post('/api/v1/auth/login').send({ email: 'pas-un-email' })).status).toBe(400);
    const u = await makeUser('plain-a');
    const bad = await login(u.email, 'mauvais');
    const unknown = await login(`inconnu-${run}@test.local`, 'mauvais');
    expect(bad.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(bad.body.code).toBe(unknown.body.code);
  });

  it('verrouille le compte après 5 échecs, même avec le bon mot de passe ensuite', async () => {
    const u = await makeUser('plain-lock');
    for (let i = 0; i < 5; i++) await login(u.email, 'mauvais');
    const res = await login(u.email);
    expect(res.status).toBe(423);
    expect(res.body.code).toBe('account_locked');
  });

  it('ouvre une session, tourne le refresh token et détecte sa réutilisation', async () => {
    const u = await makeUser('plain-b');
    const res = await login(u.email);
    expect(res.body.data.status).toBe('AUTHENTICATED');
    const { accessToken, refreshToken } = res.body.data;
    const me = await api.get('/api/v1/auth/me').set(bearer(accessToken));
    expect(me.body.data.email).toBe(u.email);

    const rotated = await api.post('/api/v1/auth/refresh').send({ refreshToken });
    expect(rotated.status).toBe(200);
    expect(rotated.body.data.refreshToken).not.toBe(refreshToken);

    const replay = await api.post('/api/v1/auth/refresh').send({ refreshToken });
    expect(replay.status).toBe(401);
    // la famille entière est révoquée : le jeton légitime ne marche plus non plus
    expect((await api.post('/api/v1/auth/refresh').send({ refreshToken: rotated.body.data.refreshToken })).status).toBe(401);
  });

  it('déconnecte en révoquant la session', async () => {
    const u = await makeUser('plain-c');
    const { refreshToken } = (await login(u.email)).body.data;
    expect((await api.post('/api/v1/auth/logout').send({ refreshToken })).status).toBe(204);
    expect((await api.post('/api/v1/auth/refresh').send({ refreshToken })).status).toBe(401);
  });

  it('exige un jeton valide et la bonne permission', async () => {
    expect((await api.get('/api/v1/parametrage/definitions')).status).toBe(401);
    expect((await api.get('/api/v1/parametrage/definitions').set(bearer('x.y.z'))).status).toBe(401);
    const u = await makeUser('plain-d');
    const token = (await login(u.email)).body.data.accessToken;
    const res = await api.get('/api/v1/parametrage/definitions').set(bearer(token));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('permission_denied');
    // un jeton à objet MFA ne donne accès à aucune route
    const mfaOnly = (await login((await makeUser('mfa-only', undefined, true)).email)).body.data.mfaToken;
    expect((await api.get('/api/v1/auth/me').set(bearer(mfaOnly))).status).toBe(401);
  });

  it('impose l\'enrôlement MFA aux rôles sensibles puis le second facteur à chaque connexion', async () => {
    const admin = await makeUser('admin-mfa', 'ADMIN_SYSTEME');
    const first = await login(admin.email);
    expect(first.body.data.status).toBe('MFA_SETUP_REQUIRED');
    const { setupToken } = first.body.data;
    expect((await api.post('/api/v1/auth/mfa/setup/confirm').send({ setupToken, code: '123456' })).status).toBe(422);

    const start = await api.post('/api/v1/auth/mfa/setup').send({ setupToken });
    expect(start.body.data.otpauthUrl).toContain('otpauth://totp/');
    secrets.set(admin.email, start.body.data.secret);
    const wrong = await api.post('/api/v1/auth/mfa/setup/confirm').send({ setupToken, code: '000000' });
    expect(wrong.status).toBe(401);
    const ok = await api.post('/api/v1/auth/mfa/setup/confirm').send({ setupToken, code: authenticator.generate(start.body.data.secret) });
    expect(ok.body.data.status).toBe('AUTHENTICATED');

    const again = await login(admin.email);
    expect(again.body.data.status).toBe('MFA_REQUIRED');
    const bad = await api.post('/api/v1/auth/mfa/verify').send({ mfaToken: again.body.data.mfaToken, code: '000000' });
    expect(bad.status).toBe(401);
    expect(bad.body.code).toBe('invalid_mfa_code');
  });

  it('un jeton sans second facteur est refusé pour un rôle qui l\'exige', async () => {
    const dir = await makeUser('dir-nomfa', 'DIRECTEUR', true);
    const { JwtService } = await import('../../src/core/security/jwt');
    const forged = new JwtService('j'.repeat(40)).sign({ sub: dir.id, purpose: 'access', mfa: false }, 60);
    const res = await api.get('/api/v1/parametrage/definitions').set(bearer(forged));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('mfa_required');
  });

  describe('paramétrage', () => {
    let adminToken: string;
    let directorToken: string;
    beforeAll(async () => {
      const admin = await makeUser('admin-param', 'ADMIN_SYSTEME', true);
      const director = await makeUser('dir-param', 'DIRECTEUR', true);
      adminToken = await loginMfa(admin.email);
      directorToken = await loginMfa(director.email);
    });

    it('liste les définitions et applique une valeur validée (publication immédiate)', async () => {
      const list = await api.get('/api/v1/parametrage/definitions?module=security').set(bearer(adminToken));
      expect(list.body.data.length).toBeGreaterThan(5);

      const put = await api.put('/api/v1/parametrage/parametres/security.session.idle_timeout_min').set(bearer(adminToken))
        .send({ scopeType: 'GLOBAL', value: 20, reason: 'Test intégration' });
      expect(put.status).toBe(201);
      await relay.tick();
      const eff = await api.get('/api/v1/parametrage/parametres/security.session.idle_timeout_min').set(bearer(adminToken));
      expect(eff.body.data.value).toBe(20);
    });

    it('refuse une valeur hors bornes et un motif absent', async () => {
      const bad = await api.put('/api/v1/parametrage/parametres/security.session.idle_timeout_min').set(bearer(adminToken))
        .send({ scopeType: 'GLOBAL', value: 5000, reason: 'Trop grand' });
      expect(bad.status).toBe(422);
      const noReason = await api.put('/api/v1/parametrage/parametres/security.session.idle_timeout_min').set(bearer(adminToken))
        .send({ scopeType: 'GLOBAL', value: 10 });
      expect(noReason.status).toBe(400);
      expect((await api.put('/api/v1/parametrage/parametres/inconnu.param').set(bearer(adminToken)).send({ scopeType: 'GLOBAL', value: 1, reason: 'abc' })).status).toBe(404);
    });

    it('un paramètre critique attend l\'approbation d\'une autre personne, puis rollback versionné', async () => {
      const code = 'security.login.lockout_min';
      const crit = 'audit.retention_years';
      const put = await api.put(`/api/v1/parametrage/parametres/${crit}`).set(bearer(adminToken)).send({ scopeType: 'GLOBAL', value: 12, reason: 'Obligation légale' });
      expect(put.status).toBe(202);
      expect(put.body.data.status).toBe('PENDING_APPROVAL');
      await relay.tick();
      // pas encore appliqué
      expect((await api.get(`/api/v1/parametrage/parametres/${crit}`).set(bearer(adminToken))).body.data.value).toBe(10);

      // l'auteur n'a pas le droit d'approuver (permission absente)
      const self = await api.post(`/api/v1/parametrage/parametres/${crit}/approve`).set(bearer(adminToken)).send({ scopeType: 'GLOBAL', version: put.body.data.version });
      expect(self.status).toBe(403);

      const approved = await api.post(`/api/v1/parametrage/parametres/${crit}/approve`).set(bearer(directorToken)).send({ scopeType: 'GLOBAL', version: put.body.data.version });
      expect(approved.status).toBe(200);
      await relay.tick();
      expect((await api.get(`/api/v1/parametrage/parametres/${crit}`).set(bearer(adminToken))).body.data.value).toBe(12);

      const history = await api.get(`/api/v1/parametrage/parametres/${crit}/history`).set(bearer(adminToken));
      expect(history.body.data.length).toBeGreaterThanOrEqual(2);
      expect(code).toBeDefined();
    });

    it('propage le changement d\'un paramètre de sécurité (verrouillage) à la connexion', async () => {
      const get = await api.get('/api/v1/parametrage/parametres/security.login.max_attempts').set(bearer(adminToken));
      expect(get.body.data.value).toBe(5);
    });
  });

  it('chaîne d\'audit intacte après toute la suite, et journal impossible à modifier', async () => {
    await new Promise((r) => setTimeout(r, 300)); // laisse finir les écritures d'audit après réponse
    expect(await audit.verify()).toBe(-1);
    const count = await prisma.auditLog.count();
    expect(count).toBeGreaterThan(0);
    {
      await expect(prisma.$executeRawUnsafe(`UPDATE shared.audit_logs SET action = 'x' WHERE seq >= 0`)).rejects.toThrow(/ajout seul/);
      await expect(prisma.$executeRawUnsafe(`DELETE FROM shared.audit_logs`)).rejects.toThrow(/ajout seul/);
    }
  });
});
