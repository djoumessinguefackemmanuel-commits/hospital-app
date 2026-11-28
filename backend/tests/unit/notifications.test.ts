import { createLogger } from '../../src/core/logger/logger';
import type { NotificationRecord, NotificationSender } from '../../src/modules/notifications/models/notification.model';
import type { NotificationRepository } from '../../src/modules/notifications/repositories/notification.repository';
import { LogSender, maskRecipient } from '../../src/modules/notifications/services/log.sender';
import { NotificationService } from '../../src/modules/notifications/services/notification.service';
import { renderTemplate } from '../../src/modules/notifications/services/templates';
import { quietHoursEnd } from '../../src/modules/notifications/services/time';

describe('plage de silence', () => {
  const range = { start: '21:00', end: '07:00' };
  it('hors plage → null ; dans la plage → fin de plage (franchissant minuit)', () => {
    expect(quietHoursEnd(new Date('2026-06-01T10:00:00Z'), range, 'UTC')).toBeNull();
    expect(quietHoursEnd(new Date('2026-06-01T22:30:00Z'), range, 'UTC')?.toISOString()).toBe('2026-06-02T07:00:00.000Z');
    expect(quietHoursEnd(new Date('2026-06-02T03:00:00Z'), range, 'UTC')?.toISOString()).toBe('2026-06-02T07:00:00.000Z');
  });
  it('respecte le fuseau (Paris, heure d\'été) et une plage dans la même journée', () => {
    expect(quietHoursEnd(new Date('2026-06-01T20:00:00Z'), range, 'Europe/Paris')?.toISOString()).toBe('2026-06-02T05:00:00.000Z'); // 22h locales
    expect(quietHoursEnd(new Date('2026-06-01T13:00:00Z'), { start: '12:00', end: '14:00' }, 'UTC')?.toISOString()).toBe('2026-06-01T14:00:00.000Z');
    expect(quietHoursEnd(new Date('2026-06-01T13:00:00Z'), { start: '08:00', end: '08:00' }, 'UTC')).toBeNull();
  });
});

describe('modèles et masquage', () => {
  it('rend un message générique sans donnée médicale, objet seulement pour l\'e-mail', () => {
    const mail = renderTemplate('rdv.reminder', 'EMAIL', { startsAt: '2026-06-02T07:00:00Z' }, 'Europe/Paris');
    expect(mail.subject).toBeDefined();
    expect(mail.body).toContain('09:00');
    expect(renderTemplate('rdv.cancelled', 'SMS', { startsAt: '2026-06-02T07:00:00Z' }, 'UTC').subject).toBeUndefined();
    expect(() => renderTemplate('inconnu', 'SMS', {}, 'UTC')).toThrow();
  });
  it('masque les destinataires', () => {
    expect(maskRecipient('marie.dupont@mail.fr')).toBe('m***@mail.fr');
    expect(maskRecipient('+33612345678')).toBe('*********678');
  });
});

const NOW = new Date('2026-06-01T10:00:00Z');
const values: Record<string, unknown> = {
  'notif.channels.enabled': ['email', 'sms'], 'notif.quiet_hours': { start: '21:00', end: '07:00' }, 'notif.retry.max': 2, 'l10n.timezone': 'UTC',
};

function record(over: Partial<NotificationRecord> = {}): NotificationRecord {
  return {
    id: 'n1', etablissementId: 'e1', patientId: 'p1', channel: 'EMAIL', template: 'rdv.reminder', subjectType: 'APPOINTMENT', subjectId: 'a1', payload: { startsAt: '2026-06-03T09:00:00Z' },
    dedupeKey: 'k', scheduledFor: NOW, status: 'PENDING', attempts: 1, lastError: null, sentAt: null, ...over,
  };
}

function setup(due: NotificationRecord[] = [], contact: { email?: string; phone?: string } | null = { email: 'a@b.fr', phone: '+33600000000' }, now = NOW) {
  const repo = {
    createMany: jest.fn(async (items: unknown[]) => items.length),
    cancelBySubject: jest.fn(async () => 2),
    claimDue: jest.fn(async () => due),
    markSent: jest.fn(async () => undefined), markSkipped: jest.fn(async () => undefined), markFailed: jest.fn(async () => undefined), reschedule: jest.fn(async () => undefined),
    findById: jest.fn(async (id: string) => (id === 'n1' ? record({ status: 'FAILED' }) : null)), requeue: jest.fn(async () => true), list: jest.fn(async () => []),
  };
  const send = jest.fn(async (_m: { to: string; body: string }) => undefined);
  const senders: NotificationSender[] = [{ channel: 'EMAIL', send }, { channel: 'SMS', send }];
  const settings = { get: jest.fn(async (c: string) => values[c]) };
  const contacts = { getContact: jest.fn(async () => contact) };
  const svc = new NotificationService(repo as unknown as NotificationRepository, settings as never, contacts, senders, createLogger('silent'), () => now);
  return { svc, repo, send, contacts };
}

const created = { eventId: 'x', type: 'rdv.created', occurredAt: '', etablissementId: 'e1', data: { appointmentId: 'a1', patientId: 'p1', startsAt: '2026-06-03T09:00:00Z', reminderOffsetsH: [48, 2, 100] } };

describe('NotificationService — planification', () => {
  it('rdv.created : confirmation + rappels futurs par canal, rappels déjà passés ignorés', async () => {
    const { svc, repo } = setup();
    await svc.onRdvCreated(created);
    const items = repo.createMany.mock.calls[0]![0] as { template: string; dedupeKey: string; channel: string }[];
    // 48 h avant le 3/06 9h = 1/06 9h (passé à 10h) ; 100 h déjà passé ; seul 2 h reste → 2 canaux × (1 confirmation + 1 rappel)
    expect(items.map((i) => i.dedupeKey).sort()).toEqual(['rdv:a1:confirm:EMAIL', 'rdv:a1:confirm:SMS', 'rdv:a1:h2:EMAIL', 'rdv:a1:h2:SMS']);
  });
  it('rdv.cancelled : annule les envois en attente puis prévient le patient', async () => {
    const { svc, repo } = setup();
    await svc.onRdvCancelled({ ...created, type: 'rdv.cancelled', data: { appointmentId: 'a1', patientId: 'p1', startsAt: created.data.startsAt } });
    expect(repo.cancelBySubject).toHaveBeenCalledWith('APPOINTMENT', 'a1', NOW);
    expect((repo.createMany.mock.calls[0]![0] as { template: string }[]).every((i) => i.template === 'rdv.cancelled')).toBe(true);
  });
  it('ignore un événement sans établissement et respecte les canaux désactivés', async () => {
    const { svc, repo } = setup();
    await svc.onRdvCreated({ ...created, etablissementId: undefined });
    expect(repo.createMany).not.toHaveBeenCalled();
    values['notif.channels.enabled'] = ['sms'];
    await svc.onRdvCreated(created);
    values['notif.channels.enabled'] = ['email', 'sms'];
    expect((repo.createMany.mock.calls[0]![0] as { channel: string }[]).every((i) => i.channel === 'SMS')).toBe(true);
  });
});

describe('NotificationService — envoi', () => {
  it('envoie à l\'adresse du bon canal puis marque envoyé', async () => {
    const { svc, repo, send } = setup([record(), record({ id: 'n2', channel: 'SMS' })]);
    expect(await svc.dispatchDue()).toBe(2);
    expect(send.mock.calls.map((c) => c[0].to)).toEqual(['a@b.fr', '+33600000000']);
    expect(repo.markSent).toHaveBeenCalledTimes(2);
  });
  it('plage de silence : replanifie à la fin de plage sans consommer de tentative', async () => {
    const { svc, repo, send } = setup([record()], undefined, new Date('2026-06-01T22:00:00Z'));
    await svc.dispatchDue();
    expect(send).not.toHaveBeenCalled();
    expect(repo.reschedule).toHaveBeenCalledWith('n1', new Date('2026-06-02T07:00:00Z'), undefined, true);
  });
  it('sans contact pour le canal : ignorée', async () => {
    const { svc, repo } = setup([record()], { phone: '+33600000000' });
    await svc.dispatchDue();
    expect(repo.markSkipped).toHaveBeenCalledWith('n1', expect.any(String));
  });
  it('échec d\'envoi : réessai temporisé, puis échec définitif au-delà du maximum', async () => {
    const retry = setup([record({ attempts: 1 })]);
    retry.send.mockRejectedValue(new Error('SMTP 500'));
    await retry.svc.dispatchDue();
    expect(retry.repo.reschedule).toHaveBeenCalledWith('n1', new Date(NOW.getTime() + 5 * 60_000), 'SMTP 500', false);
    const last = setup([record({ attempts: 3 })]);
    last.send.mockRejectedValue(new Error('SMTP 500'));
    await last.svc.dispatchDue();
    expect(last.repo.markFailed).toHaveBeenCalledWith('n1', 'SMTP 500');
  });
  it('sans fournisseur pour le canal : échec explicite', async () => {
    const { svc, repo } = setup([record()]);
    (svc as unknown as { senders: Map<string, unknown> }).senders.clear();
    await svc.dispatchDue();
    expect(repo.markFailed).toHaveBeenCalled();
  });
  it('relance seulement une notification en échec de son établissement', async () => {
    const { svc, repo } = setup();
    const actor = { userId: 'u', etablissementId: 'e1', permissions: [] };
    await expect(svc.retry('n1', actor)).resolves.toBeUndefined();
    await expect(svc.retry('absent', actor)).rejects.toMatchObject({ status: 404 });
    repo.requeue.mockResolvedValue(false);
    await expect(svc.retry('n1', actor)).rejects.toMatchObject({ status: 409 });
    await expect(svc.retry('n1', { ...actor, etablissementId: 'autre' })).rejects.toMatchObject({ status: 404 });
  });
  it('le canal journal n\'émet rien', async () => {
    await expect(new LogSender('SMS', createLogger('silent')).send({ to: '+33600000000', body: 'x' })).resolves.toBeUndefined();
  });
});
