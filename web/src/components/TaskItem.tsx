import { AlertTriangle, Check, ListChecks, Repeat } from 'lucide-react';
import type { Category, Occurrence } from '../lib/types';
import { PRIORITY_LABEL, timeRange } from '../lib/dates';
import { CategoryIcon } from '../lib/category-icons';

export function TaskItem({
  task, category, onOpen, onToggle, showDate, index = 0,
}: {
  task: Occurrence; category?: Category; onOpen: () => void; onToggle: () => void; showDate?: string; index?: number;
}) {
  const done = task.status === 'done';
  const subDone = task.subtasks.filter((s) => s.done).length;
  const color = category?.color ?? 'var(--border-strong)';
  return (
    <div className={`task ${done ? 'is-done' : ''}`} onClick={onOpen} style={{ animationDelay: `${Math.min(index, 8) * 25}ms` }} tabIndex={0}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen())}>
      <span className="bar" style={{ background: color }} />
      <button
        className={`check ${done ? 'done' : task.status === 'in_progress' ? 'progress-state' : ''}`}
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        aria-label={done ? 'Marcar como pendente' : 'Concluir tarefa'}
        title={done ? 'Reabrir' : 'Concluir'}
      >
        <Check size={14} strokeWidth={3} />
      </button>
      <div className="time nums">{showDate ? <><div className="truncate">{showDate}</div><div className="xs faint">{task.startTime ?? 'Dia todo'}</div></> : timeRange(task)}</div>
      <div className="grow">
        <div className="title">{task.title}</div>
        <div className="meta">
          {category && <span className="row" style={{ gap: 4 }}><CategoryIcon name={category.icon} size={12} /> <span style={{ color: category.color }}>{category.name}</span></span>}
          {(task.priority === 'urgent' || task.priority === 'high') && <span className={`prio-${task.priority}`}>● {PRIORITY_LABEL[task.priority]}</span>}
          {task.recurring && <span className="row" style={{ gap: 3 }}><Repeat size={11} /> Recorrente</span>}
          {task.subtasks.length > 0 && <span className="row" style={{ gap: 3 }}><ListChecks size={12} /> {subDone}/{task.subtasks.length}</span>}
          {task.status === 'in_progress' && <span style={{ color: 'var(--warn)' }}>Em andamento</span>}
          {task.overdue && !done && <span className="row" style={{ gap: 3, color: 'var(--danger)' }}><AlertTriangle size={12} /> Atrasada</span>}
        </div>
      </div>
    </div>
  );
}
