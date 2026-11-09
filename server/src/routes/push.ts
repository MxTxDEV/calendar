import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { HttpError, notFound } from '../lib/errors.js';
import { userId } from '../middleware/auth.js';
import { isAllowedEndpoint, pushEnabled, sendToUser } from '../notifications/push.js';
import { getUserForNotify, sendDailySummary, sendWeeklySummary } from '../notifications/scheduler.js';

export const pushRouter = Router();

pushRouter.get('/public-key', (_req, res) => {
  res.json({ enabled: pushEnabled(), publicKey: pushEnabled() ? config.vapid.publicKey : null });
});

const subscribeSchema = z.object({
  subscription: z.object({
    endpoint: z.string().url().max(2000),
    expirationTime: z.number().nullable().optional(),
    keys: z.object({ p256dh: z.string().min(10).max(500), auth: z.string().min(4).max(200) }),
  }),
  deviceLabel: z.string().trim().max(80).optional(),
});

function guessDevice(ua: string | undefined) {
  if (!ua) return 'Dispositivo';
  const os = /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Dispositivo';
  const br = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  return br ? `${os} · ${br}` : os;
}

pushRouter.post('/subscribe', async (req, res) => {
  if (!pushEnabled()) throw new HttpError(503, 'Notificações push não estão configuradas no servidor.', 'push_disabled');
  const { subscription, deviceLabel } = subscribeSchema.parse(req.body);
  if (!isAllowedEndpoint(subscription.endpoint)) {
    throw new HttpError(400, 'Endereço de inscrição push não reconhecido.', 'invalid_endpoint');
  }
  const ua = req.headers['user-agent'];
  // a mesma inscrição (endpoint) passa a pertencer ao usuário logado
  const { rows } = await query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, device_label)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
       user_agent = EXCLUDED.user_agent, device_label = coalesce(EXCLUDED.device_label, push_subscriptions.device_label),
       failure_count = 0, last_error = NULL
     RETURNING id, device_label, created_at`,
    [userId(req), subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, ua?.slice(0, 300) ?? null, deviceLabel || guessDevice(ua)],
  );
  res.status(201).json({ subscription: rows[0] });
});

pushRouter.post('/unsubscribe', async (req, res) => {
  const { endpoint } = z.object({ endpoint: z.string().max(2000) }).parse(req.body);
  await query('DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2', [endpoint, userId(req)]);
  res.json({ ok: true });
});

pushRouter.get('/subscriptions', async (req, res) => {
  const { rows } = await query(
    `SELECT id, device_label AS "deviceLabel", endpoint, created_at AS "createdAt", last_success_at AS "lastSuccessAt",
            failure_count AS "failureCount", last_error AS "lastError"
       FROM push_subscriptions WHERE user_id = $1 ORDER BY created_at`,
    [userId(req)],
  );
  res.json({ subscriptions: rows });
});

pushRouter.delete('/subscriptions/:id', async (req, res) => {
  const { rowCount } = await query('DELETE FROM push_subscriptions WHERE id = $1 AND user_id = $2', [req.params.id, userId(req)]);
  if (!rowCount) throw notFound('Dispositivo');
  res.json({ ok: true });
});

const testSchema = z.object({ type: z.enum(['simple', 'daily', 'weekly']).default('simple') });

pushRouter.post('/test', async (req, res) => {
  const { type } = testSchema.parse(req.body ?? {});
  const uid = userId(req);
  const key = `test:${uid}:${type}:${Date.now()}`;
  let result;
  if (type === 'simple') {
    result = await sendToUser(uid, key, {
      kind: 'test',
      title: '🔔 MyDay está pronto!',
      body: 'As notificações estão funcionando neste dispositivo. Você será lembrado dos seus compromissos.',
      url: '/',
    });
  } else {
    const user = await getUserForNotify(uid);
    if (!user) throw notFound('Configurações');
    const fn = type === 'daily' ? sendDailySummary : sendWeeklySummary;
    result = await fn(user, new Date(), { force: true, dedupeKey: key });
  }
  if (result?.status === 'no_subscription') {
    throw new HttpError(400, 'Nenhum dispositivo inscrito. Ative as notificações primeiro.', 'no_subscription');
  }
  if (result?.status === 'disabled') throw new HttpError(503, 'Notificações push não estão configuradas no servidor.', 'push_disabled');
  res.json({ result });
});

pushRouter.get('/history', async (req, res) => {
  const { rows } = await query(
    `SELECT id, kind, title, body, status, delivered, error, created_at AS "createdAt", sent_at AS "sentAt"
       FROM notification_log WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [userId(req)],
  );
  res.json({ history: rows });
});
