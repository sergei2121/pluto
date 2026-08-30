// ─── PLUTO: клиент REST API серверного ядра ─────────────────────────────────
import type {
  Agent, Device, EventItem, GlancesDevice, GlancesPoint, Settings, SourceTestReport, Tag, User,
} from './types';

const TOKEN_KEY = 'pluto_token';

let tokenCache: string | null | undefined;

export function getApiToken(): string | null {
  if (tokenCache === undefined) {
    try { tokenCache = localStorage.getItem(TOKEN_KEY); } catch { tokenCache = null; }
  }
  return tokenCache;
}

export function setApiToken(t: string | null) {
  tokenCache = t;
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* приватный режим */ }
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
  try { data = await res.json(); } catch { /* пустой ответ */ }
  if (!res.ok) {
    const msg = (data as { error?: string } | null)?.error || `HTTP ${res.status}`;
    if (res.status === 401 && getApiToken()) setApiToken(null);
    throw new Error(msg);
  }
  return data as T;
}

/**
 * Проверка доступности ядра. Сначала смотрим подпись, вшитую ядром в index.html
 * (страницу отдал настоящий PLUTO Core — эмуляция невозможна), затем /api/health.
 */
export async function detectApi(): Promise<string | null> {
  const injected = (window as unknown as { __PLUTO_CORE__?: { v?: string } }).__PLUTO_CORE__;
  if (injected && typeof injected.v === 'string') return injected.v;
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 2000);
    const res = await fetch('/api/health', { signal: ctrl.signal });
    clearTimeout(to);
    if (res.ok) {
      const j = (await res.json()) as { version?: string };
      return j.version || 'legacy';
    }
    if (res.status === 401) return 'legacy'; // старое ядро: health требует авторизации
    return null;
  } catch {
    return null;
  }
}

export interface ServerState {
  devices: Device[];
  agents: Agent[];
  glances?: GlancesDevice[];
  tags: Tag[];
  events: EventItem[];
  settings: Settings;
  users?: User[];
}

export const api = {
  login: (login: string, password: string) =>
    req<{ token: string; user: User }>('POST', '/api/auth/login', { login, password }).then((r) => {
      setApiToken(r.token);
      return r.user;
    }),

  me: () => req<User>('GET', '/api/auth/me'),
  state: () => req<ServerState>('GET', '/api/state'),

  // устройства
  addDevice: (b: Record<string, unknown>) => req<Device>('POST', '/api/devices', b),
  updateDevice: (id: string, b: Record<string, unknown>) => req<Device>('PUT', `/api/devices/${id}`, b),
  deleteDevice: (id: string) => req<{ ok: boolean }>('DELETE', `/api/devices/${id}`),
  checkDevice: (id: string) => req<{ result: { ok: boolean; latency: number } }>('POST', `/api/devices/${id}/check`),

  // агенты (IP + Glances + relay)
  addAgent: (b: { name: string; ip: string; glancesUrl?: string; relayUrl?: string; pingTargets?: string[] }) =>
    req<Agent>('POST', '/api/agents', b),
  updateAgent: (id: string, b: Record<string, unknown>) => req<Agent>('PUT', `/api/agents/${id}`, b),
  deleteAgent: (id: string) => req<{ ok: boolean }>('DELETE', `/api/agents/${id}`),
  pollAgent: (id: string) => req<Agent>('POST', `/api/agents/${id}/poll`),
  testAgentSource: (id: string) => req<SourceTestReport>('GET', `/api/agents/${id}/test-glances`),
  agentGlances: (id: string, range: string) =>
    req<{ range: string; retentionDays: number; points: GlancesPoint[] }>('GET', `/api/agents/${id}/glances?range=${encodeURIComponent(range)}`),

  // Glances-устройства (Bars)
  addGlances: (b: { name: string; url: string; serverLink: string }) => req<GlancesDevice>('POST', '/api/glances', b),
  deleteGlances: (id: string) => req<{ ok: boolean }>('DELETE', `/api/glances/${id}`),
  scrapeGlances: (id: string) => req<{ point: GlancesPoint | null; error: string | null }>('POST', `/api/glances/${id}/scrape`),
  glancesHistory: (id: string, range: string) =>
    req<{ range: string; retentionDays: number; points: GlancesPoint[] }>('GET', `/api/glances/${id}/history?range=${encodeURIComponent(range)}`),

  // теги
  addTag: (label: string, color: string) => req<Tag>('POST', '/api/tags', { label, color }),
  deleteTag: (id: string) => req<{ ok: boolean }>('DELETE', `/api/tags/${id}`),

  // пользователи
  addUser: (b: { name: string; login: string; role: string; scope: string[]; password: string }) =>
    req<User>('POST', '/api/users', b),
  updateUser: (id: string, b: Record<string, unknown>) => req<User>('PUT', `/api/users/${id}`, b),
  deleteUser: (id: string) => req<{ ok: boolean }>('DELETE', `/api/users/${id}`),

  // настройки
  saveSettings: (s: Settings) => req<Settings>('PUT', '/api/settings', s),
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
