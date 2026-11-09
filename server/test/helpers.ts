import request from 'supertest';
import { createApp } from '../src/app.js';

export const app = createApp();

let n = 0;
export async function newUser(tz = 'America/Sao_Paulo') {
  const agent = request.agent(app);
  const email = `user${Date.now()}${n++}@teste.com`;
  const res = await agent.post('/api/auth/register').send({ name: 'Teste', email, password: 'senha-segura-123', timezone: tz });
  if (res.status !== 201) throw new Error(`registro falhou: ${res.status} ${JSON.stringify(res.body)}`);
  return { agent, user: res.body.user as { id: string; email: string }, email };
}
