// Função serverless da Vercel: executa o app Express compilado (server/dist).
import { createApp } from '../server/dist/app.js';
import { migrate } from '../server/dist/db/migrate.js';
import { initSecrets } from '../server/dist/lib/secrets.js';

const app = createApp();
let ready = null;

export default async function handler(req, res) {
  try {
    // migrações são idempotentes; rodam uma vez por instância fria
    ready ??= migrate(false).then(() => initSecrets()).catch((err) => {
      ready = null;
      throw err;
    });
    await ready;
  } catch (err) {
    console.error('[api] banco de dados indisponível', err);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Banco de dados indisponível. Verifique a variável DATABASE_URL.', code: 'db_unavailable' }));
    return;
  }
  return app(req, res);
}
