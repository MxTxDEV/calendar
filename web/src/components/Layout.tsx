import { useEffect } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { CalendarDays, LayoutDashboard, Plus, Settings as SettingsIcon } from 'lucide-react';
import { TaskDetail } from './TaskDetail';
import { TaskForm } from './TaskForm';
import { Toasts } from './Toasts';
import { useUI } from '../lib/ui';
import { useSettings } from '../lib/queries';
import { useTheme } from '../lib/theme';
import { syncSubscription } from '../lib/push';

const links = [
  { to: '/', label: 'Hoje', icon: LayoutDashboard, end: true },
  { to: '/calendario', label: 'Calendário', icon: CalendarDays },
  { to: '/configuracoes', label: 'Ajustes', icon: SettingsIcon },
];

export function Layout() {
  const ui = useUI();
  const { data: settings } = useSettings();
  const loc = useLocation();
  const nav = useNavigate();
  useTheme(settings?.theme);

  useEffect(() => { void syncSubscription(); }, []);

  // atalho do app instalado (/?new=1) e mensagens do service worker (toque na notificação)
  useEffect(() => {
    if (new URLSearchParams(loc.search).get('new') === '1') {
      ui.openNewTask();
      nav({ pathname: loc.pathname }, { replace: true });
    }
  }, [loc.search]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === 'navigate') {
        const u = new URL(e.data.url, location.origin);
        nav(u.pathname + u.search);
      }
    };
    navigator.serviceWorker?.addEventListener('message', onMsg);
    return () => navigator.serviceWorker?.removeEventListener('message', onMsg);
  }, [nav]);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand"><img src="/icons/icon.svg" alt="" /> MyDay</div>
        {links.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <Icon size={18} /> {label}
          </NavLink>
        ))}
      </aside>
      <main className="main"><Outlet /></main>
      <nav className="tabbar" aria-label="Navegação principal">
        {links.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>
            <Icon size={22} /> {label}
          </NavLink>
        ))}
      </nav>
      <button className="fab" onClick={() => ui.openNewTask()}><Plus size={20} strokeWidth={2.4} /> Nova tarefa</button>

      {ui.newTask && <TaskForm preset={ui.newTask} onClose={ui.closeAll} />}
      {ui.editing && <TaskForm initial={ui.editing} onClose={ui.closeAll} />}
      {ui.viewing && <TaskDetail task={ui.viewing} onClose={ui.closeAll} />}
      <Toasts />
    </div>
  );
}
