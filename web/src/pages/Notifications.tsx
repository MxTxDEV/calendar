import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, BellOff, CheckCircle2, Share, Smartphone, SquarePlus, Send } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { usePushState } from '../lib/hooks';
import { disablePush, enablePush, isIOS, isStandalone } from '../lib/push';
import { useUI } from '../lib/ui';

export function NotificationsPage() {
  const [key, setKey] = useState(0);
  const state = usePushState(key);
  const [busy, setBusy] = useState(false);
  const { toast } = useUI();
  const ios = isIOS();
  const standalone = isStandalone();

  async function turnOn() {
    setBusy(true);
    try {
      await enablePush();
      toast('Notificações ativadas neste dispositivo 🎉');
      setKey((k) => k + 1);
      await api('/push/test', { method: 'POST', body: { type: 'simple' } }).catch(() => {});
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Não foi possível ativar.', { kind: 'error' });
      setKey((k) => k + 1);
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    await disablePush();
    setKey((k) => k + 1);
    setBusy(false);
    toast('Notificações desativadas neste dispositivo');
  }

  async function test() {
    setBusy(true);
    try {
      await api('/push/test', { method: 'POST', body: { type: 'simple' } });
      toast('Enviada! Deve chegar em instantes.');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Falha no envio.', { kind: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head"><div><div className="eyebrow">Nunca esqueça nada</div><h1>Notificações</h1></div></div>

      <div className="card pad col" style={{ gap: 14 }}>
        <div className="row" style={{ gap: 12 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, display: 'grid', placeItems: 'center', background: state === 'on' ? 'var(--success-soft)' : 'var(--accent-soft)', color: state === 'on' ? 'var(--success)' : 'var(--accent)' }}>
            {state === 'on' ? <CheckCircle2 /> : state === 'denied' ? <BellOff /> : <Bell />}
          </div>
          <div className="grow">
            <b>{state === 'on' ? 'Ativadas neste dispositivo' : state === 'denied' ? 'Bloqueadas pelo navegador' : state === 'loading' ? 'Verificando…' : 'Desativadas neste dispositivo'}</b>
            <div className="small muted">Resumo diário, resumo semanal e lembretes dos compromissos — mesmo com o app fechado.</div>
          </div>
        </div>

        {state === 'off' && <button className="btn primary block" style={{ height: 46 }} onClick={turnOn} disabled={busy}><Bell size={18} /> {busy ? 'Ativando…' : 'Ativar notificações'}</button>}
        {state === 'on' && (
          <div className="row">
            <button className="btn grow" onClick={test} disabled={busy}><Send size={16} /> Enviar teste</button>
            <button className="btn grow danger" onClick={turnOff} disabled={busy}>Desativar</button>
          </div>
        )}
        {state === 'denied' && (
          <p className="small">O navegador bloqueou as notificações deste site. Abra as configurações do site (ícone de cadeado na barra de endereço, ou Ajustes do aparelho) e mude <b>Notificações</b> para <b>Permitir</b>; depois volte aqui.</p>
        )}
        {state === 'unsupported' && <p className="small error-text">Este navegador não suporta notificações push. Use Chrome, Edge, Firefox ou Safari (iOS 16.4+ com o app instalado).</p>}
        {state === 'ios-install' && <p className="small"><b>Quase lá:</b> no iPhone/iPad as notificações só funcionam depois de instalar o app na Tela de Início (passo a passo abaixo).</p>}
      </div>

      <section className="section">
        <h2 style={{ marginBottom: 10 }}>Instalar o app no celular</h2>
        <div className="card pad">
          {ios || !standalone ? (
            <div className="col" style={{ gap: 18 }}>
              <div>
                <div className="row" style={{ marginBottom: 8 }}><Smartphone size={18} /><b>iPhone / iPad (Safari)</b></div>
                <ol className="steps">
                  <li><span>Abra este endereço no <b>Safari</b>.</span></li>
                  <li><span>Toque em <b>Compartilhar</b> <Share size={14} style={{ verticalAlign: -2 }} /> na barra inferior.</span></li>
                  <li><span>Escolha <b>Adicionar à Tela de Início</b> <SquarePlus size={14} style={{ verticalAlign: -2 }} /> e confirme.</span></li>
                  <li><span>Abra o <b>MyDay</b> pelo novo ícone e volte a esta tela para ativar as notificações. (Requer iOS 16.4 ou superior.)</span></li>
                </ol>
              </div>
              <div>
                <div className="row" style={{ marginBottom: 8 }}><Smartphone size={18} /><b>Android (Chrome)</b></div>
                <ol className="steps">
                  <li><span>Toque no menu <b>⋮</b> do Chrome.</span></li>
                  <li><span>Escolha <b>Instalar app</b> (ou <b>Adicionar à tela inicial</b>).</span></li>
                  <li><span>Abra o <b>MyDay</b> pelo ícone e ative as notificações aqui.</span></li>
                </ol>
              </div>
              <div>
                <div className="row" style={{ marginBottom: 8 }}><Smartphone size={18} /><b>Computador (Chrome/Edge)</b></div>
                <p className="small muted">Clique no ícone de instalação na barra de endereço. Também funciona no navegador, sem instalar.</p>
              </div>
            </div>
          ) : (
            <p className="small muted row"><CheckCircle2 size={18} color="var(--success)" /> O MyDay já está instalado neste dispositivo.</p>
          )}
        </div>
      </section>

      <section className="section">
        <h2 style={{ marginBottom: 10 }}>O que você vai receber</h2>
        <div className="card pad col small">
          <div>☀️ <b>Resumo diário</b> — toda manhã (padrão 07:00) com a programação do dia.</div>
          <div>🚀 <b>Resumo semanal</b> — toda segunda-feira (padrão 07:00) com a semana toda.</div>
          <div>⏰ <b>Lembretes</b> — antes de cada compromisso: 5 min, 15 min, 30 min, 1 hora, 1 dia ou o que você definir.</div>
          <div className="muted" style={{ marginTop: 6 }}>Ajuste horários e preferências em <Link to="/configuracoes">Ajustes</Link>.</div>
        </div>
      </section>
    </>
  );
}
