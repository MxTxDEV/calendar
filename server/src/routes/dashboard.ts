import { Router } from 'express';
import { listOccurrences, listOverdue, isOverdue } from '../lib/occurrences.js';
import { addDays, localInstant, nowIn } from '../lib/time.js';
import { userId } from '../middleware/auth.js';
import { getSettings } from './settings.js';

export const dashboardRouter = Router();

const UPCOMING_DAYS = 7;

dashboardRouter.get('/', async (req, res) => {
  const uid = userId(req);
  const settings = await getSettings(uid);
  const tz = settings.timezone;
  const now = new Date();
  const local = nowIn(tz, now);
  const today = local.toISODate()!;

  const [todayList, overdue, upcoming] = await Promise.all([
    listOccurrences(uid, today, today),
    listOverdue(uid, tz, now),
    listOccurrences(uid, addDays(today, 1), addDays(today, UPCOMING_DAYS)),
  ]);

  const done = todayList.filter((o) => o.status === 'done').length;
  const total = todayList.length;
  const next = [...todayList, ...upcoming].find(
    (o) => o.status !== 'done' && o.startTime && localInstant(o.date, o.endTime ?? o.startTime, tz) >= local,
  );

  res.json({
    now: local.toISO(),
    today,
    timezone: tz,
    stats: {
      total,
      done,
      pending: total - done,
      inProgress: todayList.filter((o) => o.status === 'in_progress').length,
      overdue: overdue.length,
      progress: total ? Math.round((done / total) * 100) : 0,
    },
    next: next ?? null,
    todayList: todayList.map((o) => ({ ...o, overdue: isOverdue(o, tz, now) })),
    overdue,
    upcoming,
  });
});
