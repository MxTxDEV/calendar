import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { Category, Dashboard, Occurrence, Scope, Settings, Status, TaskInput, User } from './types';

export const useMe = () =>
  useQuery({
    queryKey: ['me'],
    queryFn: () => api<{ user: User }>('/auth/me').then((r) => r.user).catch((e) => (e.status === 401 ? null : Promise.reject(e))),
    staleTime: Infinity,
    retry: false,
  });

export const useSettings = () =>
  useQuery({ queryKey: ['settings'], queryFn: () => api<{ settings: Settings }>('/settings').then((r) => r.settings), staleTime: 5 * 60_000 });

export const useCategories = () =>
  useQuery({ queryKey: ['categories'], queryFn: () => api<{ categories: Category[] }>('/categories').then((r) => r.categories), staleTime: 5 * 60_000 });

/** Dados "vivos": atualizam ao voltar para o app e a cada minuto (sincroniza entre dispositivos). */
const live = { refetchOnWindowFocus: true, refetchInterval: 60_000 } as const;

export const useDashboard = () => useQuery({ queryKey: ['dashboard'], queryFn: () => api<Dashboard>('/dashboard'), ...live });

export const useOccurrences = (from: string, to: string) =>
  useQuery({
    queryKey: ['occ', from, to],
    queryFn: () => api<{ occurrences: Occurrence[] }>(`/occurrences?from=${from}&to=${to}`).then((r) => r.occurrences),
    placeholderData: keepPreviousData,
    ...live,
  });

function useRefresh() {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: ['occ'] }), qc.invalidateQueries({ queryKey: ['dashboard'] }), qc.invalidateQueries({ queryKey: ['search'] })]);
}

const occParam = (o: Occurrence) => (o.recurring ? o.originalDate : undefined);

export function useTaskMutations() {
  const refresh = useRefresh();
  const opts = { onSuccess: refresh };
  return {
    create: useMutation({
      mutationFn: (v: Partial<TaskInput> & { title: string; date: string; subtasks?: { title: string }[] }) =>
        api<{ task: Occurrence }>('/tasks', { method: 'POST', body: v }),
      ...opts,
    }),
    update: useMutation({
      mutationFn: (v: { task: Occurrence; changes: Partial<TaskInput>; scope?: Scope }) =>
        api<{ task: Occurrence }>(`/tasks/${v.task.taskId}`, {
          method: 'PATCH',
          body: { ...v.changes, scope: v.scope ?? 'all', occurrenceDate: occParam(v.task) },
        }),
      ...opts,
    }),
    remove: useMutation({
      mutationFn: (v: { task: Occurrence; scope?: Scope }) =>
        api(`/tasks/${v.task.taskId}?scope=${v.scope ?? 'all'}${v.task.recurring ? `&occurrenceDate=${v.task.originalDate}` : ''}`, { method: 'DELETE' }),
      ...opts,
    }),
    setStatus: useMutation({
      mutationFn: (v: { task: Occurrence; status: Status }) =>
        api<{ task: Occurrence }>(`/tasks/${v.task.taskId}/status`, { method: 'POST', body: { status: v.status, occurrenceDate: occParam(v.task) } }),
      ...opts,
    }),
    reschedule: useMutation({
      mutationFn: (v: { task: Occurrence; date: string; startTime?: string | null; endTime?: string | null }) =>
        api<{ task: Occurrence }>(`/tasks/${v.task.taskId}/reschedule`, {
          method: 'POST',
          body: { date: v.date, startTime: v.startTime, endTime: v.endTime, occurrenceDate: occParam(v.task) },
        }),
      ...opts,
    }),
    duplicate: useMutation({
      mutationFn: (v: { task: Occurrence }) =>
        api<{ task: Occurrence }>(`/tasks/${v.task.taskId}/duplicate`, { method: 'POST', body: { occurrenceDate: occParam(v.task) } }),
      ...opts,
    }),
    addSubtask: useMutation({
      mutationFn: (v: { taskId: string; title: string }) => api(`/tasks/${v.taskId}/subtasks`, { method: 'POST', body: { title: v.title } }),
      ...opts,
    }),
    toggleSubtask: useMutation({
      mutationFn: (v: { id: string; done: boolean }) => api(`/subtasks/${v.id}`, { method: 'PATCH', body: { done: v.done } }),
      ...opts,
    }),
    removeSubtask: useMutation({ mutationFn: (v: { id: string }) => api(`/subtasks/${v.id}`, { method: 'DELETE' }), ...opts }),
  };
}

export function useSettingsMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (changes: Partial<Settings>) => api<{ settings: Settings }>('/settings', { method: 'PATCH', body: changes }),
    onSuccess: (r) => {
      qc.setQueryData(['settings'], r.settings);
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['occ'] });
    },
  });
}

export function useCategoryMutations() {
  const qc = useQueryClient();
  const onSuccess = () => qc.invalidateQueries({ queryKey: ['categories'] });
  return {
    create: useMutation({ mutationFn: (v: { name: string; color: string; icon: string }) => api('/categories', { method: 'POST', body: v }), onSuccess }),
    update: useMutation({ mutationFn: (v: { id: string; name?: string; color?: string; icon?: string }) => api(`/categories/${v.id}`, { method: 'PATCH', body: v }), onSuccess }),
    remove: useMutation({
      mutationFn: (v: { id: string }) => api(`/categories/${v.id}`, { method: 'DELETE' }),
      onSuccess: () => {
        onSuccess();
        qc.invalidateQueries({ queryKey: ['occ'] });
        qc.invalidateQueries({ queryKey: ['dashboard'] });
      },
    }),
  };
}
