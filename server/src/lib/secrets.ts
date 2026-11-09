import crypto from 'node:crypto';
import webpush from 'web-push';
import { config } from '../config.js';
import { pool } from '../db/pool.js';

/** Lê um valor de app_config ou o cria (seguro contra corrida entre instâncias). */
async function getOrCreate(key: string, make: () => string) {
  const found = await pool.query('SELECT value FROM app_config WHERE key = $1', [key]);
  if (found.rows[0]) return found.rows[0].value as string;
  await pool.query('INSERT INTO app_config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING', [key, make()]);
  const again = await pool.query('SELECT value FROM app_config WHERE key = $1', [key]);
  return again.rows[0].value as string;
}

let done: Promise<void> | null = null;

/**
 * Completa a configuração: o que não estiver em variáveis de ambiente (SESSION_SECRET, CRON_SECRET,
 * chaves VAPID) é gerado uma única vez e guardado no banco. Variáveis de ambiente têm prioridade.
 */
export function initSecrets() {
  done ??= (async () => {
    if (!config.sessionSecret) config.sessionSecret = await getOrCreate('session_secret', () => crypto.randomBytes(48).toString('hex'));
    if (!config.cronSecret) config.cronSecret = await getOrCreate('cron_secret', () => crypto.randomBytes(24).toString('hex'));
    if (!config.vapid.publicKey || !config.vapid.privateKey) {
      const pair = await getOrCreate('vapid', () => JSON.stringify(webpush.generateVAPIDKeys()));
      const { publicKey, privateKey } = JSON.parse(pair);
      config.vapid.publicKey = publicKey;
      config.vapid.privateKey = privateKey;
    }
  })().catch((err) => {
    done = null;
    throw err;
  });
  return done;
}
