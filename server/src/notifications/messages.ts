import type { Occurrence } from '../lib/occurrences.js';
import { weekdayName } from '../lib/time.js';

function line(o: Occurrence) {
  const when = o.startTime ? o.startTime : 'Durante o dia';
  return `• ${when} — ${o.title}`;
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

export function greeting(hour: number) {
  if (hour < 12) return 'Bom dia! ☀️';
  if (hour < 18) return 'Boa tarde! 🌤️';
  return 'Boa noite! 🌙';
}

export function dailySummary(today: Occurrence[], overdueCount: number, hour: number) {
  const pending = today.filter((o) => o.status !== 'done');
  const title = greeting(hour);
  const parts: string[] = [];
  if (!pending.length) {
    parts.push('Seu dia está livre de compromissos cadastrados. Aproveite! 🌿');
  } else {
    parts.push('Aqui está sua programação de hoje:');
    const shown = pending.slice(0, 10);
    parts.push(shown.map(line).join('\n'));
    if (pending.length > shown.length) parts.push(`…e mais ${pending.length - shown.length}.`);
    parts.push(`Você tem ${plural(pending.length, 'tarefa programada', 'tarefas programadas')} para hoje.\nVamos começar!`);
  }
  if (overdueCount > 0) parts.push(`⚠️ ${plural(overdueCount, 'tarefa atrasada', 'tarefas atrasadas')} aguardando você.`);
  return { title, body: parts.join('\n\n'), count: pending.length };
}

export function weeklySummary(week: Occurrence[], weekDates: string[]) {
  const pending = week.filter((o) => o.status !== 'done');
  const title = '🚀 SUA SEMANA COMEÇOU!';
  if (!pending.length) {
    return {
      title,
      body: 'Nenhuma atividade cadastrada para esta semana ainda.\nQue tal planejar seus próximos dias agora?',
      count: 0,
    };
  }
  const blocks: string[] = ['Confira seu planejamento:'];
  for (const date of weekDates) {
    const items = pending.filter((o) => o.date === date);
    if (!items.length) continue;
    const shown = items.slice(0, 5).map((o) => `• ${o.startTime ? `${o.startTime} ` : ''}${o.title}`);
    if (items.length > 5) shown.push(`• …e mais ${items.length - 5}`);
    blocks.push(`${weekdayName(date).toUpperCase()}\n${shown.join('\n')}`);
  }
  blocks.push(
    `Você tem ${plural(pending.length, 'atividade programada', 'atividades programadas')} nesta semana.\nOrganize suas prioridades e faça acontecer!`,
  );
  return { title, body: blocks.join('\n\n'), count: pending.length };
}

export function formatLead(minutes: number) {
  if (minutes <= 0) return 'agora';
  if (minutes < 60) return `em ${plural(minutes, 'minuto', 'minutos')}`;
  if (minutes % 1440 === 0) return minutes === 1440 ? 'amanhã' : `em ${minutes / 1440} dias`;
  if (minutes % 60 === 0) return `em ${plural(minutes / 60, 'hora', 'horas')}`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `em ${h}h${String(m).padStart(2, '0')}`;
}

export function reminderMessage(o: Occurrence, minutesLeft: number, configuredOffset: number) {
  const title = `⏰ Lembrete: ${o.title}`;
  let body: string;
  if (o.allDay) {
    const days = Math.floor(configuredOffset / 1440);
    const when = days === 0 ? 'hoje' : days === 1 ? 'amanhã' : `daqui a ${days} dias`;
    body = `“${o.title}” está programada para ${when}.`;
  } else {
    const lead = configuredOffset === 1440 && minutesLeft > 600 ? `amanhã às ${o.startTime}` : `${formatLead(minutesLeft)} (${o.startTime})`;
    body = minutesLeft <= 0 ? `“${o.title}” começa agora (${o.startTime})!` : `“${o.title}” começa ${lead}!`;
  }
  if (o.description) body += `\n${o.description.slice(0, 200)}`;
  return { title, body };
}
