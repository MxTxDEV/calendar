import { useEffect } from 'react';
import type { Settings } from './types';

export function applyTheme(theme: Settings['theme'] | undefined) {
  const root = document.documentElement;
  if (theme === 'dark' || theme === 'light') {
    root.dataset.theme = theme;
    try { localStorage.setItem('myday-theme', theme); } catch { /* ignore */ }
  } else {
    delete root.dataset.theme;
    try { localStorage.removeItem('myday-theme'); } catch { /* ignore */ }
  }
}

export function useTheme(theme: Settings['theme'] | undefined) {
  useEffect(() => { if (theme) applyTheme(theme); }, [theme]);
}
