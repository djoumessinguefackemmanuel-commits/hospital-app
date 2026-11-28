import type { Channel, OutgoingMessage } from '../models/notification.model';

const SIGNATURE = 'Cordialement, l\'équipe de l\'hôpital.';

function when(startsAtIso: string, tz: string): string {
  const d = new Date(startsAtIso);
  const day = new Intl.DateTimeFormat('fr-FR', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d);
  const time = new Intl.DateTimeFormat('fr-FR', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(d);
  return `le ${day} à ${time}`;
}

/** Messages volontairement génériques : aucune donnée médicale ne transite par e-mail ou SMS. */
export function renderTemplate(template: string, channel: Channel, payload: Record<string, unknown>, tz: string): Omit<OutgoingMessage, 'to'> {
  const startsAt = String(payload['startsAt'] ?? '');
  const date = startsAt ? when(startsAt, tz) : 'à la date convenue';
  const text: Record<string, { subject: string; body: string }> = {
    'rdv.confirmation': { subject: 'Confirmation de votre rendez-vous', body: `Votre rendez-vous est confirmé ${date}.` },
    'rdv.reminder': { subject: 'Rappel de votre rendez-vous', body: `Rappel : vous avez rendez-vous ${date}.` },
    'rdv.cancelled': { subject: 'Annulation de votre rendez-vous', body: `Votre rendez-vous prévu ${date} a été annulé. Contactez-nous pour en fixer un nouveau.` },
  };
  const t = text[template];
  if (!t) throw new Error(`Modèle inconnu : ${template}`);
  return channel === 'EMAIL' ? { subject: t.subject, body: `${t.body}\n\n${SIGNATURE}` } : { body: t.body };
}
