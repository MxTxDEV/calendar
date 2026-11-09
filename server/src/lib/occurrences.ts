import { query, type Queryable, pool } from '../db/pool.js';
import { expandDates, isOccurrence, type Recurrence } from './recurrence.js';
import { addDays, hhmm, localInstant, nowIn } from './time.js';

export type Status = 'pending' | 'in_progress' | 'done';
export type Priority = 'low' | 'medium' | 'high' | 'urgent';

export interface TaskRow {
  id: string;
  user_id: string;
  category_id: string | null;
  title: string;
  description: string;
  notes: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
  priority: Priority;
  status: Status;
  completed_at: Date | null;
  recurrence: Recurrence | null;
  reminders: number[];
  created_at: Date;
  updated_at: Date;
}

export interface ExceptionRow {
  task_id: string;
  occurrence_date: string;
  status: Status | null;
  completed_at: Date | null;
  deleted: boolean;
  new_date: string | null;
  new_start_time: string | null;
  new_end_time: string | null;
  time_overridden: boolean;
}

export interface Subtask {
  id: string;
  title: string;
  done: boolean;
  position: number;
}

export interface Occurrence {
  id: string; // `${taskId}:${originalDate}` para recorrentes, taskId para avulsas
  taskId: string;
  date: string;
  originalDate: string;
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
  title: string;
  description: string;
  notes: string;
  categoryId: string | null;
  priority: Priority;
  status: Status;
  completedAt: string | null;
  recurring: boolean;
  recurrence: Recurrence | null;
  reminders: number[];
  rescheduled: boolean;
  subtasks: Subtask[];
}

export function occurrenceFrom(task: TaskRow, originalDate: string, ex?: ExceptionRow, subtasks: Subtask[] = []): Occurrence {
  const recurring = !!task.recurrence;
  const timeOverridden = !!ex?.time_overridden;
  const startTime = hhmm(timeOverridden ? ex!.new_start_time : task.start_time);
  const endTime = hhmm(timeOverridden ? ex!.new_end_time : task.end_time);
  const status = (recurring ? ex?.status ?? 'pending' : task.status) as Status;
  const completedAt = recurring ? ex?.completed_at ?? null : task.completed_at;
  const date = ex?.new_date ?? originalDate;
  return {
    id: recurring ? `${task.id}:${originalDate}` : task.id,
    taskId: task.id,
    date,
    originalDate,
    startTime,
    endTime,
    allDay: !startTime,
    title: task.title,
    description: task.description,
    notes: task.notes,
    categoryId: task.category_id,
    priority: task.priority,
    status,
    completedAt: completedAt ? new Date(completedAt).toISOString() : null,
    recurring,
    recurrence: task.recurrence,
    reminders: task.reminders ?? [],
    rescheduled: !!ex && (date !== originalDate || timeOverridden),
    subtasks,
  };
}

export function sortOccurrences(list: Occurrence[]) {
  const prio: Record<Priority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
  return list.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      // tarefas com horário primeiro, por horário; depois as "durante o dia"
      (a.startTime ? 0 : 1) - (b.startTime ? 0 : 1) ||
      (a.startTime ?? '').localeCompare(b.startTime ?? '') ||
      prio[a.priority] - prio[b.priority] ||
      a.title.localeCompare(b.title),
  );
}

async function loadSubtasks(taskIds: string[], db: Queryable) {
  const map = new Map<string, Subtask[]>();
  if (!taskIds.length) return map;
  const { rows } = await query<Subtask & { task_id: string }>(
    'SELECT id, task_id, title, done, position FROM subtasks WHERE task_id = ANY($1) ORDER BY position, created_at',
    [taskIds],
    db,
  );
  for (const r of rows) {
    const list = map.get(r.task_id) ?? [];
    list.push({ id: r.id, title: r.title, done: r.done, position: r.position });
    map.set(r.task_id, list);
  }
  return map;
}

/**
 * Lista todas as ocorrências (tarefas avulsas + recorrentes expandidas) com data entre `from` e `to`.
 */
export async function listOccurrences(
  userId: string,
  from: string,
  to: string,
  opts: { db?: Queryable; withSubtasks?: boolean; onlyWithReminders?: boolean } = {},
): Promise<Occurrence[]> {
  const db = opts.db ?? pool;
  const remindersFilter = opts.onlyWithReminders ? 'AND cardinality(t.reminders) > 0' : '';
  const { rows: tasks } = await query<TaskRow>(
    `SELECT t.* FROM tasks t
      WHERE t.user_id = $1 ${remindersFilter} AND (
        (t.recurrence IS NULL AND t.date BETWEEN $2 AND $3)
        OR (t.recurrence IS NOT NULL AND t.date <= $3
            AND (t.recurrence->>'until' IS NULL OR (t.recurrence->>'until')::date >= $2))
        OR (t.recurrence IS NOT NULL AND EXISTS (
            SELECT 1 FROM task_exceptions e
             WHERE e.task_id = t.id AND e.new_date BETWEEN $2 AND $3 AND NOT e.deleted))
      )`,
    [userId, from, to],
    db,
  );

  const recurringIds = tasks.filter((t) => t.recurrence).map((t) => t.id);
  const exByTask = new Map<string, Map<string, ExceptionRow>>();
  if (recurringIds.length) {
    const { rows: exs } = await query<ExceptionRow>(
      'SELECT * FROM task_exceptions WHERE task_id = ANY($1)',
      [recurringIds],
      db,
    );
    for (const e of exs) {
      const m = exByTask.get(e.task_id) ?? new Map();
      m.set(e.occurrence_date, e);
      exByTask.set(e.task_id, m);
    }
  }

  const subtasks = opts.withSubtasks === false ? new Map() : await loadSubtasks(tasks.map((t) => t.id), db);
  const out: Occurrence[] = [];

  for (const task of tasks) {
    const subs = subtasks.get(task.id) ?? [];
    if (!task.recurrence) {
      out.push(occurrenceFrom(task, task.date, undefined, subs));
      continue;
    }
    const exs = exByTask.get(task.id) ?? new Map<string, ExceptionRow>();
    const seen = new Set<string>();
    for (const date of expandDates(task.date, task.recurrence, from, to)) {
      seen.add(date);
      const ex = exs.get(date);
      if (ex?.deleted) continue;
      const occ = occurrenceFrom(task, date, ex, subs);
      if (occ.date >= from && occ.date <= to) out.push(occ);
    }
    // ocorrências de fora do intervalo que foram reagendadas para dentro dele
    for (const ex of exs.values()) {
      if (seen.has(ex.occurrence_date) || ex.deleted || !ex.new_date) continue;
      if (ex.new_date < from || ex.new_date > to) continue;
      if (!isOccurrence(task.date, task.recurrence, ex.occurrence_date)) continue;
      out.push(occurrenceFrom(task, ex.occurrence_date, ex, subs));
    }
  }
  return sortOccurrences(out);
}

/** Uma ocorrência está atrasada se ainda não foi concluída e o horário (ou o dia) já passou. */
export function isOverdue(o: Occurrence, tz: string, now: Date = new Date()) {
  if (o.status === 'done') return false;
  const local = nowIn(tz, now);
  const today = local.toISODate()!;
  if (o.date < today) return true;
  if (o.date > today || o.allDay || o.status === 'in_progress') return false;
  const ref = o.endTime ?? o.startTime!;
  return localInstant(o.date, ref, tz) < local;
}

const RECURRING_OVERDUE_LOOKBACK_DAYS = 14;

/** Tarefas atrasadas: avulsas sem limite de tempo, recorrentes nos últimos 14 dias. */
export async function listOverdue(userId: string, tz: string, now: Date = new Date(), db: Queryable = pool) {
  const today = nowIn(tz, now).toISODate()!;
  const { rows: oneOff } = await query<TaskRow>(
    `SELECT * FROM tasks WHERE user_id = $1 AND recurrence IS NULL AND status <> 'done' AND date < $2
      ORDER BY date, start_time NULLS LAST LIMIT 200`,
    [userId, today],
    db,
  );
  const subs = await loadSubtasks(oneOff.map((t) => t.id), db);
  const result: Occurrence[] = oneOff.map((t) => occurrenceFrom(t, t.date, undefined, subs.get(t.id) ?? []));

  const recent = await listOccurrences(userId, addDays(today, -RECURRING_OVERDUE_LOOKBACK_DAYS), today, { db });
  for (const o of recent) {
    if (!o.recurring && o.date < today) continue; // já incluídas acima
    if (isOverdue(o, tz, now)) result.push(o);
  }
  return sortOccurrences(result);
}
