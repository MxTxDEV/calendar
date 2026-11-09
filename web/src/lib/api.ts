export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string, public issues?: { path: string; message: string }[]) {
    super(message);
  }
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: opts.method ?? 'GET',
      credentials: 'same-origin',
      headers: opts.body !== undefined ? { 'Content-Type': 'application/json' } : { 'X-Requested-With': 'myday' },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Sem conexão com o servidor. Verifique sua internet.', 'network');
  }
  const raw = await res.text();
  let data: any = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }
  if (!res.ok) {
    if (data.error === undefined) {
      // resposta que não veio do backend do MyDay (proxy, servidor fora do ar, hospedagem só estática…)
      const hint = res.status >= 500 ? 'O servidor do MyDay não respondeu (o backend está rodando e o banco de dados está acessível?)' : res.status === 404 || res.status === 405 ? 'A API do MyDay não foi encontrada neste endereço (o backend está rodando?)' : 'Resposta inesperada do servidor';
      throw new ApiError(res.status, `${hint} [HTTP ${res.status}]`, 'bad_gateway');
    }
    if (res.status === 401 && !path.startsWith('/auth/')) onUnauthorized?.();
    const first = data.issues?.[0]?.message;
    throw new ApiError(res.status, first ?? data.error ?? 'Algo deu errado.', data.code, data.issues);
  }
  return data as T;
}
