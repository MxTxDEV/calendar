import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { pool } from '../src/db/pool.js';

afterAll(() => pool.end());

describe('endpoint do agendador', () => {
  it('fica oculto (404) sem CRON_SECRET configurado', async () => {
    const { config } = await import('../src/config.js');
    config.cronSecret = '';
    const { app } = await import('./helpers.js');
    expect((await request(app).get('/api/cron/tick')).status).toBe(404);
  });

  it('exige a chave e executa uma rodada com ela', async () => {
    const { config } = await import('../src/config.js');
    config.cronSecret = 'segredo-de-teste-123';
    const { app } = await import('./helpers.js');
    expect((await request(app).get('/api/cron/tick')).status).toBe(401);
    expect((await request(app).get('/api/cron/tick?key=errada')).status).toBe(401);
    const bearer = await request(app).get('/api/cron/tick').set('Authorization', 'Bearer segredo-de-teste-123');
    expect(bearer.status).toBe(200);
    expect(bearer.body.ok).toBe(true);
    expect((await request(app).get('/api/cron/tick?key=segredo-de-teste-123')).status).toBe(200);
  });
});
