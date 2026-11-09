import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config.js';
import { query, withTransaction } from '../db/pool.js';
import { HttpError } from '../lib/errors.js';
import { DEFAULT_CATEGORIES } from '../lib/categories-default.js';
import { isValidTimezone } from '../lib/time.js';
import { createSession, destroySession, requireAuth, userId } from '../middleware/auth.js';

export const authRouter = Router();

const limiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: config.isTest ? 1000 : 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Muitas tentativas. Aguarde alguns minutos.', code: 'rate_limited' },
});

const registerSchema = z.object({
  name: z.string().trim().min(1, 'Informe seu nome.').max(80),
  email: z.string().trim().toLowerCase().email('E-mail inválido.').max(200),
  password: z.string().min(8, 'A senha precisa ter pelo menos 8 caracteres.').max(200),
  timezone: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('E-mail inválido.'),
  password: z.string().min(1).max(200),
});

authRouter.post('/register', limiter, async (req, res) => {
  if (!config.allowSignup) {
    const { rows } = await query('SELECT count(*)::int AS n FROM users');
    if (rows[0].n > 0) throw new HttpError(403, 'Novos cadastros estão desativados.', 'signup_disabled');
  }
  const body = registerSchema.parse(req.body);
  const tz = body.timezone && isValidTimezone(body.timezone) ? body.timezone : config.defaultTimezone;
  const hash = await bcrypt.hash(body.password, 12);
  const user = await withTransaction(async (db) => {
    const exists = await db.query('SELECT 1 FROM users WHERE lower(email) = $1', [body.email]);
    if (exists.rowCount) throw new HttpError(409, 'Já existe uma conta com este e-mail.', 'email_taken');
    const { rows } = await db.query(
      'INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id, email, name',
      [body.email, body.name, hash],
    );
    const u = rows[0];
    await db.query('INSERT INTO user_settings (user_id, timezone) VALUES ($1, $2)', [u.id, tz]);
    for (const [i, c] of DEFAULT_CATEGORIES.entries()) {
      await db.query('INSERT INTO categories (user_id, name, color, icon, position) VALUES ($1,$2,$3,$4,$5)', [
        u.id,
        c.name,
        c.color,
        c.icon,
        i,
      ]);
    }
    return u;
  });
  await createSession(res, user.id, req.headers['user-agent']);
  res.status(201).json({ user });
});

authRouter.post('/login', limiter, async (req, res) => {
  const body = loginSchema.parse(req.body);
  const { rows } = await query('SELECT id, email, name, password_hash FROM users WHERE lower(email) = $1', [body.email]);
  const u = rows[0];
  // compara mesmo quando o usuário não existe, para não vazar informação pelo tempo de resposta
  const ok = await bcrypt.compare(body.password, u?.password_hash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva');
  if (!u || !ok) throw new HttpError(401, 'E-mail ou senha incorretos.', 'invalid_credentials');
  await createSession(res, u.id, req.headers['user-agent']);
  res.json({ user: { id: u.id, email: u.email, name: u.name } });
});

authRouter.post('/logout', async (req, res) => {
  await destroySession(req, res);
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

authRouter.get('/config', (_req, res) => {
  res.json({ allowSignup: config.allowSignup });
});

const passwordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'A nova senha precisa ter pelo menos 8 caracteres.').max(200),
});

authRouter.post('/password', requireAuth, limiter, async (req, res) => {
  const body = passwordSchema.parse(req.body);
  const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [userId(req)]);
  if (!(await bcrypt.compare(body.currentPassword, rows[0].password_hash))) {
    throw new HttpError(400, 'Senha atual incorreta.', 'invalid_password');
  }
  await query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [
    await bcrypt.hash(body.newPassword, 12),
    userId(req),
  ]);
  // encerra as outras sessões
  await query('DELETE FROM sessions WHERE user_id = $1 AND id <> $2', [userId(req), req.sessionId]);
  res.json({ ok: true });
});
