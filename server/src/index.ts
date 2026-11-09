import { createApp } from './app.js';
import { assertProductionConfig, config } from './config.js';
import { migrate } from './db/migrate.js';
import { pool } from './db/pool.js';
import { initSecrets } from './lib/secrets.js';
import { pushEnabled } from './notifications/push.js';
import { startScheduler, stopScheduler } from './notifications/scheduler.js';

async function main() {
  await migrate();
  await initSecrets();
  assertProductionConfig();
  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`[myday] servidor em http://localhost:${config.port} (${config.env})`);
    console.log(`[myday] push ${pushEnabled() ? 'ativado' : 'DESATIVADO (configure VAPID)'}`);
  });
  if (config.schedulerEnabled) startScheduler();

  const shutdown = (signal: string) => {
    console.log(`[myday] ${signal} recebido, encerrando…`);
    stopScheduler();
    server.close(() => pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[myday] falha ao iniciar', err);
  process.exit(1);
});
