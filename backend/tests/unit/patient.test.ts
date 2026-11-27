import { randomBytes } from 'node:crypto';
import { NoopUnitOfWork } from '../../src/core/database/prisma';
import type { PatientRecord } from '../../src/modules/patient/models/patient.model';
import type { PatientRepository } from '../../src/modules/patient/repositories/patient.repository';
import { formatMrn, maskNationalId, nationalIdHash, normalizeName, scoreCandidate, similarity } from '../../src/modules/patient/services/patient.logic';
import { PatientService } from '../../src/modules/patient/services/patient.service';

const KEY = randomBytes(32).toString('base64');

describe('logique patient', () => {
  it('normalise accents, casse et ponctuation', () => {
    expect(normalizeName("  Élodie-Marie D'Août ")).toBe('elodie marie d aout');
  });
  it('similarité : identique, proche, éloigné', () => {
    expect(similarity('dupont', 'dupont')).toBe(1);
    expect(similarity('dupont', 'dupond')).toBeGreaterThan(0.6);
    expect(similarity('dupont', 'martin')).toBeLessThan(0.3);
    expect(similarity('', 'a')).toBe(0);
  });
  it('score : l\'identifiant national identique vaut 1, les noms inversés sont détectés', () => {
    const base = { lastNameNorm: 'dupont', firstNameNorm: 'marie', nationalIdHash: 'h' };
    expect(scoreCandidate({ lastNameNorm: 'x', firstNameNorm: 'y', nationalIdHash: 'h' }, base)).toBe(1);
    expect(scoreCandidate({ lastNameNorm: 'marie', firstNameNorm: 'dupont' }, { ...base, nationalIdHash: null })).toBeGreaterThan(0.9);
  });
  it('empreinte stable, insensible aux espaces et à la casse', () => {
    expect(nationalIdHash(KEY, 'ab 123')).toBe(nationalIdHash(KEY, 'AB123'));
    expect(nationalIdHash(KEY, 'AB123')).not.toBe(nationalIdHash(randomBytes(32).toString('base64'), 'AB123'));
    expect(maskNationalId('1234567')).toBe('****567');
    expect(maskNationalId('12')).toBe('***');
  });
  it('formate le numéro de dossier et refuse un format sans compteur', () => {
    expect(formatMrn('{SITE}-{YYYY}-{SEQ:6}', 'PRINCIPAL', 2026, 42)).toBe('PRINCIPAL-2026-000042');
    expect(() => formatMrn('{SITE}', 'X', 2026, 1)).toThrow();
  });
});

function record(over: Partial<PatientRecord> = {}): PatientRecord {
  return {
    id: 'p1', etablissementId: 'e1', mrn: 'P-2026-000001', lastName: 'Dupont', firstName: 'Marie', lastNameNorm: 'dupont', firstNameNorm: 'marie',
    birthDate: new Date('1990-05-01'), sex: 'F', phone: null, email: null, address: null, nationalIdEnc: null, nationalIdHash: null,
    confidentiality: 'NORMAL', active: true, ...over,
  };
}

function setup(existing: PatientRecord[] = []) {
  const repo = {
    nextSequence: jest.fn(async () => 7),
    etablissementCode: jest.fn(async () => 'PRINCIPAL'),
    create: jest.fn(async (i) => record({ ...i, id: 'new' })),
    findById: jest.fn(async (id: string) => existing.find((p) => p.id === id) ?? null),
    update: jest.fn(async (id, patch) => record({ id, ...patch })),
    findDuplicateCandidates: jest.fn(async () => existing),
    search: jest.fn(async () => existing),
  };
  const events = { publish: jest.fn(async () => ({}) as never) };
  const settings = {
    get: jest.fn(async (code: string) => (code === 'patient.duplicate.threshold' ? 0.85 : '{SITE}-{YYYY}-{SEQ:6}')),
  };
  const svc = new PatientService(repo as unknown as PatientRepository, new NoopUnitOfWork(), events, settings as never, KEY, () => new Date('2026-06-01T00:00:00Z'));
  return { svc, repo, events };
}
const actor = (permissions: string[] = []) => ({ userId: 'u1', etablissementId: 'e1', permissions });
const input = { lastName: 'Dupond', firstName: 'Marie', birthDate: new Date('1990-05-01'), sex: 'F' as const, confidentiality: 'NORMAL' as const, confirmNotDuplicate: false };

describe('PatientService', () => {
  it('crée un dossier : numéro généré, identifiant national chiffré et masqué, événement publié', async () => {
    const { svc, repo, events } = setup();
    const v = await svc.create({ ...input, nationalId: 'AB123456' }, actor());
    expect(v.mrn).toBe('PRINCIPAL-2026-000007');
    expect(v.nationalIdMasked).toBe('*****456');
    const created = repo.create.mock.calls[0]![0] as { nationalIdEnc: string };
    expect(created.nationalIdEnc).not.toContain('AB123456');
    expect(events.publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'patient.created' }), undefined);
  });

  it('signale un doublon probable (409) sauf confirmation explicite', async () => {
    const { svc } = setup([record()]);
    await expect(svc.create(input, actor())).rejects.toMatchObject({ status: 409, code: 'possible_duplicate' });
    await expect(svc.create({ ...input, confirmNotDuplicate: true }, actor())).resolves.toBeDefined();
  });

  it('ne divulgue pas les homonymes restreints', async () => {
    const { svc } = setup([record({ confidentiality: 'RESTRICTED' })]);
    await expect(svc.create(input, actor())).rejects.toMatchObject({ extensions: { candidates: [], hiddenCandidates: 1 } });
  });

  it('refuse l\'accès à un dossier d\'un autre établissement ou restreint', async () => {
    const { svc } = setup([record({ id: 'other', etablissementId: 'e2' }), record({ id: 'vip', confidentiality: 'RESTRICTED' })]);
    await expect(svc.get('other', actor())).rejects.toMatchObject({ status: 404 });
    await expect(svc.get('vip', actor())).rejects.toMatchObject({ code: 'patient_restricted' });
    await expect(svc.get('vip', actor(['PATIENT_DOSSIER_READ_RESTRICTED']))).resolves.toMatchObject({ id: 'vip' });
  });

  it('création restreinte et changement de confidentialité exigent le droit dédié', async () => {
    const { svc } = setup([record()]);
    await expect(svc.create({ ...input, confidentiality: 'RESTRICTED', confirmNotDuplicate: true }, actor())).rejects.toMatchObject({ code: 'patient_restricted' });
    await expect(svc.update('p1', { confidentiality: 'RESTRICTED' }, actor())).rejects.toMatchObject({ code: 'patient_restricted' });
  });

  it('met à jour en recalculant les noms normalisés', async () => {
    const { svc, repo } = setup([record()]);
    await svc.update('p1', { lastName: 'Ébert' }, actor());
    expect(repo.update.mock.calls[0]![1]).toMatchObject({ lastName: 'Ébert', lastNameNorm: 'ebert' });
  });

  it('la recherche exclut les dossiers restreints sans le droit', async () => {
    const { svc, repo } = setup([record()]);
    await svc.search({ q: 'Dupont', limit: 20, offset: 0 }, actor());
    expect(repo.search).toHaveBeenCalledWith('e1', { text: 'dupont', birthDate: undefined }, false, 20, 0);
  });
});
