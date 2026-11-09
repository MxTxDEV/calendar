import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './pool.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

/**
 * Aplica migrações pendentes. Usa trava de transação (pg_advisory_xact_lock), que funciona
 * mesmo atrás de pools de conexão (Neon/PgBouncer) e com várias instâncias iniciando juntas.
 */
export async function migrate(log = true) {
  await pool
    .query(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`)
    .catch(() => {}); // corrida entre instâncias: a tabela já existe
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = await fs.readFile(path.join(dir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(727274)');
      const done = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [file]);
      if (!done.rowCount) {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        if (log) console.log(`[migrate] aplicada ${file}`);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
}
