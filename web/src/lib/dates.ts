// Datas são tratadas como strings "AAAA-MM-DD" (sem fuso), igual ao servidor.
const pad = (n: number) => String(n).padStart(2, '0');

export function parse(d: string) {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}
export function fmt(dt: Date) {
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}
export function addDays(d: string, n: number) {
  const dt = parse(d);
  dt.setUTCDate(dt.getUTCDate() + n);
  return fmt(dt);
}
export function addMonths(d: string, n: number) {
  const dt = parse(d);
  const day = dt.getUTCDate();
  dt.setUTCDate(1);
  dt.setUTCMonth(dt.getUTCMonth() + n);
  const last = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
  dt.setUTCDate(Math.min(day, last));
  return fmt(dt);
}
/** ISO: 1 = segunda … 7 = domingo */
export function isoWeekday(d: string) {
  const w = parse(d).getUTCDay();
  return w === 0 ? 7 : w;
}
export function startOfWeek(d: string) {
  return addDays(d, 1 - isoWeekday(d));
}
export function startOfMonth(d: string) {
  return `${d.slice(0, 7)}-01`;
}
export function endOfMonth(d: string) {
  const dt = parse(d);
  return fmt(new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)));
}
export function monthGrid(d: string) {
  const start = startOfWeek(startOfMonth(d));
  const end = addDays(startOfWeek(endOfMonth(d)), 6);
  const days: string[] = [];
  for (let c = start; c <= end; c = addDays(c, 1)) days.push(c);
  return days;
}
export function todayIn(tz: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return parts; // en-CA => AAAA-MM-DD
}
export function nowTimeIn(tz: string) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
}
export function hourIn(tz: string) {
  return Number(nowTimeIn(tz).slice(0, 2));
}

const WEEKDAYS_LONG = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const WEEKDAYS_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export const weekdayLong = (d: string) => WEEKDAYS_LONG[parse(d).getUTCDay()];
export const weekdayShort = (d: string) => WEEKDAYS_SHORT[parse(d).getUTCDay()];
export const dayNum = (d: string) => Number(d.slice(8, 10));
export const monthName = (d: string) => MONTHS[Number(d.slice(5, 7)) - 1];
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function longDate(d: string) {
  return `${cap(weekdayLong(d))}, ${dayNum(d)} de ${monthName(d)}`;
}
export function monthTitle(d: string) {
  return `${cap(monthName(d))} de ${d.slice(0, 4)}`;
}
export function relativeDay(d: string, today: string) {
  if (d === today) return 'Hoje';
  if (d === addDays(today, 1)) return 'Amanhã';
  if (d === addDays(today, -1)) return 'Ontem';
  return `${cap(weekdayShort(d))}, ${dayNum(d)}/${d.slice(5, 7)}`;
}
export function weekTitle(start: string) {
  const end = addDays(start, 6);
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  return sameMonth
    ? `${dayNum(start)} – ${dayNum(end)} de ${monthName(end)}`
    : `${dayNum(start)} ${monthName(start).slice(0, 3)} – ${dayNum(end)} ${monthName(end).slice(0, 3)}`;
}
export function greeting(hour: number) {
  return hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
}
export function reminderLabel(min: number) {
  if (min === 0) return 'Na hora';
  if (min < 60) return `${min} min antes`;
  if (min % 1440 === 0) return min === 1440 ? '1 dia antes' : `${min / 1440} dias antes`;
  if (min % 60 === 0) return min === 60 ? '1 hora antes' : `${min / 60} horas antes`;
  return `${min} min antes`;
}
export function describeRecurrence(r: { freq: string; interval: number; byWeekday?: number[]; until: string | null; count: number | null } | null) {
  if (!r) return 'Não se repete';
  const names = ['', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];
  const n = r.interval;
  let s = '';
  if (r.freq === 'daily') s = n === 1 ? 'Todos os dias' : `A cada ${n} dias`;
  else if (r.freq === 'weekly') {
    s = n === 1 ? 'Toda semana' : `A cada ${n} semanas`;
    if (r.byWeekday?.length) s += ` (${r.byWeekday.map((x) => names[x]).join(', ')})`;
  } else if (r.freq === 'monthly') s = n === 1 ? 'Todo mês' : `A cada ${n} meses`;
  else s = n === 1 ? 'Todo ano' : `A cada ${n} anos`;
  if (r.until) s += `, até ${r.until.split('-').reverse().join('/')}`;
  if (r.count) s += `, ${r.count} vezes`;
  return s;
}
export function timeRange(o: { startTime: string | null; endTime: string | null }) {
  if (!o.startTime) return 'Durante o dia';
  return o.endTime ? `${o.startTime} – ${o.endTime}` : o.startTime;
}
export const PRIORITY_LABEL = { low: 'Baixa', medium: 'Média', high: 'Alta', urgent: 'Urgente' } as const;
export const STATUS_LABEL = { pending: 'Pendente', in_progress: 'Em andamento', done: 'Concluída' } as const;
