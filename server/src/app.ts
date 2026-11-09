import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { config } from './config.js';
import { pool } from './db/pool.js';
import { errorHandler, HttpError } from './lib/errors.js';
import { loadUser, requireAuth, requireJsonForMutations } from './middleware/auth.js';
import { authRouter } from './routes/auth.js';
import { categoriesRouter } from './routes/categories.js';
import { dashboardRouter } from './routes/dashboard.js';
import { pushRouter } from './routes/push.js';
import { settingsRouter } from './routes/settings.js';
import { subtasksRouter, tasksRouter } from './routes/tasks.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          'style-src': ["'self'", "'unsafe-inline'"],
          'img-src': ["'self'", 'data:'],
          'font-src': ["'self'", 'data:'],
          'connect-src': ["'self'"],
          'worker-src': ["'self'"],
          'manifest-src': ["'self'"],
          'upgrade-insecure-requests': null,
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(express.json({ limit: '200kb' }));
  app.use(cookieParser());

  const api = express.Router();
  api.use((_, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  api.use(requireJsonForMutations);
  api.use(loadUser);

  api.get('/health', async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ ok: true, time: new Date().toISOString() });
  });

  api.use('/auth', authRouter);
  api.use('/push', (req, res, next) => (req.path === '/public-key' ? next() : requireAuth(req, res, next)), pushRouter);
  api.use('/categories', requireAuth, categoriesRouter);
  api.use('/settings', requireAuth, settingsRouter);
  api.use('/dashboard', requireAuth, dashboardRouter);
  api.use('/subtasks', requireAuth, subtasksRouter);
  api.use('/', requireAuth, tasksRouter);
  api.use((_req, _res, next) => next(new HttpError(404, 'Rota não encontrada.', 'not_found')));

  app.use('/api', api);

  // Frontend compilado (produção)
  const index = path.join(config.webDist, 'index.html');
  if (fs.existsSync(index)) {
    app.use(
      express.static(config.webDist, {
        index: false,
        setHeaders(res, file) {
          const base = path.basename(file);
          if (base === 'sw.js' || base === 'manifest.webmanifest') {
            res.setHeader('Cache-Control', 'no-cache');
            if (base === 'sw.js') res.setHeader('Service-Worker-Allowed', '/');
          } else if (file.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        },
      }),
    );
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(index);
    });
  }

  app.use(errorHandler);
  return app;
}
