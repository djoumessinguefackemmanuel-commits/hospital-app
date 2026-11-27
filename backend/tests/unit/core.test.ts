import { randomBytes } from 'node:crypto';
import { MemoryAuditWriter, computeAuditHash, normalizeEntry, verifyAuditChain } from '../../src/core/audit/audit';
import { MemoryCache } from '../../src/core/cache/cache';
import { AppError, TooManyRequestsError } from '../../src/core/errors/app-error';
import { EventBus, InMemoryOutboxStore, OutboxRelay } from '../../src/core/events/event-bus';
import { createLogger } from '../../src/core/logger/logger';
import { decryptString, encryptString, safeEqual, sha256Hex } from '../../src/core/security/crypto';
import { JwtService } from '../../src/core/security/jwt';
import { checkPasswordPolicy, hashPassword, verifyPassword } from '../../src/core/security/password';

const key = randomBytes(32).toString('base64');

describe('crypto', () => {
  it('chiffre puis déchiffre, avec un IV différent à chaque fois', () => {
    const a = encryptString(key, 'secret');
    const b = encryptString(key, 'secret');
    expect(a).not.toEqual(b);
    expect(decryptString(key, a)).toBe('secret');
  });
  it('refuse un message altéré ou une mauvaise clé', () => {
    const enc = encryptString(key, 'secret');
    const parts = enc.split('.');
    parts[3] = Buffer.from('xxxx').toString('base64');
    expect(() => decryptString(key, parts.join('.'))).toThrow();
    expect(() => decryptString(randomBytes(32).toString('base64'), enc)).toThrow();
  });
  it('compare en temps constant et hache en SHA-256', () => {
    expect(safeEqual('a', 'a')).toBe(true);
    expect(safeEqual('a', 'b')).toBe(false);
    expect(safeEqual('a', 'abc')).toBe(false);
    expect(sha256Hex('abc')).toHaveLength(64);
  });
});

describe('mots de passe', () => {
  it('argon2id : vérifie le bon mot de passe uniquement', async () => {
    const h = await hashPassword('Abcdef1!ghij');
    expect(h.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(h, 'Abcdef1!ghij')).toBe(true);
    expect(await verifyPassword(h, 'autre')).toBe(false);
    expect(await verifyPassword('pas-un-hash', 'x')).toBe(false);
  });
  it('politique : liste les règles manquantes', () => {
    expect(checkPasswordPolicy('Abcdef1!ghij', { minLength: 12 })).toEqual([]);
    expect(checkPasswordPolicy('abc', { minLength: 12 }).length).toBeGreaterThanOrEqual(4);
    expect(checkPasswordPolicy('Marie-Dupont1!x', { minLength: 12 }, ['marie'])).toContain('ne pas contenir votre identifiant ou votre nom');
  });
});

describe('jwt', () => {
  const jwt = new JwtService('s'.repeat(40));
  it('accepte uniquement les objets autorisés', () => {
    const t = jwt.sign({ sub: 'u1', purpose: 'mfa', mfa: false }, 60);
    expect(jwt.verify(t, ['mfa']).sub).toBe('u1');
    expect(() => jwt.verify(t, ['access'])).toThrow(AppError);
  });
  it('refuse un jeton expiré ou signé par un autre secret', () => {
    expect(() => jwt.verify(jwt.sign({ sub: 'u', purpose: 'access', mfa: true }, -10), ['access'])).toThrow();
    const other = new JwtService('z'.repeat(40)).sign({ sub: 'u', purpose: 'access', mfa: true }, 60);
    expect(() => jwt.verify(other, ['access'])).toThrow();
  });
});

describe('chaîne d\'audit', () => {
  const build = (n: number) => {
    const rows: { input: ReturnType<typeof normalizeEntry>; prevHash: string | null; hash: string }[] = [];
    let prev: string | null = null;
    for (let i = 0; i < n; i++) {
      const input = normalizeEntry({ action: `A${i}`, resource: 'r', result: 'SUCCESS' }, new Date(1_700_000_000_000 + i));
      const hash = computeAuditHash(prev, input);
      rows.push({ input, prevHash: prev, hash });
      prev = hash;
    }
    return rows;
  };
  it('valide une chaîne intacte', () => expect(verifyAuditChain(build(5))).toBe(-1));
  it('détecte une ligne modifiée ou supprimée', () => {
    const rows = build(5);
    rows[2]!.input.action = 'FALSIFIE';
    expect(verifyAuditChain(rows)).toBe(2);
    const cut = build(5);
    cut.splice(1, 1);
    expect(verifyAuditChain(cut)).toBe(1);
  });
  it('le writer mémoire conserve les entrées', async () => {
    const w = new MemoryAuditWriter();
    await w.write({ action: 'X', resource: 'r', result: 'DENIED' });
    expect(w.rows).toHaveLength(1);
  });
});

describe('cache mémoire', () => {
  it('get/set/del, préfixe et compteur', async () => {
    const c = new MemoryCache();
    await c.set('p:a', 1);
    await c.set('p:b', 2);
    await c.set('q', 3);
    await c.delByPrefix('p:');
    expect(await c.get('p:a')).toBeUndefined();
    expect(await c.get('q')).toBe(3);
    expect(await c.incr('n', 60)).toBe(1);
    expect(await c.incr('n', 60)).toBe(2);
  });
  it('expire les valeurs', async () => {
    jest.useFakeTimers();
    const c = new MemoryCache();
    await c.set('k', 1, 1);
    jest.advanceTimersByTime(1500);
    expect(await c.get('k')).toBeUndefined();
    jest.useRealTimers();
  });
});

describe('erreurs', () => {
  it('produit un problème RFC 9457', () => {
    const p = new TooManyRequestsError(30).toProblem('/x', 'cid');
    expect(p).toMatchObject({ status: 429, instance: '/x', correlationId: 'cid' });
  });
});

describe('outbox', () => {
  const logger = createLogger('silent');
  it('livre l\'événement puis le marque publié', async () => {
    const store = new InMemoryOutboxStore();
    const bus = new EventBus(store);
    const seen: string[] = [];
    bus.subscribe('x.done', (e) => void seen.push(e.eventId));
    const ev = await bus.publish({ type: 'x.done', data: {} });
    // l'ajout dans le magasin est celui du publisher
    const relay = new OutboxRelay(store, bus, logger);
    expect(await relay.tick()).toBe(1);
    expect(seen).toEqual([ev.eventId]);
    expect(await relay.tick()).toBe(0);
  });
  it('réessaie avec temporisation puis abandonne', async () => {
    const store = new InMemoryOutboxStore();
    const bus = new EventBus(store);
    bus.subscribe('x.fail', () => {
      throw new Error('boom');
    });
    const ev = await bus.publish({ type: 'x.fail', data: {} });
    const relay = new OutboxRelay(store, bus, logger, { maxAttempts: 2, baseDelayMs: 1 });
    await relay.tick(new Date());
    expect(store.rows.get(ev.eventId)?.status).toBe('PENDING');
    await relay.tick(new Date(Date.now() + 60_000));
    expect(store.rows.get(ev.eventId)?.status).toBe('FAILED');
  });
});
