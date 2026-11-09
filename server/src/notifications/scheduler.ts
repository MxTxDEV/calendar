import { DateTime } from 'luxon';
import { pool, query } from '../db/pool.js';
import { listOccurrences, listOverdue } from '../lib/occurrences.js';
import { addDays, localInstant, nowIn } from '../lib/time.js';
import { mapSettings, type Settings } from '../routes/settings.js';
import { dailySummary, reminderMessage, weeklySummary } from './messages.js';
import { pushEnabled, sendToUser, type SendResult } from './push.js';

/** Se o servidor ficar fora do ar, resumos ainda são enviados até 3h depois do horário configurado. */
const SUMMARY_CATCHUP_MINUTES = 180;
/** Lembretes atrasados mais de 10 minutos são descartados (melhor do que avisar tarde demais). */
const REMINDER_GRACE_MINUTES = 10;

interface UserRow {
  id: string;
  settings: Settings;
}

function inWindow(local: DateTime, date: string, time: string, tz: string, windowMinutes: number) {
  const target = localInstant(date, time, tz);
  const diff = local.diff(target, 'minutes').minutes;
  return diff >= 0 && diff < windowMinutes;
}

/** Semana (segunda a domingo) que o resumo semanal deve cobrir. */
export function summaryWeek(localDate: string, weeklyDay: number) {
  const dt = DateTime.fromISO(localDate, { zone: 'utc' });
  // sábado/domingo: o resumo apresenta a semana seguinte
  const base = weeklyDay >= 6 ? dt.plus({ weeks: 1 }) : dt;
  const monday = base.startOf('week');
  return Array.from({ length: 7 }, (_, i) => monday.plus({ days: i }).toISODate()!);
}

export async function sendDailySummary(user: UserRow, now: Date, opts: { force?: boolean; dedupeKey?: string } = {}): Promise<SendResult | null> {
  const s = user.settings;
  const local = nowIn(s.timezone, now);
  const today = local.toISODate()!;
  if (!opts.force && (!s.dailyEnabled || !inWindow(local, today, s.dailyTime, s.timezone, SUMMARY_CATCHUP_MINUTES))) return null;
  const occ = await listOccurrences(user.id, today, today, { withSubtasks: false });
  const overdue = (await listOverdue(user.id, s.timezone, now)).filter((o) => o.date < today);
  const msg = dailySummary(occ, overdue.length, local.hour);
  return sendToUser(user.id, opts.dedupeKey ?? `daily:${user.id}:${today}`, {
    kind: opts.force ? 'test' : 'daily',
    title: msg.title,
    body: msg.body,
    tag: `daily-${today}`,
    url: '/',
  });
}

export async function sendWeeklySummary(user: UserRow, now: Date, opts: { force?: boolean; dedupeKey?: string } = {}): Promise<SendResult | null> {
  const s = user.settings;
  const local = nowIn(s.timezone, now);
  const today = local.toISODate()!;
  if (!opts.force && (!s.weeklyEnabled || local.weekday !== s.weeklyDay || !inWindow(local, today, s.weeklyTime, s.timezone, SUMMARY_CATCHUP_MINUTES))) {
    return null;
  }
  const dates = summaryWeek(today, opts.force ? local.weekday : s.weeklyDay);
  const occ = await listOccurrences(user.id, dates[0], dates[6], { withSubtasks: false });
  const msg = weeklySummary(occ, dates);
  return sendToUser(user.id, opts.dedupeKey ?? `weekly:${user.id}:${dates[0]}`, {
    kind: opts.force ? 'test' : 'weekly',
    title: msg.title,
    body: msg.body,
    tag: `weekly-${dates[0]}`,
    url: '/calendario?view=week',
  });
}

export async function sendDueReminders(user: UserRow, now: Date) {
  const s = user.settings;
  if (!s.remindersEnabled) return 0;
  const { rows } = await query<{ max: number | null }>(
    'SELECT max(r) AS max FROM tasks t, unnest(t.reminders) r WHERE t.user_id = $1',
    [user.id],
  );
  const maxOffset = rows[0]?.max;
  if (maxOffset == null) return 0;

  const local = nowIn(s.timezone, now);
  const today = local.toISODate()!;
  const horizonDays = Math.ceil(maxOffset / 1440) + 1;
  const occurrences = await listOccurrences(user.id, addDays(today, -1), addDays(today, horizonDays), {
    withSubtasks: false,
    onlyWithReminders: true,
  });

  let sent = 0;
  for (const o of occurrences) {
    if (o.status === 'done') continue;
    const anchor = localInstant(o.date, o.startTime ?? s.alldayReminderTime, s.timezone);
    for (const offset of o.reminders) {
      const fireAt = anchor.minus({ minutes: offset });
      const late = local.diff(fireAt, 'minutes').minutes;
      if (late < 0 || late >= REMINDER_GRACE_MINUTES) continue;
      if (!o.allDay && anchor < local.minus({ minutes: 1 })) continue; // já começou
      const minutesLeft = Math.max(0, Math.round(anchor.diff(local, 'minutes').minutes));
      const msg = reminderMessage(o, minutesLeft, offset);
      // a chave inclui data e horário: se a tarefa for reagendada, o novo lembrete é enviado normalmente
      const key = `reminder:${o.taskId}:${o.originalDate}:${o.date}T${o.startTime ?? 'allday'}:${offset}`;
      const r = await sendToUser(user.id, key, {
        kind: 'reminder',
        title: msg.title,
        body: msg.body,
        tag: `reminder-${o.id}`,
        url: `/calendario?view=day&date=${o.date}&task=${encodeURIComponent(o.id)}`,
        requireInteraction: offset <= 60,
        data: { taskId: o.taskId, occurrenceDate: o.originalDate },
      });
      if (r.status === 'sent') sent++;
    }
  }
  return sent;
}

/** Usuários com pelo menos um dispositivo inscrito. */
async function usersToNotify(): Promise<UserRow[]> {
  const { rows } = await query(
    `SELECT s.* FROM user_settings s
      WHERE EXISTS (SELECT 1 FROM push_subscriptions p WHERE p.user_id = s.user_id)`,
  );
  return rows.map((r) => ({ id: r.user_id, settings: mapSettings(r) }));
}

export async function getUserForNotify(userId: string): Promise<UserRow | null> {
  const { rows } = await query('SELECT * FROM user_settings WHERE user_id = $1', [userId]);
  return rows[0] ? { id: userId, settings: mapSettings(rows[0]) } : null;
}

/** Uma rodada do agendador. Idempotente: pode ser executada várias vezes no mesmo minuto. */
export async function runTick(now: Date = new Date()) {
  if (!pushEnabled()) return { users: 0 };
  const users = await usersToNotify();
  for (const user of users) {
    for (const job of [sendDailySummary, sendWeeklySummary, sendDueReminders] as const) {
      try {
        await job(user, now);
      } catch (err) {
        console.error(`[scheduler] erro em ${job.name} para ${user.id}`, err);
      }
    }
  }
  return { users: users.length };
}

let timer: NodeJS.Timeout | null = null;
let running = false;

/** Executa o agendador a cada minuto, alinhado ao início do minuto. */
export function startScheduler() {
  if (timer) return;
  if (!pushEnabled()) {
    console.warn('[scheduler] VAPID não configurado — agendador de notificações desativado.');
    return;
  }
  const loop = async () => {
    if (!running) {
      running = true;
      const client = await pool.connect().catch(() => null);
      try {
        // apenas uma instância processa cada minuto (o banco ainda garante a não duplicidade)
        const lock = client ? await client.query('SELECT pg_try_advisory_lock(727275) AS ok') : null;
        if (lock?.rows[0]?.ok) {
          try {
            await runTick(new Date());
          } finally {
            await client!.query('SELECT pg_advisory_unlock(727275)');
          }
        }
      } catch (err) {
        console.error('[scheduler] falha na rodada', err);
      } finally {
        client?.release();
        running = false;
      }
    }
    const delay = 60_000 - (Date.now() % 60_000) + 1_000;
    timer = setTimeout(loop, delay);
  };
  console.log('[scheduler] agendador de notificações iniciado (verificação a cada minuto).');
  timer = setTimeout(loop, 2_000);
}

export function stopScheduler() {
  if (timer) clearTimeout(timer);
  timer = null;
}
