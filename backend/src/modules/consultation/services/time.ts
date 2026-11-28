/** Décalage (ms) entre UTC et l'heure locale du fuseau `tz` à l'instant `utcMs`. */
function offsetMs(utcMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** Convertit une date/heure locale (jour `YYYY-MM-DD`, minutes depuis minuit) du fuseau `tz` en instant UTC. */
export function zonedToUtc(day: string, minutes: number, tz: string): Date {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d, 0, minutes);
  const first = guess - offsetMs(guess, tz);
  return new Date(guess - offsetMs(first, tz)); // second passage : gère le changement d'heure
}

/** Jour ISO de la semaine (1 = lundi … 7 = dimanche) d'une date `YYYY-MM-DD`. */
export function isoWeekday(day: string): number {
  const d = new Date(`${day}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function parseHm(value: string): number {
  const [h, m] = value.split(':').map(Number) as [number, number];
  return h * 60 + m;
}
