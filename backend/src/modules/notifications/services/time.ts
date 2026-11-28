function offsetMs(utcMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - Math.floor(utcMs / 1000) * 1000;
}

/** Instant UTC correspondant à `minutes` après minuit le jour local `day` (YYYY-MM-DD) du fuseau `tz`. */
export function zonedToUtc(day: string, minutes: number, tz: string): Date {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d, 0, minutes);
  const first = guess - offsetMs(guess, tz);
  return new Date(guess - offsetMs(first, tz));
}

export function localParts(at: Date, tz: string): { day: string; minutes: number } {
  const local = new Date(at.getTime() + offsetMs(at.getTime(), tz));
  return { day: local.toISOString().slice(0, 10), minutes: local.getUTCHours() * 60 + local.getUTCMinutes() };
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const toMinutes = (hm: string) => {
  const [h, m] = hm.split(':').map(Number) as [number, number];
  return h * 60 + m;
};

/** Si `at` tombe dans la plage de silence (peut franchir minuit), retourne la fin de plage ; sinon null. */
export function quietHoursEnd(at: Date, range: { start: string; end: string }, tz: string): Date | null {
  const s = toMinutes(range.start);
  const e = toMinutes(range.end);
  if (s === e) return null;
  const { day, minutes } = localParts(at, tz);
  const inside = s < e ? minutes >= s && minutes < e : minutes >= s || minutes < e;
  if (!inside) return null;
  const endDay = s < e || minutes < e ? day : addDays(day, 1);
  return zonedToUtc(endDay, e, tz);
}
