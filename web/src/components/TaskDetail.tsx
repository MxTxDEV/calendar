import { useState } from 'react';
import { Bell, CalendarClock, Check, Clock, Copy, Pencil, Play, Plus, Repeat, RotateCcw, Trash2, X } from 'lucide-react';
import { ConfirmDialog, Modal, ScopeDialog } from './Modal';
import { CategoryIcon } from '../lib/category-icons';
import { PRIORITY_LABEL, STATUS_LABEL, describeRecurrence, longDate, reminderLabel, timeRange } from '../lib/dates';
import { useCategories, useOccurrences, useTaskMutations } from '../lib/queries';
import type { Occurrence, Scope, Status } from '../lib/types';
import { useUI } from '../lib/ui';
import { ApiError } from '../lib/api';

export function TaskDetail({ task: initial, onClose }: { task: Occurrence; onClose: () => void }) {
  const { data: categories = [] } = useCategories();
  const { openEdit, toast } = useUI();
  const m = useTaskMutations();
  // mantém o detalhe sincronizado com o servidor (subtarefas, status…)
  const { data: fresh } = useOccurrences(initial.date, initial.date);
  const task = fresh?.find((o) => o.id === initial.id) ?? initial;
  const category = categories.find((c) => c.id === task.categoryId);

  const [newSub, setNewSub] = useState('');
  const [mode, setMode] = useState<null | 'delete' | 'delete-scope' | 'reschedule'>(null);
  const [rsDate, setRsDate] = useState(task.date);
  const [rsTime, setRsTime] = useState(task.startTime ?? '');
  const [rsEnd, setRsEnd] = useState(task.endTime ?? '');

  const fail = (e: unknown) => toast(e instanceof ApiError ? e.message : 'Algo deu errado.', { kind: 'error' });

  const setStatus = (status: Status) => m.setStatus.mutate({ task, status }, { onError: fail });

  const doDelete = (scope: Scope) => {
    m.remove.mutate({ task, scope }, {
      onSuccess: () => { toast('Tarefa excluída'); onClose(); },
      onError: fail,
    });
  };

  const doReschedule = () => {
    if (rsTime && rsEnd && rsEnd <= rsTime) return toast('O término precisa ser depois do início.', { kind: 'error' });
    m.reschedule.mutate(
      { task, date: rsDate, startTime: rsTime || null, endTime: rsTime && rsEnd ? rsEnd : null },
      { onSuccess: () => { toast('Tarefa reagendada'); onClose(); }, onError: fail },
    );
  };

  const addSub = () => {
    if (!newSub.trim()) return;
    m.addSubtask.mutate({ taskId: task.taskId, title: newSub.trim() }, { onError: fail });
    setNewSub('');
  };

  const done = task.status === 'done';

  return (
    <>
      <Modal
        title={<span className="row"><span className="dot" style={{ background: category?.color ?? 'var(--border-strong)' }} />{category?.name ?? 'Tarefa'}</span>}
        onClose={onClose}
        headerExtra={
          <>
            <button className="icon-btn" onClick={() => openEdit(task)} aria-label="Editar" title="Editar"><Pencil size={18} /></button>
            <button className="icon-btn" onClick={() => m.duplicate.mutate({ task }, { onSuccess: () => { toast('Tarefa duplicada'); onClose(); }, onError: fail })} aria-label="Duplicar" title="Duplicar"><Copy size={18} /></button>
            <button className="icon-btn" onClick={() => setMode('reschedule')} aria-label="Reagendar" title="Reagendar"><CalendarClock size={18} /></button>
            <button className="icon-btn" style={{ color: 'var(--danger)' }} onClick={() => setMode(task.recurring ? 'delete-scope' : 'delete')} aria-label="Excluir" title="Excluir"><Trash2 size={18} /></button>
          </>
        }
      >
        <div className="sheet-body">
          <div>
            <h1 style={{ textDecoration: done ? 'line-through' : undefined, color: done ? 'var(--text-3)' : undefined }}>{task.title}</h1>
            <div className="row small muted" style={{ marginTop: 6, flexWrap: 'wrap', gap: '4px 14px' }}>
              <span className="row" style={{ gap: 5 }}><Clock size={14} /> {longDate(task.date)} · {timeRange(task)}</span>
              {task.recurring && <span className="row" style={{ gap: 5 }}><Repeat size={14} /> {describeRecurrence(task.recurrence)}</span>}
            </div>
          </div>

          <div className="seg" role="radiogroup" aria-label="Status" style={{ width: '100%' }}>
            {(['pending', 'in_progress', 'done'] as Status[]).map((s) => (
              <button key={s} className={`grow ${task.status === s ? 'on' : ''}`} onClick={() => setStatus(s)} role="radio" aria-checked={task.status === s}>
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>

          <div className="row" style={{ flexWrap: 'wrap' }}>
            <span className={`badge ${task.priority === 'urgent' ? 'danger' : task.priority === 'high' ? 'accent' : ''}`}>Prioridade {PRIORITY_LABEL[task.priority].toLowerCase()}</span>
            {category && <span className="badge" style={{ color: category.color }}><CategoryIcon name={category.icon} size={12} /> {category.name}</span>}
            {task.rescheduled && <span className="badge">Reagendada</span>}
          </div>

          {(task.description || task.notes) && <p style={{ whiteSpace: 'pre-wrap' }}>{[task.description, task.notes].filter(Boolean).join('\n\n')}</p>}

          <div className="col" style={{ gap: 2 }}>
            <span className="label">Subtarefas {task.subtasks.length > 0 && `(${task.subtasks.filter((s) => s.done).length}/${task.subtasks.length})`}</span>
            {task.subtasks.map((s) => (
              <div key={s.id} className={`sub-item ${s.done ? 'done' : ''}`}>
                <button className={`check ${s.done ? 'done' : ''}`} onClick={() => m.toggleSubtask.mutate({ id: s.id, done: !s.done }, { onError: fail })} aria-label={s.done ? 'Desmarcar' : 'Marcar'}><Check size={11} strokeWidth={3} /></button>
                <span className="grow">{s.title}</span>
                <button className="icon-btn" style={{ width: 28, height: 28 }} onClick={() => m.removeSubtask.mutate({ id: s.id }, { onError: fail })} aria-label="Remover subtarefa"><X size={14} /></button>
              </div>
            ))}
            <div className="row" style={{ marginTop: 6 }}>
              <input className="input" style={{ height: 36 }} placeholder="Adicionar subtarefa" value={newSub} onChange={(e) => setNewSub(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addSub()} />
              <button className="btn sm" onClick={addSub} aria-label="Adicionar"><Plus size={14} /></button>
            </div>
          </div>

          {task.reminders.length > 0 && (
            <div className="row small muted" style={{ flexWrap: 'wrap' }}>
              <Bell size={14} /> {task.reminders.map(reminderLabel).join(' · ')}
            </div>
          )}

          <div className="row">
            {!done ? (
              <>
                {task.status === 'pending' && <button className="btn grow" onClick={() => setStatus('in_progress')}><Play size={16} /> Iniciar</button>}
                <button className="btn primary grow" onClick={() => setStatus('done')}><Check size={16} /> Concluir</button>
              </>
            ) : (
              <button className="btn grow" onClick={() => setStatus('pending')}><RotateCcw size={16} /> Reabrir</button>
            )}
          </div>
        </div>
      </Modal>

      {mode === 'delete' && (
        <ConfirmDialog title="Excluir tarefa?" text={`“${task.title}” será removida permanentemente.`} confirmLabel="Excluir" danger onClose={() => setMode(null)} onConfirm={() => doDelete('all')} />
      )}
      {mode === 'delete-scope' && <ScopeDialog title="Excluir tarefa recorrente" verb="excluir" onClose={() => setMode(null)} onPick={doDelete} />}
      {mode === 'reschedule' && (
        <Modal title="Reagendar" onClose={() => setMode(null)} footer={<><button className="btn grow" onClick={() => setMode(null)}>Cancelar</button><button className="btn primary grow" onClick={doReschedule} disabled={m.reschedule.isPending}>Reagendar</button></>}>
          <div className="sheet-body">
            {task.recurring && <p className="small muted">Somente esta ocorrência será movida.</p>}
            <div className="grid2">
              <div className="field"><label htmlFor="rd">Nova data</label><input id="rd" className="input" type="date" value={rsDate} onChange={(e) => setRsDate(e.target.value)} /></div>
              <div className="field"><label htmlFor="rt">Horário</label><input id="rt" className="input" type="time" value={rsTime} onChange={(e) => setRsTime(e.target.value)} /></div>
            </div>
            {rsTime && <div className="field"><label htmlFor="re">Término (opcional)</label><input id="re" className="input" type="time" value={rsEnd} onChange={(e) => setRsEnd(e.target.value)} /></div>}
            <div className="chips">
              {[['Amanhã', 1], ['Em 2 dias', 2], ['Próxima semana', 7]].map(([l, n]) => (
                <button key={l as string} className="chip" onClick={() => { const d = new Date(`${task.date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + (n as number)); setRsDate(d.toISOString().slice(0, 10)); }}>{l}</button>
              ))}
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
