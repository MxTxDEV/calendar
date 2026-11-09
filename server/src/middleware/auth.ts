import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { HttpError } from '../lib/errors.js';

export const SESSION_COOKIE = 'myday_session';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { id: string; email: string; name: string };
      sessionId?: string;
    }
  }
}

export function hashToken(token: string) {
  return crypto.createHmac('sha256', config.sessionSecret || 'dev-secret').update(token).digest('hex');
}

export async function createSession(res: Response, userId: string, userAgent?: string) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + config.sessionDays * 86400_000);
  await query('INSERT INTO sessions (user_id, token_hash, user_agent, expires_at) VALUES ($1, $2, $3, $4)', [
    userId,
    hashToken(token),
    userAgent?.slice(0, 300) ?? null,
    expires,
  ]);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: 'lax',
    expires,
    path: '/',
  });
}

export async function destroySession(req: Request, res: Response) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) await query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

export async function loadUser(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return next();
  const { rows } = await query(
    `UPDATE sessions s SET last_used_at = now()
       FROM users u
      WHERE s.token_hash = $1 AND s.expires_at > now() AND u.id = s.user_id
      RETURNING s.id AS session_id, u.id, u.email, u.name`,
    [hashToken(token)],
  );
  if (rows[0]) {
    req.user = { id: rows[0].id, email: rows[0].email, name: rows[0].name };
    req.sessionId = rows[0].session_id;
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, 'Faça login para continuar.', 'unauthorized'));
  next();
}

/** Proteção CSRF simples: requisições que alteram dados precisam ser JSON vindas do próprio app. */
export function requireJsonForMutations(req: Request, _res: Response, next: NextFunction) {
  // DELETE/PATCH/PUT entre origens já exigem preflight CORS (não permitido); formulários só fazem GET/POST
  if (req.method !== 'POST') return next();
  const ct = req.headers['content-type'] ?? '';
  const xrw = req.headers['x-requested-with'];
  if (!ct.includes('application/json') && xrw !== 'myday') {
    return next(new HttpError(415, 'Envie os dados em JSON.', 'unsupported_media_type'));
  }
  next();
}

export function userId(req: Request) {
  return req.user!.id;
}
