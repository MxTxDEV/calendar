import pg from 'pg';

export default async function setup() {
  process.env.NODE_ENV = 'test';
  const url = process.env.TEST_DATABASE_URL ?? 'postgres://myday:myday@localhost:5432/myday_test';
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  // banco de testes limpo a cada execução
  await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await client.end();
  const { migrate } = await import('../src/db/migrate.js');
  const { pool } = await import('../src/db/pool.js');
  await migrate(false);
  await pool.end();
}
