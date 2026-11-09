import { DateTime, IANAZone } from 'luxon';

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidTimezone(tz: string) {
  return IANAZone.isValidZone(tz);
}

export function nowIn(tz: string, now: Date = new Date()) {
  return DateTime.fromJSDate(now, { zone: tz });
}

/** "HH:MM:SS" | "HH:MM" -> "HH:MM" */
export function hhmm(t: string | null | undefined): string | null {
  return t ? t.slice(0, 5) : null;
}

/** Instante absoluto de uma data + horário locais no fuso informado. */
export function localInstant(date: string, time: string, tz: string) {
  return DateTime.fromISO(`${date}T${hhmm(time)}`, { zone: tz });
}

export function addDays(date: string, days: number) {
  return DateTime.fromISO(date, { zone: 'utc' }).plus({ days }).toISODate()!;
}

export function weekStart(date: string) {
  return DateTime.fromISO(date, { zone: 'utc' }).startOf('week').toISODate()!;
}

export function minutesOf(t: string) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

const WEEKDAYS = ['', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado', 'Domingo'];
export function weekdayName(date: string) {
  return WEEKDAYS[DateTime.fromISO(date, { zone: 'utc' }).weekday];
}
