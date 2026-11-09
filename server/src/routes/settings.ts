import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { TIME_RE, isValidTimezone } from '../lib/time.js';
import { userId } from '../middleware/auth.js';

export const settingsRouter = Router();

export interface Settings {
  timezone: string;
  dailyEnabled: boolean;
  dailyTime: string;
  weeklyEnabled: boolean;
  weeklyTime: string;
  weeklyDay: number;
  remindersEnabled: boolean;
  defaultReminders: number[];
  alldayReminderTime: string;
  defaultView: 'day' | 'week' | 'month';
  theme: 'system' | 'light' | 'dark';
}

export function mapSettings(r: any): Settings {
  return {
    timezone: r.timezone,
    dailyEnabled: r.daily_enabled,
    dailyTime: r.daily_time,
    weeklyEnabled: r.weekly_enabled,
    weeklyTime: r.weekly_time,
    weeklyDay: r.weekly_day,
    remindersEnabled: r.reminders_enabled,
    defaultReminders: r.default_reminders,
    alldayReminderTime: r.allday_reminder_time,
    defaultView: r.default_view,
    theme: r.theme,
  };
}

export async function getSettings(uid: string): Promise<Settings> {
  const { rows } = await query(
    `INSERT INTO user_settings (user_id, timezone) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET user_id = excluded.user_id RETURNING *`,
    [uid, config.defaultTimezone],
  );
  return mapSettings(rows[0]);
}

const time = z.string().regex(TIME_RE, 'Horário inválido (use HH:MM).');
export const remindersSchema = z.array(z.number().int().min(0).max(60 * 24 * 60)).max(10);

const updateSchema = z
  .object({
    timezone: z.string().refine(isValidTimezone, 'Fuso horário inválido.'),
    dailyEnabled: z.boolean(),
    dailyTime: time,
    weeklyEnabled: z.boolean(),
    weeklyTime: time,
    weeklyDay: z.number().int().min(1).max(7),
    remindersEnabled: z.boolean(),
    defaultReminders: remindersSchema,
    alldayReminderTime: time,
    defaultView: z.enum(['day', 'week', 'month']),
    theme: z.enum(['system', 'light', 'dark']),
  })
  .partial();

const columnMap: Record<string, string> = {
  timezone: 'timezone',
  dailyEnabled: 'daily_enabled',
  dailyTime: 'daily_time',
  weeklyEnabled: 'weekly_enabled',
  weeklyTime: 'weekly_time',
  weeklyDay: 'weekly_day',
  remindersEnabled: 'reminders_enabled',
  defaultReminders: 'default_reminders',
  alldayReminderTime: 'allday_reminder_time',
  defaultView: 'default_view',
  theme: 'theme',
};

settingsRouter.get('/', async (req, res) => {
  res.json({ settings: await getSettings(userId(req)) });
});

settingsRouter.patch('/', async (req, res) => {
  const body = updateSchema.parse(req.body);
  await getSettings(userId(req));
  if (body.defaultReminders) body.defaultReminders = [...new Set(body.defaultReminders)].sort((a, b) => a - b);
  const entries = Object.entries(body).filter(([, v]) => v !== undefined);
  if (entries.length) {
    const sets = entries.map(([k], i) => `${columnMap[k]} = $${i + 2}`);
    const values = entries.map(([, v]) => v);
    await query(`UPDATE user_settings SET ${sets.join(', ')}, updated_at = now() WHERE user_id = $1`, [userId(req), ...values]);
  }
  res.json({ settings: await getSettings(userId(req)) });
});
