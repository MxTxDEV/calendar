import webpush from 'web-push';
import { config } from '../config.js';
import { query } from '../db/pool.js';

let configured = false;
let warnedInvalid = false;

export function pushEnabled() {
  if (configured) return true;
  const { publicKey, privateKey, subject } = config.vapid;
  if (!publicKey || !privateKey) return false;
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
  } catch (err) {
    if (!warnedInvalid) console.error('[push] chaves VAPID inválidas — notificações desativadas:', (err as Error).message);
    warnedInvalid = true;
    return false;
  }
  configured = true;
  return true;
}

export type NotificationKind = 'daily' | 'weekly' | 'reminder' | 'test';

export interface PushPayload {
  title: string;
  body: string;
  tag?: string;
  url?: string;
  kind: NotificationKind;
  requireInteraction?: boolean;
  data?: Record<string, unknown>;
}

export interface SendResult {
  status: 'sent' | 'failed' | 'no_subscription' | 'duplicate' | 'disabled';
  delivered: number;
  errors?: string[];
}

const MAX_ATTEMPTS = 4;
const MAX_PAYLOAD_BODY = 1800;

export function truncateBody(body: string) {
  return body.length > MAX_PAYLOAD_BODY ? body.slice(0, MAX_PAYLOAD_BODY - 1) + '…' : body;
}

interface SubRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Envia uma notificação para todos os dispositivos do usuário.
 * A `dedupeKey` é registrada antes do envio (INSERT … ON CONFLICT), garantindo que
 * a mesma notificação não seja enviada duas vezes — mesmo com várias instâncias do servidor.
 * Se todos os envios falharem, a notificação pode ser tentada novamente (até MAX_ATTEMPTS).
 */
export async function sendToUser(userId: string, dedupeKey: string, payload: PushPayload): Promise<SendResult> {
  if (!pushEnabled()) return { status: 'disabled', delivered: 0 };
  const body = truncateBody(payload.body);

  const claim = await query<{ id: string }>(
    `INSERT INTO notification_log (user_id, kind, dedupe_key, title, body)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (dedupe_key) DO UPDATE
       SET status = 'sending', attempts = notification_log.attempts + 1, title = EXCLUDED.title, body = EXCLUDED.body
       WHERE notification_log.status = 'failed' AND notification_log.attempts < ${MAX_ATTEMPTS}
     RETURNING id`,
    [userId, payload.kind, dedupeKey, payload.title, body],
  );
  if (!claim.rows[0]) return { status: 'duplicate', delivered: 0 };
  const logId = claim.rows[0].id;

  const { rows: subs } = await query<SubRow>('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1', [userId]);
  if (!subs.length) {
    await query(`UPDATE notification_log SET status = 'no_subscription' WHERE id = $1`, [logId]);
    return { status: 'no_subscription', delivered: 0 };
  }

  const message = JSON.stringify({
    title: payload.title,
    body,
    tag: payload.tag ?? dedupeKey,
    url: payload.url ?? '/',
    kind: payload.kind,
    requireInteraction: payload.requireInteraction ?? false,
    data: payload.data ?? {},
    timestamp: Date.now(),
  });

  const isReminder = payload.kind === 'reminder';
  let delivered = 0;
  const errors: string[] = [];

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, message, {
          TTL: isReminder ? 60 * 60 : 6 * 60 * 60,
          urgency: isReminder ? 'high' : 'normal',
          topic: undefined,
          timeout: 15_000,
        });
        delivered++;
        await query('UPDATE push_subscriptions SET last_success_at = now(), failure_count = 0, last_error = NULL WHERE id = $1', [s.id]);
      } catch (err: any) {
        const code = err?.statusCode as number | undefined;
        const msg = `${code ?? 'erro'}: ${String(err?.body || err?.message || err).slice(0, 300)}`;
        errors.push(msg);
        if (code === 404 || code === 410) {
          // inscrição expirada ou cancelada pelo navegador
          await query('DELETE FROM push_subscriptions WHERE id = $1', [s.id]);
        } else {
          await query(
            `UPDATE push_subscriptions SET failure_count = failure_count + 1, last_error = $2 WHERE id = $1`,
            [s.id, msg],
          );
          // remove dispositivos que falham repetidamente há muito tempo
          await query(`DELETE FROM push_subscriptions WHERE id = $1 AND failure_count >= 50`, [s.id]);
        }
      }
    }),
  );

  const status = delivered > 0 ? 'sent' : 'failed';
  await query(
    `UPDATE notification_log SET status = $2, delivered = $3, error = $4, sent_at = CASE WHEN $2 = 'sent' THEN now() END WHERE id = $1`,
    [logId, status, delivered, errors.length ? errors.join(' | ').slice(0, 1000) : null],
  );
  if (status === 'failed') console.warn(`[push] falha ao enviar ${dedupeKey}:`, errors.join(' | '));
  return { status, delivered, errors };
}

/** Hosts dos serviços de push dos navegadores (proteção contra SSRF). */
const DEFAULT_PUSH_HOSTS = [
  'fcm.googleapis.com',
  'android.googleapis.com',
  'updates.push.services.mozilla.com',
  'push.services.mozilla.com',
  'web.push.apple.com',
  'api.push.apple.com',
  'notify.windows.com',
  'push.api.chromium.org',
];

export function isAllowedEndpoint(endpoint: string) {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  const extra = (process.env.PUSH_ALLOWED_HOSTS ?? '').split(',').map((h) => h.trim()).filter(Boolean);
  const hosts = [...DEFAULT_PUSH_HOSTS, ...extra];
  if (url.protocol !== 'https:') {
    // http só é aceito fora de produção para hosts explicitamente liberados (testes locais)
    return !config.isProd && extra.includes(url.hostname);
  }
  return hosts.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`));
}
