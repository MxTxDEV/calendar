import crypto from 'node:crypto';
import { Router } from 'express';
import { config } from '../config.js';
import { HttpError } from '../lib/errors.js';
import { runTick } from '../notifications/scheduler.js';

export const cronRouter = Router();

function safeEqual(a: string, b: string) {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/**
 * Executa uma rodada do agendador de notificações. É idempotente (o banco impede envios duplicados),
 * então pode ser chamada com frequência. Autenticação: `Authorization: Bearer <CRON_SECRET>`
 * (formato usado pelo Vercel Cron) ou `?key=<CRON_SECRET>` (para agendadores externos).
 */
async function tick(req: any, res: any) {
  if (!config.cronSecret) throw new HttpError(404, 'Rota não encontrada.', 'not_found');
  const header = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const provided = header || (typeof req.query.key === 'string' ? req.query.key : '');
  if (!provided || !safeEqual(provided, config.cronSecret)) throw new HttpError(401, 'Não autorizado.', 'unauthorized');
  const result = await runTick(new Date());
  res.json({ ok: true, ...result, at: new Date().toISOString() });
}

cronRouter.get('/tick', tick);
cronRouter.post('/tick', tick);
