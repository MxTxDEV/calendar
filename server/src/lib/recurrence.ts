import { DateTime } from 'luxon';
import { z } from 'zod';

/**
 * Regra de recorrência (subconjunto simples e previsível do RRULE).
 * - daily:   a cada `interval` dias
 * - weekly:  a cada `interval` semanas, nos dias `byWeekday` (ISO 1=segunda … 7=domingo)
 * - monthly: a cada `interval` meses, no mesmo dia do mês (ajustado ao último dia quando o mês é mais curto)
 * - yearly:  a cada `interval` anos, na mesma data
 * Termina em `until` (inclusive), após `count` ocorrências, ou nunca.
 */
export const recurrenceSchema = z
  .object({
    freq: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
    interval: z.number().int().min(1).max(365).default(1),
    byWeekday: z.array(z.number().int().min(1).max(7)).max(7).optional(),
    until: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    count: z.number().int().min(1).max(1000).nullable().optional(),
  })
  .transform((r) => ({
    ...r,
    byWeekday: r.freq === 'weekly' && r.byWeekday?.length ? [...new Set(r.byWeekday)].sort() : undefined,
    until: r.until ?? null,
    count: r.count ?? null,
  }));

export type Recurrence = z.infer<typeof recurrenceSchema>;

const MAX_ITER = 20000;

function d(iso: string) {
  return DateTime.fromISO(iso, { zone: 'utc' });
}
function iso(dt: DateTime) {
  return dt.toISODate()!;
}

function monthlyDate(start: DateTime, monthsAhead: number) {
  const target = start.startOf('month').plus({ months: monthsAhead });
  const day = Math.min(start.day, target.daysInMonth!);
  return target.set({ day });
}

/**
 * Gera as datas (YYYY-MM-DD) das ocorrências entre `from` e `to` (inclusive).
 */
export function expandDates(startDate: string, rule: Recurrence, from: string, to: string): string[] {
  const start = d(startDate);
  let lo = d(from);
  const hi = d(to);
  const until = rule.until ? d(rule.until) : null;
  const end = until && until < hi ? until : hi;
  if (lo < start) lo = start;
  if (end < lo) return [];

  const out: string[] = [];
  const counting = rule.count != null;
  let produced = 0; // número de ocorrências desde o início (para `count`)
  const interval = rule.interval || 1;

  const push = (dt: DateTime) => {
    produced++;
    if (counting && produced > rule.count!) return false;
    if (dt >= lo && dt <= end) out.push(iso(dt));
    return true;
  };

  if (rule.freq === 'daily') {
    // pula direto para perto de `lo` quando não há contagem
    let k = counting ? 0 : Math.max(0, Math.floor(lo.diff(start, 'days').days / interval));
    for (let i = 0; i < MAX_ITER; i++, k++) {
      const dt = start.plus({ days: k * interval });
      if (dt > end) break;
      if (!push(dt)) break;
    }
  } else if (rule.freq === 'weekly') {
    const days = rule.byWeekday?.length ? rule.byWeekday : [start.weekday];
    const week0 = start.startOf('week'); // segunda-feira (ISO)
    let w = counting ? 0 : Math.max(0, Math.floor(lo.startOf('week').diff(week0, 'weeks').weeks / interval) - 1);
    outer: for (let i = 0; i < MAX_ITER; i++, w++) {
      const weekStart = week0.plus({ weeks: w * interval });
      if (weekStart > end) break;
      for (const wd of days) {
        const dt = weekStart.plus({ days: wd - 1 });
        if (dt < start) continue;
        if (dt > end) break outer;
        if (!push(dt)) break outer;
      }
    }
  } else {
    const stepMonths = rule.freq === 'monthly' ? interval : interval * 12;
    let k = 0;
    if (!counting) {
      const monthsDiff = (lo.year - start.year) * 12 + (lo.month - start.month);
      k = Math.max(0, Math.floor(monthsDiff / stepMonths) - 1);
    }
    for (let i = 0; i < MAX_ITER; i++, k++) {
      const dt = monthlyDate(start, k * stepMonths);
      if (dt > end) break;
      if (!push(dt)) break;
    }
  }
  return out;
}

/** Verifica se `date` é uma ocorrência válida da regra. */
export function isOccurrence(startDate: string, rule: Recurrence, date: string) {
  return expandDates(startDate, rule, date, date).length === 1;
}

/** Descrição curta em português da regra. */
export function describeRecurrence(rule: Recurrence | null): string {
  if (!rule) return 'Não se repete';
  const names = ['', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];
  const n = rule.interval;
  let s: string;
  switch (rule.freq) {
    case 'daily':
      s = n === 1 ? 'Todos os dias' : `A cada ${n} dias`;
      break;
    case 'weekly': {
      const wd = rule.byWeekday?.map((x) => names[x]).join(', ');
      s = n === 1 ? 'Toda semana' : `A cada ${n} semanas`;
      if (wd) s += ` (${wd})`;
      break;
    }
    case 'monthly':
      s = n === 1 ? 'Todo mês' : `A cada ${n} meses`;
      break;
    default:
      s = n === 1 ? 'Todo ano' : `A cada ${n} anos`;
  }
  if (rule.until) s += `, até ${rule.until.split('-').reverse().join('/')}`;
  if (rule.count) s += `, ${rule.count} vezes`;
  return s;
}
