// ─── PLUTO: клиент REST API серверного ядра ──────────────────────────────────
import type { Agent, Device, EventItem, RelayPingResult, Settings, Tag, User } from './types';

const TOKEN_KEY = 'pluto_token';

export function getApiToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setApiToken(t: string | null) {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* noop */ }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(getApiToken() ? { Authorization: `Bearer ${getApiToken()}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* пустой ответ */
  }
  if (!res.ok) {
    const msg = (data as { error?: string } | null)?.error || `HTTP ${res.status}`;
    if (res.status === 401 && getApiToken()) setApiToken(null);
    throw new Error(msg);
  }
  return data as T;
}

/** Проверка доступности ядра; возвращает версию или null. */
export async function detectApi(): Promise<string | null> {
  // Подпись, вшитая ядром в index.html — надёжнее запроса
  const injected = (window as unknown as { __PLUTO_CORE__?: { v?: string } }).__PLUTO_CORE__;
  if (injected && typeof injected.v === 'string') return injected.v;
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 2000);
    const res = await fetch('/api/health', { signal: ctrl.signal });
    clearTimeout(to);
    if (!res.ok) return null;
    const j = (await res.json()) as { version?: string };
    return j.version || 'unknown';
  } catch {
    return null;
  }
}

export interface ServerState {
  devices: Device[];
  agents: Agent[];
  tags: Tag[];
  events: EventItem[];
  settings: Settings;
  users?: User[];
}

export const api = {
  login: (login: string, password: string) =>
    req<{ token: string; user: User }>('POST', '/api/auth/login', { login, password }),
  me: () => req<User>('GET', '/api/auth/me'),

  state: () => req<ServerState>('GET', '/api/state'),

  addDevice: (d: Partial<Device>) => req<Device>('POST', '/api/devices', d),
  updateDevice: (id: string, b: Partial<Device>) => req<Device>('PUT', `/api/devices/${id}`, b),
  deleteDevice: (id: string) => req<{ ok: boolean }>('DELETE', `/api/devices/${id}`),
  checkDevice: (id: string) => req<{ ok: boolean; latency: number }>('POST', `/api/devices/${id}/check`),

  addAgent: (a: Partial<Agent>) => req<Agent>('POST', '/api/agents', a),
  updateAgent: (id: string, b: Partial<Agent>) => req<Agent>('PUT', `/api/agents/${id}`, b),
  deleteAgent: (id: string) => req<{ ok: boolean }>('DELETE', `/api/agents/${id}`),
  pollAgent: (id: string) => req<Agent>('POST', `/api/agents/${id}/poll`),

  saveSettings: (s: Settings) => req<Settings>('PUT', '/api/settings', s),
  restartShowcase: () => req<{ ok: boolean; port: number }>('POST', '/api/showcase/restart'),

  relayPing: (agentId: string, targets: string) =>
    req<RelayPingResult[]>('GET', `/api/agents/${agentId}/relay-ping?targets=${encodeURIComponent(targets)}`),
};

export async function apiMe(): Promise<User> {
  return api.me();
}

/** Полный снимок состояния ядра → стор. */
export async function syncAll(): Promise<void> {
  const { store } = await import('./store');
  const st = await api.state();
  store.applyServerState(st);
}
