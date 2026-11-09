import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, newUser } from './helpers.js';
import { pool } from '../src/db/pool.js';

afterAll(() => pool.end());

describe('autenticação', () => {
  it('cadastro, sessão, logout e login', async () => {
    const { agent, email } = await newUser();
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(email);

    await agent.post('/api/auth/logout').send({});
    expect((await agent.get('/api/auth/me')).status).toBe(401);

    const bad = await agent.post('/api/auth/login').send({ email, password: 'errada-123' });
    expect(bad.status).toBe(401);
    const ok = await agent.post('/api/auth/login').send({ email, password: 'senha-segura-123' });
    expect(ok.status).toBe(200);
    expect((await agent.get('/api/auth/me')).status).toBe(200);
  });

  it('cookie de sessão é httpOnly', async () => {
    const res = await request(app).post('/api/auth/register').send({ name: 'X', email: `c${Date.now()}@t.com`, password: 'senha-segura-123' });
    expect(res.headers['set-cookie'][0]).toMatch(/HttpOnly/i);
  });

  it('e-mail duplicado e senha fraca', async () => {
    const { email } = await newUser();
    const dup = await request(app).post('/api/auth/register').send({ name: 'X', email: email.toUpperCase(), password: 'senha-segura-123' });
    expect(dup.status).toBe(409);
    const weak = await request(app).post('/api/auth/register').send({ name: 'X', email: 'w@t.com', password: '123' });
    expect(weak.status).toBe(400);
  });

  it('rotas protegidas exigem login e mutações exigem JSON', async () => {
    expect((await request(app).get('/api/dashboard')).status).toBe(401);
    const form = await request(app).post('/api/tasks').type('form').send('title=x');
    expect(form.status).toBe(415);
  });

  it('cria categorias e configurações padrão', async () => {
    const { agent } = await newUser();
    const cats = await agent.get('/api/categories');
    expect(cats.body.categories.map((c: any) => c.name)).toEqual([
      'Trabalho', 'Pessoal', 'Financeiro', 'Saúde', 'Estudos', 'Projetos', 'Família', 'Outros',
    ]);
    const s = await agent.get('/api/settings');
    expect(s.body.settings).toMatchObject({ timezone: 'America/Sao_Paulo', dailyTime: '07:00', weeklyDay: 1, weeklyTime: '07:00', dailyEnabled: true });
  });
});

describe('tarefas', () => {
  it('cadastro, edição, conclusão e exclusão', async () => {
    const { agent } = await newUser();
    const cats = (await agent.get('/api/categories')).body.categories;
    const created = await agent.post('/api/tasks').send({
      title: 'Reunião com fornecedor',
      description: 'Levar proposta',
      date: '2026-11-10',
      startTime: '08:00',
      endTime: '09:00',
      categoryId: cats[0].id,
      priority: 'high',
      reminders: [15, 60],
      subtasks: [{ title: 'Imprimir contrato' }],
    });
    expect(created.status).toBe(201);
    const t = created.body.task;
    expect(t).toMatchObject({ title: 'Reunião com fornecedor', startTime: '08:00', endTime: '09:00', priority: 'high', status: 'pending', reminders: [15, 60], allDay: false });
    expect(t.subtasks).toHaveLength(1);

    const edited = await agent.patch(`/api/tasks/${t.id}`).send({ title: 'Reunião (editada)', startTime: '10:00', endTime: '11:30' });
    expect(edited.status).toBe(200);
    expect(edited.body.task).toMatchObject({ title: 'Reunião (editada)', startTime: '10:00', endTime: '11:30' });

    const done = await agent.post(`/api/tasks/${t.id}/status`).send({ status: 'done' });
    expect(done.body.task.status).toBe('done');
    expect(done.body.task.completedAt).toBeTruthy();

    const list = await agent.get('/api/occurrences?from=2026-11-01&to=2026-11-30');
    expect(list.body.occurrences).toHaveLength(1);

    expect((await agent.delete(`/api/tasks/${t.id}`)).status).toBe(200);
    expect((await agent.get(`/api/tasks/${t.id}`)).status).toBe(404);
  });

  it('tarefa sem horário e lembretes padrão das configurações', async () => {
    const { agent } = await newUser();
    await agent.patch('/api/settings').send({ defaultReminders: [30, 5] });
    const r = await agent.post('/api/tasks').send({ title: 'Pagar contas', date: '2026-11-10' });
    expect(r.body.task).toMatchObject({ allDay: true, startTime: null, reminders: [5, 30] });
  });

  it('validações', async () => {
    const { agent } = await newUser();
    expect((await agent.post('/api/tasks').send({ date: '2026-11-10' })).status).toBe(400);
    expect((await agent.post('/api/tasks').send({ title: 'x', date: '10/11/2026' })).status).toBe(400);
    expect((await agent.post('/api/tasks').send({ title: 'x', date: '2026-11-10', startTime: '10:00', endTime: '09:00' })).status).toBe(400);
    expect((await agent.post('/api/tasks').send({ title: 'x', date: '2026-11-10', priority: 'altissima' })).status).toBe(400);
  });

  it('duplicar e reagendar', async () => {
    const { agent } = await newUser();
    const t = (await agent.post('/api/tasks').send({ title: 'Relatório', date: '2026-11-10', startTime: '14:00', subtasks: [{ title: 'a', done: true }] })).body.task;
    const dup = await agent.post(`/api/tasks/${t.id}/duplicate`).send({});
    expect(dup.status).toBe(201);
    expect(dup.body.task.title).toBe('Relatório (cópia)');
    expect(dup.body.task.subtasks[0].done).toBe(false);

    const rs = await agent.post(`/api/tasks/${t.id}/reschedule`).send({ date: '2026-11-12', startTime: '16:00', endTime: null });
    expect(rs.body.task).toMatchObject({ date: '2026-11-12', startTime: '16:00' });
  });

  it('subtarefas', async () => {
    const { agent } = await newUser();
    const t = (await agent.post('/api/tasks').send({ title: 'Projeto', date: '2026-11-10' })).body.task;
    const s = await agent.post(`/api/tasks/${t.id}/subtasks`).send({ title: 'Etapa 1' });
    expect(s.status).toBe(201);
    const upd = await agent.patch(`/api/subtasks/${s.body.subtask.id}`).send({ done: true });
    expect(upd.body.subtask.done).toBe(true);
    expect((await agent.get(`/api/tasks/${t.id}`)).body.task.subtasks[0].done).toBe(true);
    expect((await agent.delete(`/api/subtasks/${s.body.subtask.id}`)).status).toBe(200);
  });

  it('isolamento entre usuários', async () => {
    const a = await newUser();
    const b = await newUser();
    const t = (await a.agent.post('/api/tasks').send({ title: 'Privada', date: '2026-11-10' })).body.task;
    expect((await b.agent.get(`/api/tasks/${t.id}`)).status).toBe(404);
    expect((await b.agent.patch(`/api/tasks/${t.id}`).send({ title: 'hack' })).status).toBe(404);
    expect((await b.agent.delete(`/api/tasks/${t.id}`)).status).toBe(404);
    expect((await b.agent.get('/api/occurrences?from=2026-11-01&to=2026-11-30')).body.occurrences).toHaveLength(0);
    const catA = (await a.agent.get('/api/categories')).body.categories[0];
    expect((await b.agent.post('/api/tasks').send({ title: 'x', date: '2026-11-10', categoryId: catA.id })).status).toBe(400);
  });
});

describe('recorrência', () => {
  async function weekly() {
    const u = await newUser();
    const created = (
      await u.agent.post('/api/tasks').send({
        title: 'Academia',
        date: '2026-11-09',
        startTime: '18:00',
        recurrence: { freq: 'weekly', byWeekday: [1, 3, 5] },
      })
    ).body.task;
    // em tarefas recorrentes, `id` é composto (tarefa:data); as rotas usam `taskId`
    const t = { ...created, id: created.taskId };
    const occ = async (from = '2026-11-09', to = '2026-11-22') =>
      (await u.agent.get(`/api/occurrences?from=${from}&to=${to}`)).body.occurrences as any[];
    return { ...u, t, occ };
  }

  it('expande ocorrências no calendário', async () => {
    const { occ } = await weekly();
    expect((await occ()).map((o) => o.date)).toEqual(['2026-11-09', '2026-11-11', '2026-11-13', '2026-11-16', '2026-11-18', '2026-11-20']);
  });

  it('conclui somente uma ocorrência', async () => {
    const { agent, t, occ } = await weekly();
    const r = await agent.post(`/api/tasks/${t.id}/status`).send({ status: 'done', occurrenceDate: '2026-11-11' });
    expect(r.status).toBe(200);
    const list = await occ();
    expect(list.find((o) => o.date === '2026-11-11').status).toBe('done');
    expect(list.filter((o) => o.status === 'done')).toHaveLength(1);
    // ocorrência inexistente
    expect((await agent.post(`/api/tasks/${t.id}/status`).send({ status: 'done', occurrenceDate: '2026-11-12' })).status).toBe(400);
  });

  it('exclui somente uma ocorrência e "esta e as próximas"', async () => {
    const { agent, t, occ } = await weekly();
    await agent.delete(`/api/tasks/${t.id}?scope=this&occurrenceDate=2026-11-11`);
    expect((await occ()).map((o) => o.date)).not.toContain('2026-11-11');
    await agent.delete(`/api/tasks/${t.id}?scope=following&occurrenceDate=2026-11-16`);
    expect((await occ()).map((o) => o.date)).toEqual(['2026-11-09', '2026-11-13']);
  });

  it('reagenda uma ocorrência para outra semana', async () => {
    const { agent, t, occ } = await weekly();
    const r = await agent.post(`/api/tasks/${t.id}/reschedule`).send({ occurrenceDate: '2026-11-13', date: '2026-11-28', startTime: '09:00' });
    expect(r.status).toBe(200);
    expect((await occ()).map((o) => o.date)).not.toContain('2026-11-13');
    const later = await occ('2026-11-28', '2026-11-28');
    expect(later).toHaveLength(1);
    expect(later[0]).toMatchObject({ date: '2026-11-28', originalDate: '2026-11-13', startTime: '09:00', rescheduled: true });
  });

  it('edita somente esta ocorrência (vira tarefa avulsa)', async () => {
    const { agent, t, occ } = await weekly();
    const r = await agent.patch(`/api/tasks/${t.id}`).send({ scope: 'this', occurrenceDate: '2026-11-11', title: 'Academia (perna)' });
    expect(r.status).toBe(200);
    expect(r.body.task.recurring).toBe(false);
    const list = await occ();
    expect(list.filter((o) => o.date === '2026-11-11').map((o) => o.title)).toEqual(['Academia (perna)']);
    expect(list.filter((o) => o.title === 'Academia')).toHaveLength(5);
  });

  it('edita esta e as próximas (divide a série)', async () => {
    const { agent, t, occ } = await weekly();
    const r = await agent.patch(`/api/tasks/${t.id}`).send({ scope: 'following', occurrenceDate: '2026-11-16', startTime: '07:00' });
    expect(r.status).toBe(200);
    const list = await occ();
    expect(list.map((o) => `${o.date} ${o.startTime}`)).toEqual([
      '2026-11-09 18:00', '2026-11-11 18:00', '2026-11-13 18:00', '2026-11-16 07:00', '2026-11-18 07:00', '2026-11-20 07:00',
    ]);
  });

  it('edita a série toda', async () => {
    const { agent, t, occ } = await weekly();
    await agent.patch(`/api/tasks/${t.id}`).send({ scope: 'all', title: 'Treino' });
    expect((await occ()).every((o) => o.title === 'Treino')).toBe(true);
  });

  it('recorrências: diária, mensal e personalizada', async () => {
    const { agent } = await newUser();
    await agent.post('/api/tasks').send({ title: 'Remédio', date: '2026-11-01', startTime: '08:00', recurrence: { freq: 'daily' } });
    await agent.post('/api/tasks').send({ title: 'Aluguel', date: '2026-10-05', recurrence: { freq: 'monthly' } });
    await agent.post('/api/tasks').send({ title: 'Backup', date: '2026-11-02', recurrence: { freq: 'daily', interval: 3, count: 4 } });
    const list = (await agent.get('/api/occurrences?from=2026-11-01&to=2026-11-30')).body.occurrences as any[];
    expect(list.filter((o) => o.title === 'Remédio')).toHaveLength(30);
    expect(list.filter((o) => o.title === 'Aluguel').map((o) => o.date)).toEqual(['2026-11-05']);
    expect(list.filter((o) => o.title === 'Backup').map((o) => o.date)).toEqual(['2026-11-02', '2026-11-05', '2026-11-08', '2026-11-11']);
  });
});

describe('dashboard e configurações', () => {
  it('indicadores do dia', async () => {
    const { agent } = await newUser();
    const today = (await agent.get('/api/dashboard')).body.today as string;
    const d = (n: number) => new Date(Date.parse(today) + n * 86400000).toISOString().slice(0, 10);
    const a = (await agent.post('/api/tasks').send({ title: 'A', date: today, startTime: '23:58' })).body.task;
    await agent.post('/api/tasks').send({ title: 'B', date: today });
    await agent.post('/api/tasks').send({ title: 'Atrasada', date: d(-2) });
    await agent.post('/api/tasks').send({ title: 'Futura', date: d(2), startTime: '10:00' });
    await agent.post(`/api/tasks/${a.id}/status`).send({ status: 'done' });

    const dash = (await agent.get('/api/dashboard')).body;
    expect(dash.stats).toMatchObject({ total: 2, done: 1, pending: 1, progress: 50 });
    expect(dash.overdue.map((o: any) => o.title)).toEqual(['Atrasada']);
    expect(dash.upcoming.map((o: any) => o.title)).toEqual(['Futura']);
    expect(dash.next.title).toBe('Futura');
    expect(dash.todayList).toHaveLength(2);
  });

  it('atualiza configurações e rejeita fuso inválido', async () => {
    const { agent } = await newUser();
    const r = await agent.patch('/api/settings').send({ dailyTime: '06:30', weeklyEnabled: false, timezone: 'Europe/Lisbon', theme: 'dark' });
    expect(r.body.settings).toMatchObject({ dailyTime: '06:30', weeklyEnabled: false, timezone: 'Europe/Lisbon', theme: 'dark' });
    expect((await agent.patch('/api/settings').send({ timezone: 'Marte/Base' })).status).toBe(400);
    expect((await agent.patch('/api/settings').send({ dailyTime: '25:00' })).status).toBe(400);
  });

  it('CRUD de categorias', async () => {
    const { agent } = await newUser();
    const c = await agent.post('/api/categories').send({ name: 'Viagens', color: '#ff8800', icon: 'plane' });
    expect(c.status).toBe(201);
    const t = (await agent.post('/api/tasks').send({ title: 'x', date: '2026-11-10', categoryId: c.body.category.id })).body.task;
    await agent.patch(`/api/categories/${c.body.category.id}`).send({ name: 'Viagem' });
    await agent.delete(`/api/categories/${c.body.category.id}`);
    // a tarefa permanece, sem categoria
    expect((await agent.get(`/api/tasks/${t.id}`)).body.task.categoryId).toBeNull();
  });
});
