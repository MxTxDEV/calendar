import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// .env do diretório atual e, se existir, o da raiz do repositório (sem sobrescrever variáveis já definidas)
dotenv.config({ quiet: true } as any);
dotenv.config({ path: path.resolve(here, '../../.env'), quiet: true } as any);
dotenv.config({ path: path.resolve(here, '../../../.env'), quiet: true } as any);

function bool(v: string | undefined, def: boolean) {
  if (v === undefined || v === '') return def;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

const env = process.env.NODE_ENV ?? 'development';

export const config = {
  env,
  isProd: env === 'production',
  isTest: env === 'test',
  port: Number(process.env.PORT ?? 3000),
  appUrl: (process.env.APP_URL ?? 'http://localhost:5173').replace(/\/$/, ''),
  // Na Vercel/Neon a URL costuma vir como DATABASE_URL ou POSTGRES_URL
  databaseUrl:
    env === 'test'
      ? process.env.TEST_DATABASE_URL ?? 'postgres://myday:myday@localhost:5432/myday_test'
      : process.env.DATABASE_URL ??
        process.env.POSTGRES_URL ??
        process.env.POSTGRES_PRISMA_URL ??
        'postgres://myday:myday@localhost:5432/myday',
  serverless: !!process.env.VERCEL,
  /** Segredo para o endpoint /api/cron/tick (chamado por Vercel Cron ou um agendador externo) */
  cronSecret: process.env.CRON_SECRET ?? '',
  databaseSsl: bool(process.env.DATABASE_SSL, false),
  sessionSecret: process.env.SESSION_SECRET ?? '',
  sessionDays: Number(process.env.SESSION_DAYS ?? 60),
  allowSignup: bool(process.env.ALLOW_SIGNUP, true),
  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY ?? '',
    privateKey: process.env.VAPID_PRIVATE_KEY ?? '',
    subject: process.env.VAPID_SUBJECT ?? 'mailto:admin@example.com',
  },
  schedulerEnabled: bool(process.env.SCHEDULER_ENABLED, true),
  defaultTimezone: process.env.DEFAULT_TIMEZONE ?? 'America/Sao_Paulo',
  // Diretório do frontend compilado (servido em produção)
  webDist: process.env.WEB_DIST ?? path.resolve(here, '../../web/dist'),
};

export function assertProductionConfig() {
  if (!config.isProd) return;
  if (!config.sessionSecret || config.sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET precisa ter pelo menos 32 caracteres em produção.');
  }
  if (!config.vapid.publicKey || !config.vapid.privateKey) {
    console.warn('[config] Chaves VAPID ausentes: notificações push ficarão desativadas. Rode `npm run vapid`.');
  }
}
