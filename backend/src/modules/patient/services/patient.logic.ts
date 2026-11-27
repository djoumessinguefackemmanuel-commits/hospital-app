import { createHmac } from 'node:crypto';
import { BusinessRuleError } from '../../../core/errors/app-error';
import type { DuplicateCandidate, PatientRecord } from '../models/patient.model';

/** Minuscules, sans accents ni ponctuation superflue : base de la recherche et des comparaisons. */
export function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function bigrams(s: string): Map<string, number> {
  const padded = ` ${s} `;
  const m = new Map<string, number>();
  for (let i = 0; i < padded.length - 1; i++) {
    const g = padded.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** Coefficient de Dice sur les bigrammes : 1 = identique, 0 = rien en commun. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const A = bigrams(a);
  const B = bigrams(b);
  let common = 0;
  for (const [g, n] of A) common += Math.min(n, B.get(g) ?? 0);
  const total = [...A.values()].reduce((x, y) => x + y, 0) + [...B.values()].reduce((x, y) => x + y, 0);
  return (2 * common) / total;
}

/** Empreinte HMAC de l'identifiant national : permet la recherche exacte sans le stocker en clair. */
export function nationalIdHash(key: string, nationalId: string): string {
  return createHmac('sha256', Buffer.from(key, 'base64')).update(nationalId.replace(/\s+/g, '').toUpperCase()).digest('hex');
}

export function maskNationalId(value: string): string {
  return value.length <= 3 ? '***' : `${'*'.repeat(value.length - 3)}${value.slice(-3)}`;
}

export function scoreCandidate(
  input: { lastNameNorm: string; firstNameNorm: string; nationalIdHash?: string },
  c: Pick<PatientRecord, 'lastNameNorm' | 'firstNameNorm' | 'nationalIdHash'>,
): number {
  if (input.nationalIdHash && c.nationalIdHash === input.nationalIdHash) return 1;
  const last = similarity(input.lastNameNorm, c.lastNameNorm);
  const first = similarity(input.firstNameNorm, c.firstNameNorm);
  // Prénom et nom inversés par erreur de saisie : on garde le meilleur des deux ordres.
  const swapped = (similarity(input.lastNameNorm, c.firstNameNorm) + similarity(input.firstNameNorm, c.lastNameNorm)) / 2;
  return Math.round(Math.max((last + first) / 2, swapped) * 100) / 100;
}

export function toCandidate(c: PatientRecord, score: number): DuplicateCandidate {
  return { id: c.id, mrn: c.mrn, lastName: c.lastName, firstName: c.firstName, birthDate: c.birthDate.toISOString().slice(0, 10), score };
}

/** Applique le format paramétré : {SITE}, {YYYY}, {SEQ:n}. Le compteur doit apparaître. */
export function formatMrn(format: string, site: string, year: number, seq: number): string {
  if (!/\{SEQ:\d{1,2}\}/.test(format)) throw new BusinessRuleError('Le format de numéro de dossier doit contenir {SEQ:n}', 'invalid_mrn_format');
  return format
    .replace(/\{SITE\}/g, site)
    .replace(/\{YYYY\}/g, String(year))
    .replace(/\{SEQ:(\d{1,2})\}/g, (_m, n: string) => String(seq).padStart(Number(n), '0'));
}
