import { useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Modal, ScopeDialog } from './Modal';
import { ApiError } from '../lib/api';
import { CategoryIcon } from '../lib/category-icons';
import { isoWeekday, reminderLabel, todayIn, PRIORITY_LABEL, weekdayShort } from '../lib/dates';
import { useCategories, useSettings, useTaskMutations } from '../lib/queries';
import type { Occurrence, Priority, Recurrence, Scope } from '../lib/types';
import { useUI } from '../lib/ui';

type RepeatKind = 'none' | 'daily' | 'weekly' | 'weekdays' | 'monthly' | 'custom';

const REMINDER_PRESETS = [5, 15, 30, 60, 1440];
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];
const WD_LABEL = ['', 'S', 'T', 'Q', 'Q', 'S', 'S', 'D'];

function kindOf(r: Recurrence | null): RepeatKind {
  if (!r) return 'none';
  if (r.interval === 1 && r.freq === 'daily') return 'daily';
  if (r.interval === 1 && r.freq === 'weekly') return r.byWeekday?.length ? 'weekdays' : 'weekly';
  if (r.interval === 1 && r.freq === 'monthly') return 'monthly';
  return 'custom';
}

export function TaskForm({ initial, preset, onClose }: { initial?: Occurrence; preset?: { date?: string; startTime?: string }; onClose: () => void }) {
  const { data: settings } = useSettings();
  const { data: categories = [] } = useCategories();
  const { create, update } = useTaskMutations();
  const { toast, openView } = useUI();
  const editing = !!initial;
  const tz = settings?.timezone ?? 'America/Sao_Paulo';

  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [date, setDate] = useState(initial?.date ?? preset?.date ?? todayIn(tz));
  const [hasTime, setHasTime] = useState(initial ? !!initial.startTime : !!preset?.startTime);
  const [startTime, setStartTime] = useState(initial?.startTime ?? preset?.startTime ?? '09:00');
  const [endTime, setEndTime] = useState(initial?.endTime ?? '');
  const [categoryId, setCategoryId] = useState<string | null>(initial?.categoryId ?? null);
  const [priority, setPriority] = useState<Priority>(initial?.priority ?? 'medium');
  const [reminders, setReminders] = useState<number[]>(initial?.reminders ?? settings?.defaultReminders ?? [15]);
  const [customReminder, setCustomReminder] = useState('');
  const [subtasks, setSubtasks] = useState<string[]>([]);
  const [subDraft, setSubDraft] = useState('');

  const rec = initial?.recurrence ?? null;
  const [repeat, setRepeat] = useState<RepeatKind>(kindOf(rec));
  const [interval, setIntervalN] = useState(rec?.interval ?? 1);
  const [unit, setUnit] = useState<Recurrence['freq']>(rec?.freq ?? 'daily');
  const [weekdays, setWeekdays] = useState<number[]>(rec?.byWeekday ?? [isoWeekday(date)]);
  const [until, setUntil] = useState(rec?.until ?? '');

  const [error, setError] = useState('');
  const [askScope, setAskScope] = useState(false);
  const busy = create.isPending || update.isPending;

  const recurrence = useMemo<Recurrence | null>(() => {
    if (repeat === 'none') return null;
    const base = { until: until || null, count: initial?.recurrence?.count ?? null };
    switch (repeat) {
      case 'daily': return { freq: 'daily', interval: 1, ...base };
      case 'weekly': return { freq: 'weekly', interval: 1, ...base };
      case 'weekdays': return { freq: 'weekly', interval: 1, byWeekday: weekdays.length ? weekdays : [isoWeekday(date)], ...base };
      case 'monthly': return { freq: 'monthly', interval: 1, ...base };
      default:
        return { freq: unit, interval: Math.max(1, interval || 1), ...(unit === 'weekly' ? { byWeekday: weekdays.length ? weekdays : [isoWeekday(date)] } : {}), ...base };
    }
  }, [repeat, interval, unit, weekdays, until, date, initial]);

  const toggleReminder = (m: number) => setReminders((r) => (r.includes(m) ? r.filter((x) => x !== m) : [...r, m].sort((a, b) => a - b)));
  const addCustomReminder = () => {
    const n = Number(customReminder);
    if (!Number.isFinite(n) || n < 0 || n > 60 * 24 * 30) return setError('Informe um lembrete válido, em minutos.');
    setError('');
    if (!reminders.includes(n)) setReminders([...reminders, n].sort((a, b) => a - b));
    setCustomReminder('');
  };

  function validate() {
    if (!title.trim()) return 'Informe o título da tarefa.';
    if (!date) return 'Informe a data.';
    if (hasTime && endTime && endTime <= startTime) return 'O término precisa ser depois do início.';
    if (until && until < date) return 'A data final da repetição precisa ser depois do início.';
    return '';
  }

  async function submit(scope?: Scope) {
    const problem = validate();
    if (problem) return setError(problem);
    setError('');
    const base = {
      title: title.trim(),
      description: description.trim(),
      startTime: hasTime ? startTime : null,
      endTime: hasTime && endTime ? endTime : null,
      categoryId,
      priority,
      recurrence,
      reminders,
    };
    try {
      if (!editing) {
        const subs = subtasks.map((t) => ({ title: t }));
        const r = await create.mutateAsync({ ...base, date, subtasks: subs });
        toast('Tarefa criada');
        onClose();
        void r;
      } else {
        const wasRecurring = initial!.recurring;
        const s = scope ?? 'all';
        // em "todas", a data da série não muda pela data de uma ocorrência
        const changes = wasRecurring && s === 'all' ? base : { ...base, date };
        await update.mutateAsync({ task: initial!, changes, scope: s });
        toast('Tarefa atualizada');
        onClose();
      }
    } catch (e) {
      setAskScope(false);
      setError(e instanceof ApiError ? e.message : 'Não foi possível salvar.');
    }
  }

  const onSave = () => {
    const problem = validate();
    if (problem) return setError(problem);
    if (editing && initial!.recurring) setAskScope(true);
    else void submit();
  };

  return (
    <>
      <Modal
        title={editing ? 'Editar tarefa' : 'Nova tarefa'}
        onClose={() => (editing && initial ? (onClose(), openView(initial)) : onClose())}
        footer={
          <>
            <button className="btn grow" onClick={onClose}>Cancelar</button>
            <button className="btn primary grow" onClick={onSave} disabled={busy}>{busy ? 'Salvando…' : editing ? 'Salvar' : 'Criar tarefa'}</button>
          </>
        }
      >
        <form className="sheet-body" onSubmit={(e) => { e.preventDefault(); onSave(); }}>
          <div className="field">
            <input className="input" style={{ height: 48, fontSize: 17, fontWeight: 550 }} placeholder="O que você precisa fazer?" value={title} autoFocus={!editing}
              onChange={(e) => setTitle(e.target.value)} maxLength={200} aria-label="Título" />
          </div>
          <div className="field">
            <label htmlFor="desc">Descrição</label>
            <textarea id="desc" className="textarea" placeholder="Detalhes, observações…" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div className="grid2">
            <div className="field">
              <label htmlFor="date">Data</label>
              <input id="date" className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="start">Horário</label>
              {hasTime ? (
                <input id="start" className="input" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
              ) : (
                <div className="input row faint" style={{ alignItems: 'center' }}>Sem horário</div>
              )}
            </div>
          </div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <label className="row small" style={{ cursor: 'pointer' }}>
              <input type="checkbox" checked={!hasTime} onChange={(e) => setHasTime(!e.target.checked)} /> Sem horário definido (durante o dia)
            </label>
            {hasTime && (
              <div className="row small">
                <label htmlFor="end" className="muted">Término</label>
                <input id="end" className="input" style={{ width: 118, height: 34 }} type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                {endTime && <button type="button" className="icon-btn" style={{ width: 28, height: 28 }} onClick={() => setEndTime('')} aria-label="Remover término"><X size={14} /></button>}
              </div>
            )}
          </div>

          <div className="field">
            <span className="label">Categoria</span>
            <div className="chips">
              <button type="button" className={`cat-pill ${categoryId === null ? 'on' : ''}`} style={{ ['--cat' as any]: 'var(--text-3)' }} onClick={() => setCategoryId(null)}>Sem categoria</button>
              {categories.map((c) => (
                <button type="button" key={c.id} className={`cat-pill ${categoryId === c.id ? 'on' : ''}`} style={{ ['--cat' as any]: c.color }} onClick={() => setCategoryId(c.id)}>
                  <span style={{ color: c.color, display: 'inline-flex' }}><CategoryIcon name={c.icon} /></span>{c.name}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <span className="label">Prioridade</span>
            <div className="seg" role="radiogroup">
              {(['low', 'medium', 'high', 'urgent'] as Priority[]).map((p) => (
                <button type="button" key={p} className={priority === p ? 'on' : ''} onClick={() => setPriority(p)} role="radio" aria-checked={priority === p}>{PRIORITY_LABEL[p]}</button>
              ))}
            </div>
          </div>

          <div className="field">
            <label htmlFor="repeat">Repetição</label>
            <select id="repeat" className="select" value={repeat} onChange={(e) => setRepeat(e.target.value as RepeatKind)}>
              <option value="none">Não se repete</option>
              <option value="daily">Todos os dias</option>
              <option value="weekly">Toda semana</option>
              <option value="weekdays">Dias específicos da semana</option>
              <option value="monthly">Todo mês</option>
              <option value="custom">Personalizado…</option>
            </select>
            {repeat === 'custom' && (
              <div className="row" style={{ marginTop: 4 }}>
                <span className="muted small">A cada</span>
                <input className="input" style={{ width: 72 }} type="number" min={1} max={365} value={interval} onChange={(e) => setIntervalN(Number(e.target.value))} aria-label="Intervalo" />
                <select className="select" style={{ width: 'auto' }} value={unit} onChange={(e) => setUnit(e.target.value as Recurrence['freq'])} aria-label="Unidade">
                  <option value="daily">dia(s)</option>
                  <option value="weekly">semana(s)</option>
                  <option value="monthly">mês(es)</option>
                  <option value="yearly">ano(s)</option>
                </select>
              </div>
            )}
            {(repeat === 'weekdays' || (repeat === 'custom' && unit === 'weekly')) && (
              <div className="weekday-pick" style={{ marginTop: 4 }}>
                {WEEKDAYS.map((d) => (
                  <button type="button" key={d} className={weekdays.includes(d) ? 'on' : ''} aria-pressed={weekdays.includes(d)} title={weekdayShort(`2026-11-${String(8 + d).padStart(2, '0')}`)}
                    onClick={() => setWeekdays((w) => (w.includes(d) ? w.filter((x) => x !== d) : [...w, d].sort()))}>{WD_LABEL[d]}</button>
                ))}
              </div>
            )}
            {repeat !== 'none' && (
              <div className="row small" style={{ marginTop: 4 }}>
                <label htmlFor="until" className="muted">Repetir até</label>
                <input id="until" className="input" style={{ width: 160, height: 34 }} type="date" value={until} min={date} onChange={(e) => setUntil(e.target.value)} />
                {until && <button type="button" className="btn ghost sm" onClick={() => setUntil('')}>Sem fim</button>}
              </div>
            )}
          </div>

          <div className="field">
            <span className="label">Lembretes</span>
            <div className="chips">
              {[...new Set([...REMINDER_PRESETS, ...reminders])].sort((a, b) => a - b).map((m) => (
                <button type="button" key={m} className={`chip ${reminders.includes(m) ? 'on' : ''}`} aria-pressed={reminders.includes(m)} onClick={() => toggleReminder(m)}>{reminderLabel(m)}</button>
              ))}
            </div>
            <div className="row" style={{ marginTop: 4 }}>
              <input className="input" style={{ width: 150, height: 34 }} type="number" min={0} placeholder="Minutos antes" value={customReminder}
                onChange={(e) => setCustomReminder(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addCustomReminder())} aria-label="Lembrete personalizado em minutos" />
              <button type="button" className="btn sm" onClick={addCustomReminder}>Adicionar</button>
            </div>
            {!hasTime && reminders.length > 0 && <p className="xs faint">Sem horário, o lembrete é enviado às {settings?.alldayReminderTime ?? '09:00'} (configurável).</p>}
          </div>

          {!editing && (
            <div className="field">
              <span className="label">Subtarefas</span>
              {subtasks.map((s, i) => (
                <div className="sub-item" key={i}>
                  <span className="grow">{s}</span>
                  <button type="button" className="icon-btn" style={{ width: 28, height: 28 }} onClick={() => setSubtasks(subtasks.filter((_, j) => j !== i))} aria-label="Remover subtarefa"><X size={14} /></button>
                </div>
              ))}
              <div className="row">
                <input className="input" style={{ height: 36 }} placeholder="Adicionar subtarefa" value={subDraft} onChange={(e) => setSubDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (subDraft.trim()) { setSubtasks([...subtasks, subDraft.trim()]); setSubDraft(''); } } }} />
                <button type="button" className="btn sm" onClick={() => { if (subDraft.trim()) { setSubtasks([...subtasks, subDraft.trim()]); setSubDraft(''); } }}><Plus size={14} /></button>
              </div>
            </div>
          )}

          {error && <p className="error-text" role="alert">{error}</p>}
          <button type="submit" hidden />
        </form>
      </Modal>
      {askScope && <ScopeDialog title="Editar tarefa recorrente" verb="alterar" onClose={() => setAskScope(false)} onPick={(s) => { setAskScope(false); void submit(s); }} />}
    </>
  );
}
