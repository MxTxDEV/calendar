import { migrate } from './migrate.js';
import { pool } from './pool.js';

migrate()
  .then(() => console.log('[migrate] banco atualizado'))
  .catch((err) => {
    console.error('[migrate] falhou', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
