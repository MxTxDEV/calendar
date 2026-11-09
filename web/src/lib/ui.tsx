import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Occurrence } from './types';

interface Toast { id: number; text: string; kind: 'info' | 'error'; action?: { label: string; run: () => void } }

interface UI {
  newTask: { date?: string; startTime?: string } | null;
  editing: Occurrence | null;
  viewing: Occurrence | null;
  openNewTask: (preset?: { date?: string; startTime?: string }) => void;
  openEdit: (o: Occurrence) => void;
  openView: (o: Occurrence | null) => void;
  closeAll: () => void;
  toast: (text: string, opts?: { kind?: 'info' | 'error'; action?: Toast['action'] }) => void;
  toasts: Toast[];
}

const Ctx = createContext<UI>(null as any);
export const useUI = () => useContext(Ctx);

let tid = 0;

export function UIProvider({ children }: { children: ReactNode }) {
  const [newTask, setNewTask] = useState<UI['newTask']>(null);
  const [editing, setEditing] = useState<Occurrence | null>(null);
  const [viewing, setViewing] = useState<Occurrence | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback<UI['toast']>((text, opts = {}) => {
    const id = ++tid;
    setToasts([{ id, text, kind: opts.kind ?? 'info', action: opts.action }]); // um aviso por vez
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), opts.action ? 6000 : 3500);
  }, []);

  const value = useMemo<UI>(
    () => ({
      newTask, editing, viewing, toasts, toast,
      openNewTask: (p = {}) => { setViewing(null); setNewTask(p); },
      openEdit: (o) => { setViewing(null); setEditing(o); },
      openView: setViewing,
      closeAll: () => { setNewTask(null); setEditing(null); setViewing(null); },
    }),
    [newTask, editing, viewing, toasts, toast],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
