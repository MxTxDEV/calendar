import { useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarCheck, ChevronLeft, ChevronRight } from 'lucide-react';
import { TaskItem } from '../components/TaskItem';
import {
  addDays, addMonths, cap, dayNum, endOfMonth, longDate, monthGrid, monthTitle, startOfMonth, startOfWeek, todayIn, weekTitle, weekdayLong, weekdayShort,
} from '../lib/dates';
import { useCategoryMap, useToggleDone } from '../lib/hooks';
import { useOccurrences, useSettings } from '../lib/queries';
import type { Occurrence } from '../lib/types';
import { useUI } from '../lib/ui';

type View = 'day' | 'week' | 'month';

export function CalendarPage() {
  const { data: settings } = useSettings();
  const tz = settings?.timezone ?? 'America/Sao_Paulo';
  const today = todayIn(tz);
  const [params, setParams] = useSearchParams();
  const view = (params.get('view') as View) || settings?.defaultView || 'week';
  const date = params.get('date') || today;
  const cats = useCategoryMap();
  const toggle = useToggleDone();
  const { openView, openNewTask } = useUI();

  const set = (next: { view?: View; date?: string }, replace = false) => {
    const p = new URLSearchParams(params);
    if (next.view) p.set('view', next.view);
    if (next.date) p.set('date', next.date);
    setParams(p, { replace });
  };

  const range = useMemo(() => {
    if (view === 'day') return { from: date, to: date };
    if (view === 'week') { const s = startOfWeek(date); return { from: s, to: addDays(s, 6) }; }
    const g = monthGrid(date);
    return { from: g[0], to: g[g.length - 1] };
  }, [view, date]);

  const { data: occ = [], isFetching } = useOccurrences(range.from, range.to);
  const byDay = useMemo(() => {
    const m = new Map<string, Occurrence[]>();
    for (const o of occ) (m.get(o.date) ?? m.set(o.date, []).get(o.date)!).push(o);
    return m;
  }, [occ]);

  // abre a tarefa indicada pela notificação (?task=<id>)
  const taskParam = params.get('task');
  useEffect(() => {
    if (!taskParam) return;
    const found = occ.find((o) => o.id === taskParam);
    if (found) {
      openView(found);
      const p = new URLSearchParams(params);
      p.delete('task');
      setParams(p, { replace: true });
    }
  }, [taskParam, occ]); // eslint-disable-line react-hooks/exhaustive-deps

  const step = (dir: -1 | 1) => set({ date: view === 'day' ? addDays(date, dir) : view === 'week' ? addDays(date, 7 * dir) : addMonths(date, dir) });
  const title = view === 'day' ? longDate(date) : view === 'week' ? weekTitle(startOfWeek(date)) : monthTitle(date);

  const taskList = (list: Occurrence[]) =>
    list.map((t, i) => (
      <TaskItem key={t.id} index={i} task={t} category={t.categoryId ? cats.get(t.categoryId) : undefined} onOpen={() => openView(t)} onToggle={() => toggle(t)} />
    ));

  return (
    <>
      <div className="cal-toolbar">
        <div className="cal-title" aria-live="polite">{title}{isFetching && <span className="faint xs" style={{ marginLeft: 8 }}>•</span>}</div>
        <div className="seg" role="tablist" aria-label="Visualização">
          {([['day', 'Dia'], ['week', 'Semana'], ['month', 'Mês']] as const).map(([v, l]) => (
            <button key={v} className={view === v ? 'on' : ''} role="tab" aria-selected={view === v} onClick={() => set({ view: v })}>{l}</button>
          ))}
        </div>
        <div className="row" style={{ gap: 2 }}>
          <button className="icon-btn" onClick={() => step(-1)} aria-label="Anterior"><ChevronLeft size={20} /></button>
          <button className="btn sm" onClick={() => set({ date: today })}>Hoje</button>
          <button className="icon-btn" onClick={() => step(1)} aria-label="Próximo"><ChevronRight size={20} /></button>
        </div>
      </div>

      {view === 'day' && (
        <>
          <WeekStrip date={date} today={today} byDay={byDay} onPick={(d) => set({ date: d })} />
          <div className="card list">
            {(byDay.get(date) ?? []).length === 0 ? (
              <div className="empty"><div className="ico"><CalendarCheck size={22} /></div><b>Nada por aqui</b><p className="small">Nenhuma tarefa em {cap(weekdayLong(date))}.</p>
                <button className="btn primary sm" style={{ marginTop: 12 }} onClick={() => openNewTask({ date })}>+ Nova tarefa</button></div>
            ) : taskList(byDay.get(date)!)}
          </div>
        </>
      )}

      {view === 'week' && (
        <div className="week-grid">
          {Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(date), i)).map((d) => {
            const items = byDay.get(d) ?? [];
            return (
              <div key={d} className={`card day-col ${d === today ? 'today' : ''}`}>
                <h3 style={{ cursor: 'pointer' }} onClick={() => set({ view: 'day', date: d })}>{cap(weekdayShort(d))} <span>{dayNum(d)}</span></h3>
                {/* celular: lista completa; desktop: cartões compactos */}
                <div className="only-mobile">{items.length ? <div className="list" style={{ margin: '0 -10px' }}>{taskList(items)}</div> : <span className="faint xs">Livre</span>}</div>
                <div className="only-desktop">
                  {items.map((t) => (
                    <div key={t.id} className={`mini ${t.status === 'done' ? 'done' : ''}`} style={{ borderLeftColor: cats.get(t.categoryId ?? '')?.color ?? 'var(--border-strong)' }} onClick={() => openView(t)}>
                      <span className="t">{t.startTime ?? '•'}</span><span className="truncate">{t.title}</span>
                    </div>
                  ))}
                  {!items.length && <span className="faint xs">Livre</span>}
                  <button className="btn ghost sm block" style={{ marginTop: 4, color: 'var(--text-3)' }} onClick={() => openNewTask({ date: d })}>+</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {view === 'month' && (
        <>
          <div className="month" role="grid">
            {['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'].map((w) => <div className="hd" key={w}>{w}</div>)}
            {monthGrid(date).map((d) => {
              const items = byDay.get(d) ?? [];
              const inMonth = d >= startOfMonth(date) && d <= endOfMonth(date);
              return (
                <button key={d} className={`cell ${d === today ? 'today' : ''} ${d === date ? 'sel' : ''} ${inMonth ? '' : 'out'}`}
                  onClick={() => set({ date: d })} onDoubleClick={() => set({ view: 'day', date: d })} aria-label={`${dayNum(d)}, ${items.length} tarefas`}>
                  <span className="n">{dayNum(d)}</span>
                  {items.slice(0, 3).map((t) => (
                    <span key={t.id} className="pill truncate" style={{ borderLeftColor: cats.get(t.categoryId ?? '')?.color ?? 'var(--border-strong)', opacity: t.status === 'done' ? 0.5 : 1 }}>{t.startTime ? `${t.startTime} ` : ''}{t.title}</span>
                  ))}
                  {items.length > 3 && <span className="pill faint">+{items.length - 3}</span>}
                  <span className="dots">{items.slice(0, 6).map((t) => <i key={t.id} style={{ background: cats.get(t.categoryId ?? '')?.color ?? 'var(--text-3)' }} />)}</span>
                </button>
              );
            })}
          </div>
          <section className="section">
            <div className="section-head"><h2>{longDate(date)}</h2><button className="btn sm" onClick={() => set({ view: 'day', date })}>Abrir dia</button></div>
            <div className="card list">
              {(byDay.get(date) ?? []).length === 0 ? <div className="empty small">Nenhuma tarefa neste dia.</div> : taskList(byDay.get(date)!)}
            </div>
          </section>
        </>
      )}
    </>
  );
}

function WeekStrip({ date, today, byDay, onPick }: { date: string; today: string; byDay: Map<string, Occurrence[]>; onPick: (d: string) => void }) {
  return (
    <div className="week-strip">
      {Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(date), i)).map((d) => (
        <button key={d} className={`wd ${d === today ? 'today' : ''} ${d === date ? 'sel' : ''}`} onClick={() => onPick(d)} aria-label={`${weekdayLong(d)} ${dayNum(d)}`}>
          <span>{weekdayShort(d)}</span><b>{dayNum(d)}</b>
        </button>
      ))}
    </div>
  );
}
