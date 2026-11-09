import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Layout } from './components/Layout';
import { AuthPage } from './pages/Auth';
import { CalendarPage } from './pages/Calendar';
import { DashboardPage } from './pages/Dashboard';
import { NotificationsPage } from './pages/Notifications';
import { SettingsPage } from './pages/Settings';
import { setUnauthorizedHandler } from './lib/api';
import { useMe } from './lib/queries';

export function App() {
  const qc = useQueryClient();
  const { data: user, isLoading } = useMe();

  useEffect(() => {
    setUnauthorizedHandler(() => qc.setQueryData(['me'], null));
  }, [qc]);

  if (isLoading) return <div className="auth"><img className="auth-logo" src="/icons/icon.svg" alt="Carregando" /></div>;
  if (!user) return <AuthPage />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="calendario" element={<CalendarPage />} />
        <Route path="notificacoes" element={<NotificationsPage />} />
        <Route path="configuracoes" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
