import { describe, expect, it } from 'vitest';
import { expandDates, isOccurrence, recurrenceSchema, describeRecurrence } from '../src/lib/recurrence.js';

const rule = (r: unknown) => recurrenceSchema.parse(r);

describe('expandDates', () => {
  it('diária', () => {
    expect(expandDates('2026-11-09', rule({ freq: 'daily' }), '2026-11-08', '2026-11-12')).toEqual([
      '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12',
    ]);
  });

  it('a cada 3 dias, começando longe do intervalo', () => {
    expect(expandDates('2026-01-01', rule({ freq: 'daily', interval: 3 }), '2026-01-30', '2026-02-06')).toEqual([
      '2026-01-31', '2026-02-03', '2026-02-06',
    ]);
  });

  it('semanal no mesmo dia da semana', () => {
    // 2026-11-09 é segunda-feira
    expect(expandDates('2026-11-09', rule({ freq: 'weekly' }), '2026-11-01', '2026-11-30')).toEqual([
      '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30',
    ]);
  });

  it('dias específicos da semana (seg, qua, sex)', () => {
    expect(expandDates('2026-11-11', rule({ freq: 'weekly', byWeekday: [5, 1, 3] }), '2026-11-09', '2026-11-22')).toEqual([
      '2026-11-11', '2026-11-13', '2026-11-16', '2026-11-18', '2026-11-20',
    ]);
  });

  it('a cada 2 semanas', () => {
    expect(expandDates('2026-11-09', rule({ freq: 'weekly', interval: 2 }), '2026-11-01', '2026-12-31')).toEqual([
      '2026-11-09', '2026-11-23', '2026-12-07', '2026-12-21',
    ]);
  });

  it('a cada 2 semanas, intervalo distante do início', () => {
    const r = rule({ freq: 'weekly', interval: 2, byWeekday: [2, 4] });
    const all = expandDates('2026-01-06', r, '2026-01-01', '2026-12-31');
    const window = expandDates('2026-01-06', r, '2026-10-01', '2026-10-31');
    expect(window).toEqual(all.filter((d) => d >= '2026-10-01' && d <= '2026-10-31'));
    expect(window.length).toBeGreaterThan(0);
  });

  it('mensal ajusta para o último dia do mês', () => {
    expect(expandDates('2026-01-31', rule({ freq: 'monthly' }), '2026-01-01', '2026-05-31')).toEqual([
      '2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31',
    ]);
  });

  it('anual (29/02)', () => {
    expect(expandDates('2024-02-29', rule({ freq: 'yearly' }), '2024-01-01', '2028-12-31')).toEqual([
      '2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29',
    ]);
  });

  it('respeita until e count', () => {
    expect(expandDates('2026-11-09', rule({ freq: 'daily', until: '2026-11-11' }), '2026-11-01', '2026-11-30')).toHaveLength(3);
    expect(expandDates('2026-11-09', rule({ freq: 'daily', count: 5 }), '2026-11-12', '2026-11-30')).toEqual(['2026-11-12', '2026-11-13']);
    expect(expandDates('2026-11-09', rule({ freq: 'weekly', byWeekday: [1, 2], count: 3 }), '2026-11-01', '2026-12-31')).toEqual([
      '2026-11-09', '2026-11-10', '2026-11-16',
    ]);
  });

  it('isOccurrence', () => {
    const r = rule({ freq: 'weekly', byWeekday: [1, 3] });
    expect(isOccurrence('2026-11-09', r, '2026-11-11')).toBe(true);
    expect(isOccurrence('2026-11-09', r, '2026-11-12')).toBe(false);
    expect(isOccurrence('2026-11-09', r, '2026-11-02')).toBe(false);
  });

  it('descrição em português', () => {
    expect(describeRecurrence(rule({ freq: 'weekly', byWeekday: [1, 3] }))).toBe('Toda semana (seg, qua)');
    expect(describeRecurrence(null)).toBe('Não se repete');
  });
});
