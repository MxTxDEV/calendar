import { api } from './api';

export type PushSupport =
  | { ok: true }
  | { ok: false; reason: 'unsupported' | 'ios-not-installed' | 'insecure'; message: string };

export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;

export function pushSupport(): PushSupport {
  if (!window.isSecureContext) return { ok: false, reason: 'insecure', message: 'Notificações exigem uma conexão segura (HTTPS).' };
  const has = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (has) return { ok: true };
  if (isIOS() && !isStandalone()) {
    return { ok: false, reason: 'ios-not-installed', message: 'No iPhone/iPad, instale o app na Tela de Início para ativar as notificações.' };
  }
  return { ok: false, reason: 'unsupported', message: 'Este navegador não suporta notificações push.' };
}

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch (err) {
    console.warn('Falha ao registrar o service worker', err);
    return null;
  }
}

async function getRegistration() {
  if (import.meta.env.DEV) {
    // em desenvolvimento o SW também é necessário para testar push
    return (await navigator.serviceWorker.getRegistration()) ?? navigator.serviceWorker.register('/sw.js', { scope: '/' });
  }
  return navigator.serviceWorker.ready;
}

function urlBase64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export async function currentSubscription() {
  if (pushSupport().ok !== true) return null;
  const reg = await getRegistration();
  return reg.pushManager.getSubscription();
}

/** Pede permissão, inscreve no PushManager e registra o dispositivo no servidor. */
export async function enablePush() {
  const support = pushSupport();
  if (!support.ok) throw new Error(support.message);
  const { enabled, publicKey } = await api<{ enabled: boolean; publicKey: string | null }>('/push/public-key');
  if (!enabled || !publicKey) throw new Error('O servidor ainda não está configurado para enviar notificações (chaves VAPID).');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(permission === 'denied' ? 'Permissão negada. Libere as notificações nas configurações do navegador/aparelho.' : 'Permissão não concedida.');
  }
  const reg = await getRegistration();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
  }
  await api('/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
  return sub;
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  await api('/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => {});
  await sub.unsubscribe();
}

/** Garante que a inscrição local continua registrada no servidor (ex.: após novo login). */
export async function syncSubscription() {
  try {
    if (pushSupport().ok !== true || Notification.permission !== 'granted') return;
    const sub = await currentSubscription();
    if (sub) await api('/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
  } catch {
    /* silencioso */
  }
}
