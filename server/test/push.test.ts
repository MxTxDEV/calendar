import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error sem tipos
import ece from 'http_ece';
import { newUser } from './helpers.js';
import { pool } from '../src/db/pool.js';
import { runTick } from '../src/notifications/scheduler.js';

/**
 * Servidor de push local (HTTPS) que se comporta como FCM/Mozilla/Apple:
 * recebe a requisição do web-push, e o teste descriptografa o payload com as chaves do "navegador".
 */
interface Received { body: Buffer; headers: Record<string, any>; path: string }
const received: Received[] = [];
let respondWith = 201;
let server: https.Server;
let port = 0;

beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'myday-cert-'));
  execSync(`openssl req -x509 -newkey rsa:2048 -nodes -keyout ${dir}/k.pem -out ${dir}/c.pem -days 1 -subj "/CN=127.0.0.1"`, { stdio: 'ignore' });
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  server = https.createServer({ key: fs.readFileSync(`${dir}/k.pem`), cert: fs.readFileSync(`${dir}/c.pem`) }, (req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      received.push({ body: Buffer.concat(chunks), headers: req.headers, path: req.url! });
      res.statusCode = respondWith;
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.close();
  await pool.end();
});

/** Cria um "navegador": par de chaves ECDH P-256 + segredo de autenticação, como o PushManager faz. */
function fakeBrowser(id: string) {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const authSecret = crypto.randomBytes(16);
  const b64 = (b: Buffer) => b.toString('base64url');
  return {
    subscription: {
      endpoint: `https://127.0.0.1:${port}/push/${id}`,
      keys: { p256dh: b64(ecdh.getPublicKey()), auth: b64(authSecret) },
    },
    decrypt(r: Received) {
      const text = ece.decrypt(r.body, { version: 'aes128gcm', privateKey: ecdh, authSecret: b64(authSecret) }).toString('utf8');
      return JSON.parse(text) as { title: string; body: string; kind: string; url: string; tag: string };
    },
  };
}

async function setup(tz = 'America/Sao_Paulo') {
  const u = await newUser(tz);
  const browser = fakeBrowser(crypto.randomUUID());
  const sub = await u.agent.post('/api/push/subscribe').send({ subscription: browser.subscription });
  expect(sub.status).toBe(201);
  const since = received.length;
  return {
    ...u,
    browser,
    pushes: () => received.slice(since).filter((r) => r.path.includes(browser.subscription.endpoint.split('/').pop()!)).map((r) => browser.decrypt(r)),
    raw: () => received.slice(since),
  };
}

// 2026-11-09 é segunda-feira. America/Sao_Paulo = UTC-3 (sem horário de verão).
const at = (iso: string) => new Date(iso);
const task = (agent: any, body: any) => agent.post('/api/tasks').send(body);

describe('notificações push reais', () => {
  it('rejeita endpoints que não são de serviços de push conhecidos (SSRF)', async () => {
    const { agent } = await newUser();
    const r = await agent.post('/api/push/subscribe').send({
      subscription: { endpoint: 'https://servidor-interno.local/x', keys: { p256dh: 'x'.repeat(20), auth: 'y'.repeat(10) } },
    });
    expect(r.status).toBe(400);
  });

  it('resumo diário às 07:00, com as tarefas do dia, enviado uma única vez', async () => {
    const u = await setup();
    await task(u.agent, { title: 'Reunião com fornecedor', date: '2026-11-09', startTime: '08:00', reminders: [] });
    await task(u.agent, { title: 'Revisar planejamento', date: '2026-11-09', startTime: '14:00', reminders: [] });
    await task(u.agent, { title: 'Ligar para o banco', date: '2026-11-09', reminders: [] });
    await task(u.agent, { title: 'Amanhã não entra', date: '2026-11-10', startTime: '09:00', reminders: [] });

    await runTick(at('2026-11-09T09:59:00Z')); // 06:59 — cedo demais
    expect(u.pushes()).toHaveLength(0);

    await runTick(at('2026-11-09T10:00:00Z')); // 07:00
    const [daily] = u.pushes().filter((p) => p.kind === 'daily');
    expect(daily).toBeTruthy();
    expect(daily.title).toBe('Bom dia! ☀️');
    expect(daily.body).toContain('08:00 — Reunião com fornecedor');
    expect(daily.body).toContain('14:00 — Revisar planejamento');
    expect(daily.body).toContain('Durante o dia — Ligar para o banco');
    expect(daily.body).toContain('Você tem 3 tarefas programadas para hoje.');
    expect(daily.body).not.toContain('Amanhã não entra');

    // controle de duplicidade: mesma rodada e rodadas seguintes não reenviam
    await runTick(at('2026-11-09T10:00:00Z'));
    await runTick(at('2026-11-09T10:01:00Z'));
    await runTick(at('2026-11-09T11:30:00Z'));
    expect(u.pushes().filter((p) => p.kind === 'daily')).toHaveLength(1);

    // cabeçalho VAPID presente e payload criptografado (aes128gcm)
    const raw = u.raw()[0];
    expect(raw.headers.authorization).toMatch(/^vapid t=.+, k=.+/);
    expect(raw.headers['content-encoding']).toBe('aes128gcm');
    expect(raw.body.toString('utf8')).not.toContain('Reunião');

    // no dia seguinte envia de novo
    await runTick(at('2026-11-10T10:00:00Z'));
    expect(u.pushes().filter((p) => p.kind === 'daily')).toHaveLength(2);
  });

  it('dia livre', async () => {
    const u = await setup();
    await runTick(at('2026-11-14T10:00:00Z')); // sábado
    const [p] = u.pushes().filter((x) => x.kind === 'daily');
    expect(p.body).toContain('livre de compromissos');
  });

  it('resumo semanal toda segunda às 07:00, de segunda a domingo', async () => {
    const u = await setup();
    await task(u.agent, { title: 'Reunião', date: '2026-11-09', startTime: '09:00', reminders: [] });
    await task(u.agent, { title: 'Finalizar projeto', date: '2026-11-10', reminders: [] });
    await task(u.agent, { title: 'Compromisso pessoal', date: '2026-11-11', reminders: [] });
    await task(u.agent, { title: 'Fechamento da semana', date: '2026-11-13', reminders: [] });
    await task(u.agent, { title: 'Domingo em família', date: '2026-11-15', reminders: [] });
    await task(u.agent, { title: 'Semana seguinte', date: '2026-11-16', reminders: [] });
    await task(u.agent, { title: 'Semana anterior', date: '2026-11-08', reminders: [] });

    await runTick(at('2026-11-09T10:00:00Z'));
    const weekly = u.pushes().find((p) => p.kind === 'weekly')!;
    expect(weekly.title).toBe('🚀 SUA SEMANA COMEÇOU!');
    expect(weekly.body).toContain('SEGUNDA-FEIRA\n• 09:00 Reunião');
    expect(weekly.body).toContain('TERÇA-FEIRA\n• Finalizar projeto');
    expect(weekly.body).toContain('DOMINGO\n• Domingo em família');
    expect(weekly.body).toContain('Você tem 5 atividades programadas nesta semana.');
    expect(weekly.body).not.toContain('Semana seguinte');
    expect(weekly.body).not.toContain('Semana anterior');

    await runTick(at('2026-11-09T10:05:00Z'));
    expect(u.pushes().filter((p) => p.kind === 'weekly')).toHaveLength(1);

    // terça-feira: sem resumo semanal
    await runTick(at('2026-11-10T10:00:00Z'));
    expect(u.pushes().filter((p) => p.kind === 'weekly')).toHaveLength(1);
  });

  it('lembretes individuais no horário certo e sem duplicar', async () => {
    const u = await setup();
    await u.agent.patch('/api/settings').send({ dailyEnabled: false, weeklyEnabled: false });
    await task(u.agent, { title: 'Reunião', date: '2026-11-09', startTime: '08:00', reminders: [15, 60] });

    await runTick(at('2026-11-09T09:59:00Z')); // 06:59 — ainda não é hora de nenhum lembrete
    expect(u.pushes()).toHaveLength(0);

    await runTick(at('2026-11-09T10:00:00Z')); // 07:00 — 1 hora antes
    expect(u.pushes().map((p) => p.body)).toEqual([expect.stringContaining('começa em 1 hora')]);

    await runTick(at('2026-11-09T10:45:00Z')); // 07:45 — 15 minutos antes
    const all = u.pushes();
    expect(all).toHaveLength(2);
    expect(all[1].title).toBe('⏰ Lembrete: Reunião');
    expect(all[1].body).toContain('começa em 15 minutos');
    expect(all[1].kind).toBe('reminder');

    // repetir a mesma rodada ou rodar minutos depois não duplica
    await runTick(at('2026-11-09T10:45:00Z'));
    await runTick(at('2026-11-09T10:46:00Z'));
    await runTick(at('2026-11-09T11:00:00Z')); // 08:00 — tarefa já começou
    expect(u.pushes()).toHaveLength(2);
  });

  it('não envia lembrete muito atrasado (> 10 min)', async () => {
    const u = await setup();
    await u.agent.patch('/api/settings').send({ dailyEnabled: false, weeklyEnabled: false });
    await task(u.agent, { title: 'Reunião', date: '2026-11-09', startTime: '08:00', reminders: [15] });
    await runTick(at('2026-11-09T10:57:00Z')); // 07:57, lembrete era 07:45
    expect(u.pushes()).toHaveLength(0);
  });

  it('lembrete de 1 dia antes e reagendamento gera novo lembrete', async () => {
    const u = await setup();
    await u.agent.patch('/api/settings').send({ dailyEnabled: false, weeklyEnabled: false });
    const t = (await task(u.agent, { title: 'Consulta', date: '2026-11-10', startTime: '15:00', reminders: [1440] })).body.task;
    await runTick(at('2026-11-09T18:00:00Z')); // 15:00 do dia 09
    expect(u.pushes()).toHaveLength(1);
    expect(u.pushes()[0].body).toContain('amanhã às 15:00');

    await u.agent.post(`/api/tasks/${t.id}/reschedule`).send({ date: '2026-11-11', startTime: '15:00' });
    await runTick(at('2026-11-10T18:00:00Z'));
    expect(u.pushes()).toHaveLength(2);
  });

  it('tarefa concluída não gera lembrete; tarefa sem horário usa o horário padrão', async () => {
    const u = await setup();
    await u.agent.patch('/api/settings').send({ dailyEnabled: false, weeklyEnabled: false, alldayReminderTime: '09:00' });
    const done = (await task(u.agent, { title: 'Já feita', date: '2026-11-09', startTime: '12:00', reminders: [15] })).body.task;
    await u.agent.post(`/api/tasks/${done.id}/status`).send({ status: 'done' });
    await task(u.agent, { title: 'Pagar boleto', date: '2026-11-09', reminders: [0] });

    await runTick(at('2026-11-09T14:45:00Z')); // 11:45
    expect(u.pushes()).toHaveLength(0);
    await runTick(at('2026-11-09T12:00:00Z')); // 09:00 local
    expect(u.pushes()).toHaveLength(1);
    expect(u.pushes()[0].body).toContain('Pagar boleto');
  });

  it('lembrete em ocorrência de tarefa recorrente', async () => {
    const u = await setup();
    await u.agent.patch('/api/settings').send({ dailyEnabled: false, weeklyEnabled: false });
    await task(u.agent, { title: 'Academia', date: '2026-11-02', startTime: '18:00', reminders: [30], recurrence: { freq: 'daily' } });
    await runTick(at('2026-11-09T20:30:00Z')); // 17:30 local
    await runTick(at('2026-11-10T20:30:00Z'));
    expect(u.pushes()).toHaveLength(2);
  });

  it('respeita o fuso horário configurado', async () => {
    const u = await setup('Europe/Lisbon'); // UTC+0 em novembro
    await task(u.agent, { title: 'Reunião em Lisboa', date: '2026-11-09', startTime: '09:00', reminders: [] });
    await runTick(at('2026-11-09T10:00:00Z')); // 07:00 em São Paulo, mas 10:00 em Lisboa
    expect(u.pushes()).toHaveLength(0);
    await runTick(at('2026-11-09T07:00:00Z')); // 07:00 em Lisboa
    expect(u.pushes().filter((p) => p.kind === 'daily')).toHaveLength(1);
  });

  it('respeita horário e desativação nas configurações', async () => {
    const u = await setup();
    await u.agent.patch('/api/settings').send({ dailyTime: '06:30', weeklyEnabled: false });
    await runTick(at('2026-11-09T09:30:00Z')); // 06:30
    expect(u.pushes().map((p) => p.kind)).toEqual(['daily']);
    const off = await setup();
    await off.agent.patch('/api/settings').send({ dailyEnabled: false, weeklyEnabled: false });
    await runTick(at('2026-11-16T10:00:00Z'));
    expect(off.pushes()).toHaveLength(0);
  });

  it('recupera resumo se o servidor ficou fora do ar por pouco tempo', async () => {
    const u = await setup();
    await runTick(at('2026-11-09T11:30:00Z')); // 08:30, servidor voltou 1h30 depois das 07:00
    expect(u.pushes().filter((p) => p.kind === 'daily')).toHaveLength(1);
  });

  it('remove inscrições expiradas (410) e permite nova tentativa quando o envio falha', async () => {
    const u = await setup();
    respondWith = 500;
    await runTick(at('2026-11-09T10:00:00Z'));
    let log = await pool.query(`SELECT status, attempts FROM notification_log WHERE user_id = $1 AND kind = 'daily'`, [u.user.id]);
    expect(log.rows[0]).toMatchObject({ status: 'failed', attempts: 1 });

    respondWith = 201;
    await runTick(at('2026-11-09T10:01:00Z')); // nova tentativa
    log = await pool.query(`SELECT status, attempts FROM notification_log WHERE user_id = $1 AND kind = 'daily'`, [u.user.id]);
    expect(log.rows[0]).toMatchObject({ status: 'sent', attempts: 2 });

    respondWith = 410;
    const r = await u.agent.post('/api/push/test').send({ type: 'simple' });
    respondWith = 201;
    expect(r.body.result.status).toBe('failed');
    const subs = await u.agent.get('/api/push/subscriptions');
    expect(subs.body.subscriptions).toHaveLength(0);
  });

  it('botão de teste e histórico', async () => {
    const u = await setup();
    const r = await u.agent.post('/api/push/test').send({ type: 'simple' });
    expect(r.body.result).toMatchObject({ status: 'sent', delivered: 1 });
    expect(u.pushes()[0].title).toContain('MyDay');
    const d = await u.agent.post('/api/push/test').send({ type: 'daily' });
    expect(d.body.result.status).toBe('sent');
    const h = await u.agent.get('/api/push/history');
    expect(h.body.history.length).toBe(2);
  });

  it('entrega em vários dispositivos (sincronização entre aparelhos)', async () => {
    const u = await setup();
    const second = fakeBrowser(crypto.randomUUID());
    await u.agent.post('/api/push/subscribe').send({ subscription: second.subscription });
    await runTick(at('2026-11-09T10:00:00Z'));
    expect(u.pushes().filter((p) => p.kind === 'daily')).toHaveLength(1);
    const toSecond = received.filter((r) => r.path.endsWith(second.subscription.endpoint.split('/').pop()!));
    expect(second.decrypt(toSecond[0]).kind).toBe('daily');
  });
});
