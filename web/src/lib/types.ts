export type Status = 'pending' | 'in_progress' | 'done';
export type Priority = 'low' | 'medium' | 'high' | 'urgent';
export type Scope = 'this' | 'following' | 'all';

export interface Recurrence {
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;
  byWeekday?: number[];
  until: string | null;
  count: number | null;
}

export interface Subtask { id: string; title: string; done: boolean; position: number }

export interface Occurrence {
  id: string;
  taskId: string;
  date: string;
  originalDate: string;
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
  title: string;
  description: string;
  notes: string;
  categoryId: string | null;
  priority: Priority;
  status: Status;
  completedAt: string | null;
  recurring: boolean;
  recurrence: Recurrence | null;
  reminders: number[];
  rescheduled: boolean;
  subtasks: Subtask[];
  overdue?: boolean;
}

export interface Category { id: string; name: string; color: string; icon: string; position: number }

export interface Settings {
  timezone: string;
  dailyEnabled: boolean;
  dailyTime: string;
  weeklyEnabled: boolean;
  weeklyTime: string;
  weeklyDay: number;
  remindersEnabled: boolean;
  defaultReminders: number[];
  alldayReminderTime: string;
  defaultView: 'day' | 'week' | 'month';
  theme: 'system' | 'light' | 'dark';
}

export interface Dashboard {
  now: string;
  today: string;
  timezone: string;
  stats: { total: number; done: number; pending: number; inProgress: number; overdue: number; progress: number };
  next: Occurrence | null;
  todayList: Occurrence[];
  overdue: Occurrence[];
  upcoming: Occurrence[];
}

export interface User { id: string; email: string; name: string }

export interface TaskInput {
  title: string;
  description: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  categoryId: string | null;
  priority: Priority;
  recurrence: Recurrence | null;
  reminders: number[];
}
