// ─── PLUTO: клиент REST API серверного ядра ─────────────────────────────────
import type { Agent, AidaPoint, AidaTestReport, Device, EventItem, GlancesDevice, GlancesPoint, GlancesRange, Settings, Tag, User } from './types';

let apiToken: string | null | undefined;
const BASE = ''; // same-origin: ядро отдаёт и консоль, и API

export function getApiToken(): string | null {
  // ленивое чтение: модуль можно безопасно импортировать в любом окружении
  if (apiToken === undefined) {
    try {
      apiToken = typeof localStorage !== 'undefined' ? localStorage.getItem('pluto_token') : null;
    } catch {
      apiToken = null;
    }
  }
  return apiToken;
}
export function setApiToken(t: string | null): void {
  apiToken = t;
  if (t) localStorage.setItem('pluto_token', t);
  else localStorage.removeItem('pluto_token');
}

/** Проверка доступности ядра. Возвращает версию, 'legacy' или null. */
export async function detectApi(): Promise<string | null> {
  // 1. Подпись, вшитая ядром в index.html. Если она есть — страницу отдал
  //    настоящий PLUTO Core, эмуляция невозможна.
  const injected = (window as unknown as { __PLUTO_CORE__?: { v?: string } }).__PLUTO_CORE__;
  if (injected && typeof injected.v === 'string') return injected.v;

  // 2. Прямой запрос (на случай открытия консоли с другого адреса).
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 2000);
    const res = await fetch(BASE + '/api/health', { signal: ctrl.signal });
    clearTimeout(to);
    if (res.ok) {
      const j = await res.json();
      return typeof j.version === 'string' ? j.version : 'server';
    }
    // старая сборка: health требует авторизации, но ошибка фирменная
    if (res.status === 401) {
      const j = await res.json().catch(() => null);
      if (j && typeof j.error === 'string') return 'legacy';
    }
    return null;
  } catch {
    return null;
  }
}

class ApiError extends Error {}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(apiToken ? { Authorization: 'Bearer ' + apiToken } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) {
    setApiToken(null);
    throw new ApiError('Сессия истекла — войдите заново');
  }
  if (!res.ok) {
    const j = await res.json().catch(() => null);
    throw new ApiError((j && (j as { error?: string }).error) || `Ошибка ${res.status}`);
  }
  return (await res.json()) as T;
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

export async function apiLogin(name: string, password: string): Promise<User> {
  const r = await req<{ token: string; user: User }>('POST', '/api/auth/login', { name, password });
  setApiToken(r.token);
  return r.user;
}

export async function apiState(): Promise<ServerState> {
  return req<ServerState>('GET', '/api/state');
}

export async function apiMe(): Promise<User> {
  return req<User>('GET', '/api/auth/me');
}

export const api = {
  addDevice: (b: Partial<Device>) => req<Device>('POST', '/api/devices', b),
  updateDevice: (id: string, b: Record<string, unknown>) => req<Device>('PUT', `/api/devices/${id}`, b),
  deleteDevice: (id: string) => req<{ ok: boolean }>('DELETE', `/api/devices/${id}`),
  checkDevice: (id: string) => req<{ result: { ok: boolean; latency: number } }>('POST', `/api/devices/${id}/check`),

  addAgent: (b: { name: string; ip: string; aidaUrl: string; relayUrl?: string; pingTargets?: string[] }) =>
    req<Agent>('POST', '/api/agents', b),
  updateAgent: (id: string, b: Record<string, unknown>) => req<Agent>('PUT', `/api/agents/${id}`, b),
  deleteAgent: (id: string) => req<{ ok: boolean }>('DELETE', `/api/agents/${id}`),
  pollAgent: (id: string) => req<Agent>('POST', `/api/agents/${id}/poll`),
  testAgentAida: (id: string) => req<AidaTestReport>('GET', `/api/agents/${id}/test-aida`),
  agentAida: (id: string, range: string) => req<{ range: string; retentionDays: number; points: AidaPoint[] }>('GET', `/api/agents/${id}/aida?range=${encodeURIComponent(range)}`),

  // Glances (Bars): ядро само опрашивает веб-страницы, агент не нужен
  addGlances: (b: { name: string; url: string; serverLink: string }) => req<GlancesDevice>('POST', '/api/glances', b),
  updateGlances: (id: string, b: Record<string, unknown>) => req<GlancesDevice>('PUT', `/api/glances/${id}`, b),
  deleteGlances: (id: string) => req<{ ok: boolean }>('DELETE', `/api/glances/${id}`),
  scrapeGlances: (id: string) => req<{ point: GlancesPoint | null; error: string | null }>('POST', `/api/glances/${id}/scrape`),
  glancesHistory: (id: string, range: GlancesRange) =>
    req<{ range: string; retentionDays: number; points: GlancesPoint[] }>('GET', `/api/glances/${id}/history?range=${range}`),

  addTag: (label: string, color: string) => req<Tag>('POST', '/api/tags', { label, color }),
  deleteTag: (id: string) => req<{ ok: boolean }>('DELETE', `/api/tags/${id}`),

  saveSettings: (s: Partial<Settings>) => req<Settings>('PUT', '/api/settings', s),

  addUser: (b: { name: string; password: string; role: string; scope: string[] }) => req<User>('POST', '/api/users', b),
  updateUser: (id: string, b: Record<string, unknown>) => req<User>('PUT', `/api/users/${id}`, b),
  deleteUser: (id: string) => req<{ ok: boolean }>('DELETE', `/api/users/${id}`),
};
