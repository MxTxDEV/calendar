import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Bell, LogOut, Monitor, Moon, Pencil, Plus, Send, Sun, Trash2, Smartphone } from 'lucide-react';
import { ConfirmDialog, Modal } from '../components/Modal';
import { api, ApiError } from '../lib/api';
import { CATEGORY_COLORS, CATEGORY_ICONS, CategoryIcon } from '../lib/category-icons';
import { reminderLabel } from '../lib/dates';
import { usePushState } from '../lib/hooks';
import { useCategories, useCategoryMutations, useMe, useSettings, useSettingsMutation } from '../lib/queries';
import type { Category, Settings } from '../lib/types';
import { useUI } from '../lib/ui';

const REMINDER_PRESETS = [0, 5, 15, 30, 60, 1440];
const DAYS = ['', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado', 'Domingo'];

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" onClick={() => onChange(!checked)} />;
}

function Row({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="set-row">
      <div className="info"><div style={{ fontWeight: 550 }}>{title}</div>{hint && <div className="small muted">{hint}</div>}</div>
      {children}
    </div>
  );
}

function timezones() {
  try {
    return (Intl as any).supportedValuesOf('timeZone') as string[];
  } catch {
    return ['America/Sao_Paulo', 'America/Manaus', 'America/Fortaleza', 'America/Noronha', 'America/Rio_Branco', 'Europe/Lisbon', 'UTC'];
  }
}

export function SettingsPage() {
  const { data: s } = useSettings();
  const { data: me } = useMe();
  const save = useSettingsMutation();
  const qc = useQueryClient();
  const { toast } = useUI();
  const push = usePushState();
  const [editingCat, setEditingCat] = useState<Category | 'new' | null>(null);
  const [customRem, setCustomRem] = useState('');
  const [pwOpen, setPwOpen] = useState(false);

  const devices = useQuery({
    queryKey: ['devices'],
    queryFn: () => api<{ subscriptions: { id: string; deviceLabel: string; createdAt: string; lastSuccessAt: string | null; lastError: string | null }[] }>('/push/subscriptions').then((r) => r.subscriptions),
  });
  const history = useQuery({ queryKey: ['history'], queryFn: () => api<{ history: any[] }>('/push/history').then((r) => r.history) });

  if (!s) return <div className="skeleton" style={{ height: 300 }} />;

  const update = (changes: Partial<Settings>) =>
    save.mutate(changes, { onError: (e) => toast(e instanceof ApiError ? e.message : 'Não foi possível salvar.', { kind: 'error' }) });

  const toggleDefault = (m: number) => update({ defaultReminders: s.defaultReminders.includes(m) ? s.defaultReminders.filter((x) => x !== m) : [...s.defaultReminders, m].sort((a, b) => a - b) });

  async function sendTest(type: 'simple' | 'daily' | 'weekly') {
    try {
      await api('/push/test', { method: 'POST', body: { type } });
      toast('Notificação enviada!');
      history.refetch();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Falha no envio.', { kind: 'error' });
    }
  }

  async function logout() {
    await api('/auth/logout', { method: 'POST', body: {} }).catch(() => {});
    qc.clear();
    qc.setQueryData(['me'], null);
  }

  const zones = timezones();

  return (
    <>
      <div className="page-head"><div><div className="eyebrow">{me?.email}</div><h1>Ajustes</h1></div></div>

      <h2 style={{ margin: '0 0 10px' }}>Notificações</h2>
      <div className="card set-group">
        <Row title="Notificações push" hint={push === 'on' ? 'Ativas neste dispositivo' : push === 'denied' ? 'Bloqueadas no navegador' : 'Desativadas neste dispositivo'}>
          <Link className="btn sm" to="/notificacoes"><Bell size={14} /> Gerenciar</Link>
        </Row>
        <Row title="Resumo diário" hint="Programação do dia, todas as manhãs">
          <div className="row">
            <input className="input" style={{ height: 36 }} type="time" value={s.dailyTime} disabled={!s.dailyEnabled} onChange={(e) => e.target.value && update({ dailyTime: e.target.value })} aria-label="Horário do resumo diário" />
            <Switch checked={s.dailyEnabled} onChange={(v) => update({ dailyEnabled: v })} label="Resumo diário" />
          </div>
        </Row>
        <Row title="Resumo semanal" hint="Planejamento de segunda a domingo">
          <div className="row" style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <select className="select" style={{ height: 36 }} value={s.weeklyDay} disabled={!s.weeklyEnabled} onChange={(e) => update({ weeklyDay: Number(e.target.value) })} aria-label="Dia do resumo semanal">
              {DAYS.slice(1).map((d, i) => <option key={d} value={i + 1}>{d}</option>)}
            </select>
            <input className="input" style={{ height: 36 }} type="time" value={s.weeklyTime} disabled={!s.weeklyEnabled} onChange={(e) => e.target.value && update({ weeklyTime: e.target.value })} aria-label="Horário do resumo semanal" />
            <Switch checked={s.weeklyEnabled} onChange={(v) => update({ weeklyEnabled: v })} label="Resumo semanal" />
          </div>
        </Row>
        <Row title="Lembretes de compromissos" hint="Avisos antes de cada tarefa">
          <Switch checked={s.remindersEnabled} onChange={(v) => update({ remindersEnabled: v })} label="Lembretes" />
        </Row>
        <div className="set-row" style={{ display: 'block' }}>
          <div style={{ fontWeight: 550 }}>Lembretes padrão</div>
          <div className="small muted" style={{ marginBottom: 10 }}>Aplicados às novas tarefas (você pode mudar em cada uma).</div>
          <div className="chips">
            {[...new Set([...REMINDER_PRESETS, ...s.defaultReminders])].sort((a, b) => a - b).map((m) => (
              <button key={m} className={`chip ${s.defaultReminders.includes(m) ? 'on' : ''}`} aria-pressed={s.defaultReminders.includes(m)} onClick={() => toggleDefault(m)}>{reminderLabel(m)}</button>
            ))}
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <input className="input" style={{ width: 150, height: 34 }} type="number" min={0} placeholder="Minutos antes" value={customRem} onChange={(e) => setCustomRem(e.target.value)} aria-label="Lembrete personalizado" />
            <button className="btn sm" onClick={() => { const n = Number(customRem); if (customRem !== '' && n >= 0 && !s.defaultReminders.includes(n)) update({ defaultReminders: [...s.defaultReminders, n].sort((a, b) => a - b) }); setCustomRem(''); }}>Adicionar</button>
          </div>
        </div>
        <Row title="Horário dos lembretes sem hora" hint="Para tarefas “durante o dia”">
          <input className="input" style={{ height: 36 }} type="time" value={s.alldayReminderTime} onChange={(e) => e.target.value && update({ alldayReminderTime: e.target.value })} />
        </Row>
      </div>

      <h2 style={{ margin: '28px 0 10px' }}>Aparência e região</h2>
      <div className="card set-group">
        <Row title="Tema">
          <div className="seg">
            {([['system', 'Auto', Monitor], ['light', 'Claro', Sun], ['dark', 'Escuro', Moon]] as const).map(([v, l, Icon]) => (
              <button key={v} className={s.theme === v ? 'on' : ''} onClick={() => update({ theme: v })}><Icon size={14} style={{ verticalAlign: -2, marginRight: 4 }} />{l}</button>
            ))}
          </div>
        </Row>
        <Row title="Visualização inicial do calendário">
          <select className="select" style={{ height: 36 }} value={s.defaultView} onChange={(e) => update({ defaultView: e.target.value as Settings['defaultView'] })}>
            <option value="day">Dia</option><option value="week">Semana</option><option value="month">Mês</option>
          </select>
        </Row>
        <Row title="Fuso horário" hint="Define o horário dos resumos e lembretes">
          <select className="select" style={{ height: 36, maxWidth: 230 }} value={s.timezone} onChange={(e) => update({ timezone: e.target.value })}>
            {!zones.includes(s.timezone) && <option>{s.timezone}</option>}
            {zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
          </select>
        </Row>
      </div>

      <div className="section-head" style={{ margin: '28px 0 10px' }}>
        <h2>Categorias</h2>
        <button className="btn sm" onClick={() => setEditingCat('new')}><Plus size={14} /> Nova</button>
      </div>
      <CategoryList onEdit={setEditingCat} />

      <h2 style={{ margin: '28px 0 10px' }}>Dispositivos conectados</h2>
      <div className="card set-group">
        {devices.data?.length ? devices.data.map((d) => (
          <div className="set-row" key={d.id}>
            <div className="row info"><Smartphone size={18} /><div><div style={{ fontWeight: 550 }}>{d.deviceLabel}</div>
              <div className="xs muted">{d.lastError ? `Último erro: ${d.lastError.slice(0, 60)}` : d.lastSuccessAt ? `Último envio: ${new Date(d.lastSuccessAt).toLocaleString('pt-BR')}` : 'Nenhum envio ainda'}</div></div></div>
            <button className="icon-btn" aria-label="Remover dispositivo" onClick={async () => { await api(`/push/subscriptions/${d.id}`, { method: 'DELETE' }); devices.refetch(); }}><Trash2 size={16} /></button>
          </div>
        )) : <div className="set-row"><span className="muted small">Nenhum dispositivo inscrito para notificações.</span></div>}
        {!!devices.data?.length && (
          <div className="set-row" style={{ flexWrap: 'wrap', justifyContent: 'flex-start' }}>
            <button className="btn sm" onClick={() => sendTest('simple')}><Send size={14} /> Testar notificação</button>
            <button className="btn sm" onClick={() => sendTest('daily')}>Testar resumo diário</button>
            <button className="btn sm" onClick={() => sendTest('weekly')}>Testar resumo semanal</button>
          </div>
        )}
      </div>

      {!!history.data?.length && (
        <>
          <h2 style={{ margin: '28px 0 10px' }}>Últimas notificações</h2>
          <div className="card set-group">
            {history.data.slice(0, 8).map((h) => (
              <div className="set-row" key={h.id}>
                <div className="info"><div className="truncate" style={{ fontWeight: 550 }}>{h.title}</div><div className="xs muted">{new Date(h.createdAt).toLocaleString('pt-BR')} · {h.kind}</div></div>
                <span className={`badge ${h.status === 'sent' ? 'success' : h.status === 'failed' ? 'danger' : ''}`}>{h.status === 'sent' ? 'Enviada' : h.status === 'failed' ? 'Falhou' : h.status === 'sending' ? 'Enviando' : 'Sem dispositivo'}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <h2 style={{ margin: '28px 0 10px' }}>Conta</h2>
      <div className="card set-group">
        <Row title={me?.name ?? ''} hint={me?.email}><button className="btn sm" onClick={() => setPwOpen(true)}>Alterar senha</button></Row>
        <Row title="Sair deste dispositivo"><button className="btn sm danger" onClick={logout}><LogOut size={14} /> Sair</button></Row>
      </div>

      {editingCat && <CategoryEditor category={editingCat === 'new' ? null : editingCat} onClose={() => setEditingCat(null)} />}
      {pwOpen && <PasswordDialog onClose={() => setPwOpen(false)} />}
    </>
  );
}

function CategoryList({ onEdit }: { onEdit: (c: Category) => void }) {
  const { data = [] } = useCategories();
  return (
    <div className="card set-group">
      {data.map((c) => (
        <div className="set-row" key={c.id}>
          <div className="row info"><span style={{ width: 30, height: 30, borderRadius: 8, display: 'grid', placeItems: 'center', background: `color-mix(in srgb, ${c.color} 16%, transparent)`, color: c.color }}><CategoryIcon name={c.icon} size={16} /></span><b style={{ fontWeight: 550 }}>{c.name}</b></div>
          <button className="icon-btn" onClick={() => onEdit(c)} aria-label={`Editar ${c.name}`}><Pencil size={16} /></button>
        </div>
      ))}
    </div>
  );
}

function CategoryEditor({ category, onClose }: { category: Category | null; onClose: () => void }) {
  const m = useCategoryMutations();
  const { toast } = useUI();
  const [name, setName] = useState(category?.name ?? '');
  const [color, setColor] = useState(category?.color ?? CATEGORY_COLORS[0]);
  const [icon, setIcon] = useState(category?.icon ?? 'tag');
  const [confirmDel, setConfirmDel] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    if (!name.trim()) return setError('Informe o nome.');
    try {
      if (category) await m.update.mutateAsync({ id: category.id, name: name.trim(), color, icon });
      else await m.create.mutateAsync({ name: name.trim(), color, icon });
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível salvar.');
    }
  }

  return (
    <>
      <Modal title={category ? 'Editar categoria' : 'Nova categoria'} onClose={onClose}
        footer={<>
          {category && <button className="btn danger" onClick={() => setConfirmDel(true)}><Trash2 size={16} /></button>}
          <button className="btn grow" onClick={onClose}>Cancelar</button>
          <button className="btn primary grow" onClick={save}>Salvar</button>
        </>}>
        <div className="sheet-body">
          <div className="field"><label htmlFor="cn">Nome</label><input id="cn" className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} autoFocus /></div>
          <div className="field"><span className="label">Cor</span>
            <div className="chips">{CATEGORY_COLORS.map((c) => (
              <button key={c} aria-label={c} aria-pressed={color === c} onClick={() => setColor(c)} style={{ width: 32, height: 32, borderRadius: '50%', background: c, border: color === c ? '3px solid var(--text)' : '3px solid transparent', outline: 'none' }} />
            ))}</div></div>
          <div className="field"><span className="label">Ícone</span>
            <div className="chips">{Object.keys(CATEGORY_ICONS).map((k) => (
              <button key={k} aria-label={k} aria-pressed={icon === k} className={`chip ${icon === k ? 'on' : ''}`} style={{ width: 38, padding: 0, justifyContent: 'center', color: icon === k ? color : undefined }} onClick={() => setIcon(k)}><CategoryIcon name={k} size={16} /></button>
            ))}</div></div>
          {error && <p className="error-text">{error}</p>}
        </div>
      </Modal>
      {confirmDel && category && (
        <ConfirmDialog title="Excluir categoria?" text="As tarefas desta categoria serão mantidas, mas ficarão sem categoria." confirmLabel="Excluir" danger onClose={() => setConfirmDel(false)}
          onConfirm={async () => { await m.remove.mutateAsync({ id: category.id }); toast('Categoria excluída'); onClose(); }} />
      )}
    </>
  );
}

function PasswordDialog({ onClose }: { onClose: () => void }) {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState('');
  const { toast } = useUI();
  async function save() {
    try {
      await api('/auth/password', { method: 'POST', body: { currentPassword: cur, newPassword: next } });
      toast('Senha alterada');
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível alterar.');
    }
  }
  return (
    <Modal title="Alterar senha" onClose={onClose} footer={<><button className="btn grow" onClick={onClose}>Cancelar</button><button className="btn primary grow" onClick={save}>Alterar</button></>}>
      <div className="sheet-body">
        <div className="field"><label htmlFor="cp">Senha atual</label><input id="cp" className="input" type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" /></div>
        <div className="field"><label htmlFor="np">Nova senha</label><input id="np" className="input" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" /></div>
        {error && <p className="error-text">{error}</p>}
      </div>
    </Modal>
  );
}
