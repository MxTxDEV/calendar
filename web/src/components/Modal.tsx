import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function Modal({ title, onClose, children, footer, headerExtra }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; headerExtra?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <div className="row">
            {headerExtra}
            <button className="icon-btn" onClick={onClose} aria-label="Fechar"><X size={20} /></button>
          </div>
        </div>
        {children}
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function ScopeDialog({ title, verb, onPick, onClose }: { title: string; verb: string; onPick: (scope: 'this' | 'following' | 'all') => void; onClose: () => void }) {
  return (
    <Modal title={title} onClose={onClose}>
      <div className="sheet-body">
        <p className="muted small">Esta tarefa se repete. O que deseja {verb}?</p>
        <div className="col">
          <button className="btn block" onClick={() => onPick('this')}>Somente esta ocorrência</button>
          <button className="btn block" onClick={() => onPick('following')}>Esta e as próximas</button>
          <button className="btn block" onClick={() => onPick('all')}>Todas as ocorrências</button>
        </div>
      </div>
    </Modal>
  );
}

export function ConfirmDialog({ title, text, confirmLabel, danger, onConfirm, onClose }: { title: string; text: string; confirmLabel: string; danger?: boolean; onConfirm: () => void; onClose: () => void }) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn grow" onClick={onClose}>Cancelar</button>
          <button className={`btn grow ${danger ? 'danger solid' : 'primary'}`} onClick={onConfirm}>{confirmLabel}</button>
        </>
      }
    >
      <div className="sheet-body"><p className="muted">{text}</p></div>
    </Modal>
  );
}
