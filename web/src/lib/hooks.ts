import { useEffect, useState } from 'react';
import { useCategories, useTaskMutations } from './queries';
import type { Occurrence } from './types';
import { useUI } from './ui';
import { ApiError } from './api';
import { currentSubscription, pushSupport } from './push';

/** Concluir/reabrir com opção de desfazer. */
export function useToggleDone() {
  const { setStatus } = useTaskMutations();
  const { toast } = useUI();
  return (task: Occurrence) => {
    const next = task.status === 'done' ? 'pending' : 'done';
    setStatus.mutate(
      { task, status: next },
      {
        onSuccess: () => {
          if (next === 'done') toast('Tarefa concluída ✓', { action: { label: 'Desfazer', run: () => setStatus.mutate({ task, status: task.status }) } });
        },
        onError: (e) => toast(e instanceof ApiError ? e.message : 'Não foi possível atualizar.', { kind: 'error' }),
      },
    );
  };
}

export function useCategoryMap() {
  const { data = [] } = useCategories();
  return new Map(data.map((c) => [c.id, c]));
}

export type PushState = 'loading' | 'unsupported' | 'ios-install' | 'denied' | 'off' | 'on';

export function usePushState(refreshKey = 0) {
  const [state, setState] = useState<PushState>('loading');
  useEffect(() => {
    let alive = true;
    (async () => {
      const s = pushSupport();
      if (!s.ok) return alive && setState(s.reason === 'ios-not-installed' ? 'ios-install' : 'unsupported');
      if (Notification.permission === 'denied') return alive && setState('denied');
      const sub = await currentSubscription().catch(() => null);
      if (alive) setState(sub && Notification.permission === 'granted' ? 'on' : 'off');
    })();
    return () => { alive = false; };
  }, [refreshKey]);
  return state;
}
