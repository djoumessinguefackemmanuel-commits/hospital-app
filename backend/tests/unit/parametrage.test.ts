import { PARAMETRE_CATALOG } from '../../src/modules/parametrage/catalog';
import type { ParametreDefinition } from '../../src/modules/parametrage/models/parametre.model';
import { assertValidValue } from '../../src/modules/parametrage/validators/value.validator';

const defs = new Map(PARAMETRE_CATALOG.map((d) => [d.code, { id: d.code, ...d } as ParametreDefinition]));
const d = (code: string) => defs.get(code)!;

describe('catalogue de paramètres', () => {
  it('les codes sont uniques et les valeurs par défaut respectent leur propre validation', () => {
    expect(new Set(PARAMETRE_CATALOG.map((x) => x.code)).size).toBe(PARAMETRE_CATALOG.length);
    for (const def of PARAMETRE_CATALOG) expect(() => assertValidValue(d(def.code), def.defaultValue)).not.toThrow();
  });
  it('les paramètres critiques sont ceux attendus', () => {
    const critical = PARAMETRE_CATALOG.filter((x) => x.critical).map((x) => x.code);
    expect(critical).toEqual(expect.arrayContaining(['security.mfa.required_roles', 'security.sod.rules', 'audit.retention_years']));
  });
});

describe('validation des valeurs', () => {
  it.each([
    ['security.login.max_attempts', 2],
    ['security.login.max_attempts', 11],
    ['security.login.max_attempts', 'cinq'],
    ['security.login.max_attempts', 5.5],
    ['l10n.date_format', 'AAAA'],
    ['l10n.currency.base', 'euro'],
    ['security.mfa.methods', []],
    ['security.mfa.methods', ['pigeon']],
    ['backup.schedule', 'tous les jours'],
    ['patient.merge.requires_approval', 'oui'],
    ['patient.duplicate.threshold', 0.1],
    ['appointment.reminder_offsets_h', [1.5]],
  ])('refuse %s = %j', (code, value) => {
    expect(() => assertValidValue(d(code), value)).toThrow();
  });
  it.each([
    ['security.login.max_attempts', 7],
    ['l10n.date_format', 'YYYY-MM-DD'],
    ['security.mfa.methods', ['totp', 'sms']],
    ['backup.schedule', '30 3 * * 1'],
    ['notif.quiet_hours', { start: '22:00', end: '06:00' }],
  ])('accepte %s = %j', (code, value) => {
    expect(() => assertValidValue(d(code), value)).not.toThrow();
  });
  it('refuse les paramètres de type SECRET', () => {
    expect(() => assertValidValue({ ...d('backup.schedule'), type: 'SECRET' }, 'x')).toThrow(/coffre/);
  });
});
