import { Router } from 'express';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { query, withTransaction } from '../db/pool.js';
import { HttpError, notFound } from '../lib/errors.js';
import { listOccurrences, occurrenceFrom, type TaskRow, type ExceptionRow, type Subtask } from '../lib/occurrences.js';
import { isOccurrence, recurrenceSchema } from '../lib/recurrence.js';
import { DATE_RE, TIME_RE, addDays, minutesOf } from '../lib/time.js';
import { userId } from '../middleware/auth.js';
import { getSettings, remindersSchema } from './settings.js';

export const tasksRouter = Router();
export const subtasksRouter = Router();

const date = z.string().regex(DATE_RE, 'Data inválida (use AAAA-MM-DD).');
const time = z.string().regex(TIME_RE, 'Horário inválido (use HH:MM).');
const status = z.enum(['pending', 'in_progress', 'done']);
const scope = z.enum(['this', 'following', 'all']);

const taskFields = {
  title: z.string().trim().min(1, 'Informe o título.').max(200),
  description: z.string().max(5000),
  notes: z.string().max(5000),
  date,
  startTime: time.nullable(),
  endTime: time.nullable(),
  categoryId: z.string().uuid().nullable(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
  status,
  recurrence: recurrenceSchema.nullable(),
  reminders: remindersSchema,
};

const createSchema = z
  .object({
    ...taskFields,
    description: taskFields.description.default(''),
    notes: taskFields.notes.default(''),
    startTime: taskFields.startTime.default(null),
    endTime: taskFields.endTime.default(null),
    categoryId: taskFields.categoryId.default(null),
    priority: taskFields.priority.default('medium'),
    status: taskFields.status.default('pending'),
    recurrence: taskFields.recurrence.default(null),
    reminders: taskFields.reminders.optional(),
    subtasks: z.array(z.object({ title: z.string().trim().min(1).max(200), done: z.boolean().default(false) })).max(50).default([]),
  })
  .superRefine(validateTimes);

const updateSchema = z
  .object({ ...taskFields, scope: scope.default('all'), occurrenceDate: date.optional() })
  .partial()
  .superRefine(validateTimes);

function validateTimes(v: { startTime?: string | null; endTime?: string | null; recurrence?: any; date?: string }, ctx: z.RefinementCtx) {
  if (v.endTime && v.startTime === null) {
    ctx.addIssue({ code: 'custom', path: ['endTime'], message: 'Defina o horário de início antes do término.' });
  }
  if (v.startTime && v.endTime && minutesOf(v.endTime) <= minutesOf(v.startTime)) {
    ctx.addIssue({ code: 'custom', path: ['endTime'], message: 'O término precisa ser depois do início.' });
  }
  if (v.recurrence?.until && v.date && v.recurrence.until < v.date) {
    ctx.addIssue({ code: 'custom', path: ['recurrence', 'until'], message: 'A data final precisa ser depois do início.' });
  }
}

async function getTask(id: string, uid: string, db?: PoolClient): Promise<TaskRow> {
  const { rows } = await query<TaskRow>('SELECT * FROM tasks WHERE id = $1 AND user_id = $2', [id, uid], db);
  if (!rows[0]) throw notFound('Tarefa');
  return rows[0];
}

async function getSubtasks(taskId: string, db?: PoolClient): Promise<Subtask[]> {
  const { rows } = await query<Subtask>('SELECT id, title, done, position FROM subtasks WHERE task_id = $1 ORDER BY position, created_at', [taskId], db);
  return rows;
}

async function assertCategory(uid: string, categoryId: string | null | undefined, db?: PoolClient) {
  if (!categoryId) return;
  const { rowCount } = await query('SELECT 1 FROM categories WHERE id = $1 AND user_id = $2', [categoryId, uid], db);
  if (!rowCount) throw new HttpError(400, 'Categoria inválida.', 'invalid_category');
}

function assertOccurrence(task: TaskRow, occurrenceDate: string | undefined) {
  if (!task.recurrence) return;
  if (!occurrenceDate) throw new HttpError(400, 'Informe a ocorrência (occurrenceDate).', 'occurrence_required');
  if (!isOccurrence(task.date, task.recurrence, occurrenceDate)) {
    throw new HttpError(400, 'Data não corresponde a uma ocorrência desta tarefa.', 'invalid_occurrence');
  }
}

interface TaskInsert {
  title: string;
  description: string;
  notes: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  categoryId: string | null;
  priority: string;
  status: string;
  recurrence: unknown;
  reminders: number[];
}

async function insertTask(db: PoolClient, uid: string, t: TaskInsert, subtasks: { title: string; done: boolean }[] = []) {
  const { rows } = await db.query<TaskRow>(
    `INSERT INTO tasks (user_id, title, description, notes, date, start_time, end_time, category_id, priority, status,
                        completed_at, recurrence, reminders)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, CASE WHEN $10 = 'done' THEN now() END, $11, $12) RETURNING *`,
    [
      uid,
      t.title,
      t.description,
      t.notes,
      t.date,
      t.startTime,
      t.startTime ? t.endTime : null,
      t.categoryId,
      t.priority,
      t.recurrence ? 'pending' : t.status,
      t.recurrence ? JSON.stringify(t.recurrence) : null,
      [...new Set(t.reminders)].sort((a, b) => a - b),
    ],
  );
  for (const [i, s] of subtasks.entries()) {
    await db.query('INSERT INTO subtasks (task_id, title, done, position) VALUES ($1,$2,$3,$4)', [rows[0].id, s.title, s.done, i]);
  }
  return rows[0];
}

function toInsert(task: TaskRow): TaskInsert {
  return {
    title: task.title,
    description: task.description,
    notes: task.notes,
    date: task.date,
    startTime: task.start_time?.slice(0, 5) ?? null,
    endTime: task.end_time?.slice(0, 5) ?? null,
    categoryId: task.category_id,
    priority: task.priority,
    status: task.status,
    recurrence: task.recurrence,
    reminders: task.reminders,
  };
}

async function respondTask(res: any, taskId: string, uid: string, occurrenceDate?: string, status = 200) {
  const task = await getTask(taskId, uid);
  const subtasks = await getSubtasks(taskId);
  let ex: ExceptionRow | undefined;
  const occDate = task.recurrence ? occurrenceDate ?? task.date : task.date;
  if (task.recurrence) {
    const { rows } = await query<ExceptionRow>('SELECT * FROM task_exceptions WHERE task_id = $1 AND occurrence_date = $2', [taskId, occDate]);
    ex = rows[0];
  }
  res.status(status).json({ task: occurrenceFrom(task, occDate, ex, subtasks) });
}

/* ------------------------------------------------------------------ */
/* Ocorrências (base do calendário)                                    */
/* ------------------------------------------------------------------ */
const rangeSchema = z.object({ from: date, to: date }).refine((r) => r.from <= r.to, 'Intervalo inválido.');

tasksRouter.get('/occurrences', async (req, res) => {
  const { from, to } = rangeSchema.parse(req.query);
  if (addDays(from, 120) < to) throw new HttpError(400, 'Intervalo máximo de 120 dias.', 'range_too_large');
  res.json({ occurrences: await listOccurrences(userId(req), from, to) });
});

const searchSchema = z.object({ q: z.string().trim().min(1).max(100) });
tasksRouter.get('/tasks/search', async (req, res) => {
  const { q } = searchSchema.parse(req.query);
  const { rows } = await query<TaskRow>(
    `SELECT * FROM tasks WHERE user_id = $1 AND (title ILIKE $2 OR description ILIKE $2 OR notes ILIKE $2)
      ORDER BY date DESC LIMIT 50`,
    [userId(req), `%${q.replace(/[%_\\]/g, '\\$&')}%`],
  );
  res.json({ tasks: rows.map((t) => occurrenceFrom(t, t.date)) });
});

/* ------------------------------------------------------------------ */
/* CRUD                                                                */
/* ------------------------------------------------------------------ */
tasksRouter.get('/tasks/:id', async (req, res) => {
  const occ = typeof req.query.occurrenceDate === 'string' ? date.parse(req.query.occurrenceDate) : undefined;
  await respondTask(res, req.params.id, userId(req), occ);
});

tasksRouter.post('/tasks', async (req, res) => {
  const uid = userId(req);
  const body = createSchema.parse(req.body);
  await assertCategory(uid, body.categoryId);
  const reminders = body.reminders ?? (await getSettings(uid)).defaultReminders;
  const task = await withTransaction((db) => insertTask(db, uid, { ...body, reminders }, body.subtasks));
  await respondTask(res, task.id, uid, undefined, 201);
});

tasksRouter.patch('/tasks/:id', async (req, res) => {
  const uid = userId(req);
  const { scope, occurrenceDate, ...changes } = updateSchema.parse(req.body);
  await assertCategory(uid, changes.categoryId);

  const result = await withTransaction(async (db) => {
    const task = await getTask(req.params.id, uid, db);
    const merged = { ...toInsert(task), ...stripUndefined(changes) } as TaskInsert;
    if (!merged.startTime) merged.endTime = null;
    if (merged.startTime && merged.endTime && minutesOf(merged.endTime) <= minutesOf(merged.startTime)) {
      throw new HttpError(400, 'O término precisa ser depois do início.', 'invalid_time');
    }

    // Tarefa avulsa (ou edição de toda a série)
    if (!task.recurrence || scope === 'all') {
      const statusChanged = changes.status && changes.status !== task.status;
      await db.query(
        `UPDATE tasks SET title=$3, description=$4, notes=$5, date=$6, start_time=$7, end_time=$8, category_id=$9,
                priority=$10, status=$11, recurrence=$12, reminders=$13, updated_at=now(),
                completed_at = CASE WHEN $14 THEN (CASE WHEN $11 = 'done' THEN now() END) ELSE completed_at END
          WHERE id=$1 AND user_id=$2`,
        [
          task.id,
          uid,
          merged.title,
          merged.description,
          merged.notes,
          merged.date,
          merged.startTime,
          merged.endTime,
          merged.categoryId,
          merged.priority,
          merged.recurrence ? 'pending' : merged.status,
          merged.recurrence ? JSON.stringify(merged.recurrence) : null,
          [...new Set(merged.reminders)].sort((a, b) => a - b),
          !!statusChanged || (!!merged.recurrence !== !!task.recurrence),
        ],
      );
      // se a regra/data mudou, exceções antigas podem não fazer mais sentido
      if (task.recurrence && (changes.recurrence !== undefined || changes.date !== undefined)) {
        if (!merged.recurrence) await db.query('DELETE FROM task_exceptions WHERE task_id = $1', [task.id]);
      }
      return { id: task.id, occurrenceDate: merged.recurrence ? occurrenceDate : undefined };
    }

    assertOccurrence(task, occurrenceDate);
    const occ = occurrenceDate!;

    if (scope === 'this') {
      // "Somente esta": a ocorrência vira uma tarefa avulsa com as alterações
      const { rows } = await db.query<ExceptionRow>('SELECT * FROM task_exceptions WHERE task_id=$1 AND occurrence_date=$2', [task.id, occ]);
      const ex = rows[0];
      const current = occurrenceFrom(task, occ, ex);
      const detached = await insertTask(
        db,
        uid,
        {
          ...merged,
          date: changes.date ?? current.date,
          startTime: changes.startTime !== undefined ? changes.startTime : current.startTime,
          endTime: changes.endTime !== undefined ? changes.endTime : current.endTime,
          status: changes.status ?? current.status,
          recurrence: null,
        },
        (await getSubtasks(task.id, db)).map((s) => ({ title: s.title, done: s.done })),
      );
      await upsertException(db, task.id, occ, { deleted: true });
      return { id: detached.id };
    }

    // "Esta e as próximas": encerra a série anterior e cria uma nova a partir desta ocorrência
    const subs = await getSubtasks(task.id, db);
    if (occ === task.date) {
      // a "próxima" é a primeira: equivale a substituir a série inteira
      await db.query('DELETE FROM tasks WHERE id = $1', [task.id]);
    } else {
      const rule = { ...task.recurrence, until: addDays(occ, -1) };
      if (rule.count) rule.count = null; // contagem não se aplica após a divisão
      await db.query('UPDATE tasks SET recurrence = $2, updated_at = now() WHERE id = $1', [task.id, JSON.stringify(rule)]);
      await db.query('DELETE FROM task_exceptions WHERE task_id = $1 AND occurrence_date >= $2', [task.id, occ]);
    }
    const created = await insertTask(
      db,
      uid,
      { ...merged, date: changes.date ?? occ, recurrence: merged.recurrence },
      subs.map((s) => ({ title: s.title, done: false })),
    );
    return { id: created.id, occurrenceDate: created.recurrence ? created.date : undefined };
  });

  await respondTask(res, result.id, uid, result.occurrenceDate);
});

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

async function upsertException(
  db: PoolClient,
  taskId: string,
  occ: string,
  v: Partial<{ status: string; deleted: boolean; new_date: string | null; new_start_time: string | null; new_end_time: string | null; time_overridden: boolean }>,
) {
  const cols = Object.keys(v);
  const vals = Object.values(v);
  const statusSql = v.status !== undefined ? `, completed_at = CASE WHEN EXCLUDED.status = 'done' THEN now() END` : '';
  const insertCompleted = v.status === 'done' ? ', completed_at' : '';
  const insertCompletedVal = v.status === 'done' ? ', now()' : '';
  await db.query(
    `INSERT INTO task_exceptions (task_id, occurrence_date, ${cols.join(', ')}${insertCompleted})
     VALUES ($1, $2, ${cols.map((_, i) => `$${i + 3}`).join(', ')}${insertCompletedVal})
     ON CONFLICT (task_id, occurrence_date) DO UPDATE SET
       ${cols.map((c) => `${c} = EXCLUDED.${c}`).join(', ')}${statusSql}, updated_at = now()`,
    [taskId, occ, ...vals],
  );
}

const deleteSchema = z.object({ scope: scope.default('all'), occurrenceDate: date.optional() });

tasksRouter.delete('/tasks/:id', async (req, res) => {
  const uid = userId(req);
  const { scope, occurrenceDate } = deleteSchema.parse(req.query);
  await withTransaction(async (db) => {
    const task = await getTask(req.params.id, uid, db);
    if (!task.recurrence || scope === 'all') {
      await db.query('DELETE FROM tasks WHERE id = $1', [task.id]);
      return;
    }
    assertOccurrence(task, occurrenceDate);
    if (scope === 'this') {
      await upsertException(db, task.id, occurrenceDate!, { deleted: true });
    } else if (occurrenceDate! <= task.date) {
      await db.query('DELETE FROM tasks WHERE id = $1', [task.id]);
    } else {
      const rule = { ...task.recurrence, until: addDays(occurrenceDate!, -1) };
      await db.query('UPDATE tasks SET recurrence = $2, updated_at = now() WHERE id = $1', [task.id, JSON.stringify(rule)]);
      await db.query('DELETE FROM task_exceptions WHERE task_id = $1 AND occurrence_date >= $2', [task.id, occurrenceDate]);
    }
  });
  res.json({ ok: true });
});

/* Status de uma tarefa (ou de uma ocorrência de tarefa recorrente) */
const statusSchema = z.object({ status, occurrenceDate: date.optional() });

tasksRouter.post('/tasks/:id/status', async (req, res) => {
  const uid = userId(req);
  const body = statusSchema.parse(req.body);
  const task = await getTask(req.params.id, uid);
  if (task.recurrence) {
    assertOccurrence(task, body.occurrenceDate);
    await withTransaction((db) => upsertException(db, task.id, body.occurrenceDate!, { status: body.status }));
  } else {
    await query(
      `UPDATE tasks SET status = $2, updated_at = now(),
              completed_at = CASE WHEN $2 = 'done' THEN coalesce(completed_at, now()) END WHERE id = $1`,
      [task.id, body.status],
    );
  }
  await respondTask(res, task.id, uid, body.occurrenceDate);
});

/* Reagendar */
const rescheduleSchema = z
  .object({
    occurrenceDate: date.optional(),
    date,
    startTime: time.nullable().optional(),
    endTime: time.nullable().optional(),
  })
  .superRefine(validateTimes);

tasksRouter.post('/tasks/:id/reschedule', async (req, res) => {
  const uid = userId(req);
  const body = rescheduleSchema.parse(req.body);
  const task = await getTask(req.params.id, uid);
  const timeGiven = body.startTime !== undefined;
  const startTime = timeGiven ? body.startTime ?? null : task.start_time;
  const endTime = timeGiven ? (startTime ? body.endTime ?? null : null) : task.end_time;

  if (!task.recurrence) {
    await query('UPDATE tasks SET date = $2, start_time = $3, end_time = $4, updated_at = now() WHERE id = $1', [task.id, body.date, startTime, endTime]);
    return respondTask(res, task.id, uid);
  }
  assertOccurrence(task, body.occurrenceDate);
  await withTransaction((db) =>
    upsertException(db, task.id, body.occurrenceDate!, {
      new_date: body.date === body.occurrenceDate ? null : body.date,
      ...(timeGiven ? { new_start_time: startTime, new_end_time: endTime, time_overridden: true } : {}),
    }),
  );
  await respondTask(res, task.id, uid, body.occurrenceDate);
});

/* Duplicar */
const duplicateSchema = z.object({ occurrenceDate: date.optional(), date: date.optional() });

tasksRouter.post('/tasks/:id/duplicate', async (req, res) => {
  const uid = userId(req);
  const body = duplicateSchema.parse(req.body ?? {});
  const created = await withTransaction(async (db) => {
    const task = await getTask(req.params.id, uid, db);
    const subs = await getSubtasks(task.id, db);
    const base = toInsert(task);
    // duplicar uma ocorrência específica cria uma tarefa avulsa naquela data
    const single = !!(task.recurrence && body.occurrenceDate);
    return insertTask(
      db,
      uid,
      {
        ...base,
        title: `${task.title} (cópia)`,
        date: body.date ?? (single ? body.occurrenceDate! : task.date),
        status: 'pending',
        recurrence: single ? null : task.recurrence,
      },
      subs.map((s) => ({ title: s.title, done: false })),
    );
  });
  await respondTask(res, created.id, uid, undefined, 201);
});

/* ------------------------------------------------------------------ */
/* Subtarefas                                                          */
/* ------------------------------------------------------------------ */
const subtaskCreate = z.object({ title: z.string().trim().min(1, 'Informe a subtarefa.').max(200) });
const subtaskUpdate = z.object({ title: z.string().trim().min(1).max(200).optional(), done: z.boolean().optional(), position: z.number().int().min(0).optional() });

tasksRouter.post('/tasks/:id/subtasks', async (req, res) => {
  const body = subtaskCreate.parse(req.body);
  const task = await getTask(req.params.id, userId(req));
  const { rows } = await query(
    `INSERT INTO subtasks (task_id, title, position)
     VALUES ($1, $2, (SELECT coalesce(max(position) + 1, 0) FROM subtasks WHERE task_id = $1))
     RETURNING id, title, done, position`,
    [task.id, body.title],
  );
  await query('UPDATE tasks SET updated_at = now() WHERE id = $1', [task.id]);
  res.status(201).json({ subtask: rows[0] });
});

subtasksRouter.patch('/:id', async (req, res) => {
  const body = subtaskUpdate.parse(req.body);
  const { rows } = await query(
    `UPDATE subtasks s SET title = coalesce($3, s.title), done = coalesce($4, s.done), position = coalesce($5, s.position)
       FROM tasks t WHERE s.id = $1 AND t.id = s.task_id AND t.user_id = $2
     RETURNING s.id, s.title, s.done, s.position`,
    [req.params.id, userId(req), body.title ?? null, body.done ?? null, body.position ?? null],
  );
  if (!rows[0]) throw notFound('Subtarefa');
  res.json({ subtask: rows[0] });
});

subtasksRouter.delete('/:id', async (req, res) => {
  const { rowCount } = await query('DELETE FROM subtasks s USING tasks t WHERE s.id = $1 AND t.id = s.task_id AND t.user_id = $2', [req.params.id, userId(req)]);
  if (!rowCount) throw notFound('Subtarefa');
  res.json({ ok: true });
});
