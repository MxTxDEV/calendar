import { Link } from 'react-router-dom';
import { AlertTriangle, BellRing, CalendarCheck, CalendarX2, Clock, Sparkles } from 'lucide-react';
import { TaskItem } from '../components/TaskItem';
import { cap, greeting, longDate, relativeDay, timeRange } from '../lib/dates';
import { useCategoryMap, usePushState, useToggleDone } from '../lib/hooks';
import { useDashboard, useMe } from '../lib/queries';
import { useUI } from '../lib/ui';
import type { Occurrence } from '../lib/types';

function Group({ title, items, today, empty, showDate }: { title: string; items: Occurrence[]; today: string; empty?: React.ReactNode; showDate?: boolean }) {
  const cats = useCategoryMap();
  const toggle = useToggleDone();
  const { openView } = useUI();
  void today;
  return (
    <div className="card list">
      {items.length === 0 ? empty : items.map((t, i) => (
        <TaskItem key={t.id} index={i} task={t} category={t.categoryId ? cats.get(t.categoryId) : undefined}
          showDate={showDate ? relativeDay(t.date, today) : undefined} onOpen={() => openView(t)} onToggle={() => toggle(t)} />
      ))}
      <span hidden>{title}</span>
    </div>
  );
}

export function DashboardPage() {
  const { data: dash, isLoading, error } = useDashboard();
  const { data: me } = useMe();
  const { openNewTask, openView } = useUI();
  const push = usePushState();

  if (isLoading) {
    return <div className="col" style={{ gap: 14 }}><div className="skeleton" style={{ height: 36, width: 220 }} /><div className="skeleton" style={{ height: 130 }} /><div className="skeleton" style={{ height: 220 }} /></div>;
  }
  if (error || !dash) return <div className="empty card">Não foi possível carregar seus dados. Tente novamente.</div>;

  const hour = Number(dash.now.slice(11, 13));
  const { stats } = dash;
  const upcomingByDay = dash.upcoming.reduce<Record<string, Occurrence[]>>((acc, o) => ((acc[o.date] ??= []).push(o), acc), {});

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">{longDate(dash.today)}</div>
          <h1>{greeting(hour)}, {me?.name.split(' ')[0]}!</h1>
        </div>
      </div>

      {(push === 'off' || push === 'ios-install') && (
        <Link to="/notificacoes" className="banner" style={{ marginBottom: 16, color: 'inherit' }}>
          <BellRing size={22} color="var(--accent)" />
          <div className="grow">
            <b>Ative as notificações</b>
            <div className="small muted">{push === 'ios-install' ? 'Instale o app na Tela de Início para receber lembretes no iPhone.' : 'Receba o resumo do dia e lembretes mesmo com o app fechado.'}</div>
          </div>
          <span className="btn sm primary">Ativar</span>
        </Link>
      )}

      <div className="card hero">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div>
            <div className="eyebrow">Progresso de hoje</div>
            <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-0.03em' }} className="nums">{stats.progress}%</div>
          </div>
          <div className="muted small">{stats.done} de {stats.total} concluídas</div>
        </div>
        <div className="progress" role="progressbar" aria-valuenow={stats.progress} aria-valuemin={0} aria-valuemax={100}><div style={{ width: `${stats.progress}%` }} /></div>
        {dash.next ? (
          <button className="next-card" style={{ border: 0, textAlign: 'left', width: '100%' }} onClick={() => openView(dash.next)}>
            <Clock size={20} color="var(--accent)" />
            <div className="grow">
              <div className="xs muted">Próximo compromisso · {relativeDay(dash.next.date, dash.today)}, {timeRange(dash.next)}</div>
              <div style={{ fontWeight: 600 }}>{dash.next.title}</div>
            </div>
          </button>
        ) : (
          <div className="next-card"><Sparkles size={20} color="var(--accent)" /><span className="muted">Nenhum compromisso com horário pela frente.</span></div>
        )}
      </div>

      <div className="stats" style={{ marginTop: 12 }}>
        <div className="card stat"><div className="num">{stats.total}</div><div className="lbl">Tarefas hoje</div></div>
        <div className="card stat"><div className="num" style={{ color: 'var(--success)' }}>{stats.done}</div><div className="lbl">Concluídas</div></div>
        <div className="card stat"><div className="num">{stats.pending}</div><div className="lbl">Pendentes</div></div>
        <div className="card stat"><div className="num" style={{ color: stats.overdue ? 'var(--danger)' : undefined }}>{stats.overdue}</div><div className="lbl">Atrasadas</div></div>
      </div>

      {dash.overdue.length > 0 && (
        <section className="section">
          <div className="section-head"><h2 className="row" style={{ color: 'var(--danger)' }}><AlertTriangle size={18} /> Atrasadas</h2><span className="badge danger">{dash.overdue.length}</span></div>
          <Group title="Atrasadas" items={dash.overdue.map((o) => ({ ...o, overdue: true }))} today={dash.today} showDate />
        </section>
      )}

      <section className="section">
        <div className="section-head"><h2>Minha programação de hoje</h2></div>
        <Group title="Hoje" items={dash.todayList} today={dash.today} empty={
          <div className="empty"><div className="ico"><CalendarCheck size={22} /></div><b>Dia livre!</b><p className="small">Nenhum compromisso cadastrado para hoje.</p>
            <button className="btn primary sm" style={{ marginTop: 12 }} onClick={() => openNewTask()}>+ Nova tarefa</button></div>} />
      </section>

      <section className="section">
        <div className="section-head"><h2>Próximos dias</h2><Link to="/calendario?view=week" className="small">Ver calendário</Link></div>
        {Object.keys(upcomingByDay).length === 0 ? (
          <div className="card empty"><div className="ico"><CalendarX2 size={22} /></div><p className="small">Nada agendado para os próximos 7 dias.</p></div>
        ) : (
          Object.entries(upcomingByDay).map(([date, items]) => (
            <div key={date} style={{ marginBottom: 14 }}>
              <div className="label" style={{ margin: '0 2px 6px' }}>{cap(relativeDay(date, dash.today))} · {longDate(date)}</div>
              <Group title={date} items={items} today={dash.today} />
            </div>
          ))
        )}
      </section>
    </>
  );

}
