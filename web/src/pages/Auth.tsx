import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';

export function AuthPage() {
  const qc = useQueryClient();
  const { data: cfg } = useQuery({ queryKey: ['auth-config'], queryFn: () => api<{ allowSignup: boolean }>('/auth/config') });
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const body = mode === 'login' ? { email, password } : { name, email, password, timezone: tz };
      const r = await api<{ user: any }>(`/auth/${mode}`, { method: 'POST', body });
      qc.setQueryData(['me'], r.user);
      qc.invalidateQueries();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível entrar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <form className="card auth-card" onSubmit={submit}>
        <div className="col" style={{ alignItems: 'center', gap: 10 }}>
          <img className="auth-logo" src="/icons/icon.svg" alt="MyDay" />
          <div className="center">
            <h1>{mode === 'login' ? 'Bem-vindo de volta' : 'Crie sua conta'}</h1>
            <p className="muted small" style={{ marginTop: 4 }}>Seu secretário digital: tarefas, calendário e lembretes.</p>
          </div>
        </div>
        {mode === 'register' && (
          <div className="field"><label htmlFor="n">Nome</label><input id="n" className="input" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" /></div>
        )}
        <div className="field"><label htmlFor="e">E-mail</label><input id="e" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" /></div>
        <div className="field">
          <label htmlFor="p">Senha</label>
          <input id="p" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={mode === 'register' ? 8 : 1} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
          {mode === 'register' && <span className="xs faint">Mínimo de 8 caracteres.</span>}
        </div>
        {error && <p className="error-text" role="alert">{error}</p>}
        <button className="btn primary block" style={{ height: 44 }} disabled={busy}>{busy ? 'Aguarde…' : mode === 'login' ? 'Entrar' : 'Criar conta'}</button>
        {(cfg?.allowSignup ?? true) && (
          <p className="center small muted">
            {mode === 'login' ? 'Ainda não tem conta? ' : 'Já tem conta? '}
            <a href="#" onClick={(e) => { e.preventDefault(); setError(''); setMode(mode === 'login' ? 'register' : 'login'); }}>{mode === 'login' ? 'Criar conta' : 'Entrar'}</a>
          </p>
        )}
      </form>
    </div>
  );
}
