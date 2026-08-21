// ─── PLUTO: клиент REST API серверного ядра ─────────────────────────────────
// Если ядро доступно (GET /api/health), консоль работает с реальными данными:
// проверки выполняет сервер (системный ping, HTTP, RTSP, SIP), телеметрия
// приходит от настоящих Windows-агентов. Если ядра нет — встроенный режим.

import { useStore } from './store';
import type { Agent, Device, EventItem, Settings, Tag, User } from './types';

const TOKEN_KEY = 'pluto.api.token';

export type ApiMode = 'embedded' | 'server';

export function getApiToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setApiToken(t: string | null) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, text: string) {
    super(text);
    this.status = status;
  }
}

async function req<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(path, {
      method: opts.method || 'GET',
      signal: ctrl.signal,
      headers: {
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(getApiToken() ? { Authorization: `Bearer ${getApiToken()}` } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new ApiError(res.status, data.error || `HTTP ${res.status}`);
    return data;
  } finally {
    clearTimeout(to);
  }
}

/** Проверка доступности ядра; возвращает его версию или null */
export async function detectApi(): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch('/api/health', { signal: ctrl.signal });
    clearTimeout(to);
    if (!res.ok) return null;
    const j = (await res.json().catch(() => ({}))) as { version?: string };
    return j.version || 'core';
  } catch {
    return null;
  }
}

// ─── Маппинг моделей ядра ↔ консоли ─────────────────────────────────────────

function mapDevice(sv: any): Device {
  return {
    ...sv,
    latency: sv.latency ?? null,
    approx: false,
    checking: false,
    spikeUntil: 0,
    history: Array.isArray(sv.history) ? sv.history : [],
    profile: { base: sv.baseline || sv.latency || 10, failP: 0, spikeP: 0 },
    createdAt: sv.lastChange || Date.now(),
  } as Device;
}

function mapAgent(sv: any): Agent {
  const hist = Array.isArray(sv.history) ? sv.history : [];
  const last = hist[hist.length - 1];
  return {
    id: sv.id,
    name: sv.name || sv.hostname || 'Агент',
    hostname: sv.hostname || sv.name || '—',
    token: sv.token || '',
    ip: sv.ip || '',
    os: sv.os || '',
    version: sv.version || '',
    online: !!sv.online,
    emulated: false,
    lastSeen: sv.lastSeen || 0,
    connectedAt: sv.lastSeen || 0,
    reconnectAt: 0,
    cpuLoad: last?.cpu ?? sv.cpuLoad ?? 0,
    cpuCores: sv.cpuCores || 0,
    cpuTemp: sv.cpuTemp || 0,
    ramUsed: sv.ramUsed || 0,
    ramTotal: sv.ramTotal || 0,
    ramTemp: sv.ramTemp || 0,
    disks: Array.isArray(sv.disks) ? sv.disks : [],
    netIface: sv.netIface || '',
    rxBytes: sv.rxBytes || 0,
    txBytes: sv.txBytes || 0,
    rxRate: sv.rxRate || 0,
    txRate: sv.txRate || 0,
    networks: (Array.isArray(sv.networks) ? sv.networks : []).map((n: any) => ({
      cidr: n.cidr || '',
      iface: n.iface || '',
      hosts: (Array.isArray(n.hosts) ? n.hosts : []).map((h: any) => ({
        ip: h.ip || '', mac: h.mac || '', hint: h.hint, online: !!h.online,
      })),
    })),
    nextScan: 0,
    lastMetrics: 0,
    lastScan: sv.lastScan || 0,
    history: hist,
    favorite: !!sv.favorite,
    createdAt: sv.lastSeen || Date.now(),
  } as Agent;
}

function mapUser(su: any): User {
  return {
    id: su.id,
    login: su.name,
    pass: '',
    name: su.name,
    role: su.role === 'admin' ? 'admin' : 'viewer',
    scope: su.scope || [],
    builtIn: su.name === 'admin',
    createdAt: 0,
  };
}

function mapSettings(sv: any): Settings {
  const n = sv.notifications || {};
  return {
    intervals: {
      ping: sv.ping ?? 30, http: sv.http ?? 60, api: sv.api ?? 120, rtsp: sv.rtsp ?? 60, sip: sv.sip ?? 120,
    },
    heartbeat: 10,
    metrics: sv.metrics ?? 5,
    lanScan: sv.lanScan ?? 300,
    failThreshold: sv.failThreshold ?? 3,
    degradeFactor: sv.degradeFactor ?? 10,
    degradeMinMs: sv.degradeMinMs ?? 250,
    timeoutMs: sv.timeoutMs ?? 3000,
    simulate: false,
    notifications: {
      telegram: { enabled: !!n.telegram?.enabled, botToken: n.telegram?.botToken ?? '', chatId: n.telegram?.chatId ?? '' },
      email: {
        enabled: !!n.email?.enabled, smtp: n.email?.smtpHost ?? '', port: n.email?.smtpPort ?? 587,
        from: n.email?.from ?? '', to: n.email?.to ?? '',
      },
      push: { enabled: !!n.push?.enabled },
      on: {
        down: n.on?.down ?? true, degraded: n.on?.degraded ?? true, recover: n.on?.recover ?? true,
        agentOff: n.on?.agentOff ?? true, agentOn: n.on?.agentOn ?? false,
      },
    },
  };
}

function toServerSettings(cs: Settings) {
  return {
    ping: cs.intervals.ping, http: cs.intervals.http, api: cs.intervals.api,
    rtsp: cs.intervals.rtsp, sip: cs.intervals.sip,
    metrics: cs.metrics, lanScan: cs.lanScan, timeoutMs: cs.timeoutMs,
    failThreshold: cs.failThreshold, degradeFactor: cs.degradeFactor, degradeMinMs: cs.degradeMinMs,
    notifications: {
      telegram: { enabled: cs.notifications.telegram.enabled, botToken: cs.notifications.telegram.botToken, chatId: cs.notifications.telegram.chatId },
      email: {
        enabled: cs.notifications.email.enabled, smtpHost: cs.notifications.email.smtp,
        smtpPort: cs.notifications.email.port, from: cs.notifications.email.from, to: cs.notifications.email.to,
      },
      push: { enabled: cs.notifications.push.enabled },
      on: cs.notifications.on,
    },
  };
}

// ─── Авторизация ─────────────────────────────────────────────────────────────

export async function apiLogin(login: string, password: string): Promise<User> {
  const r = await req<{ token: string; user: any }>('/api/auth/login', {
    method: 'POST', body: { name: login, password },
  });
  setApiToken(r.token);
  return mapUser(r.user);
}

export async function apiMe(): Promise<User> {
  const r = await req<{ user: any }>('/api/auth/me');
  return mapUser(r.user);
}

export function apiLogout() {
  const t = getApiToken();
  setApiToken(null);
  if (t) fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${t}` } }).catch(() => {});
}

// ─── Состояние ───────────────────────────────────────────────────────────────

export interface ServerState {
  devices: Device[];
  agents: Agent[];
  tags: Tag[];
  events: EventItem[];
  settings: Settings;
  users: User[] | null;
}

export async function fetchServerState(role: string): Promise<ServerState> {
  const [d, a, t, e, st] = await Promise.all([
    req<{ devices: any[] }>('/api/devices'),
    req<{ agents: any[] }>('/api/agents').catch(() => ({ agents: [] })),
    req<{ tags: Tag[] }>('/api/tags'),
    req<{ events: EventItem[] }>('/api/events'),
    req<{ settings: any }>('/api/settings'),
  ]);
  let users: User[] | null = null;
  if (role === 'admin') {
    users = (await req<{ users: any[] }>('/api/users').catch(() => ({ users: [] }))).users.map(mapUser);
  }
  return {
    devices: d.devices.map(mapDevice),
    agents: a.agents.map(mapAgent),
    tags: t.tags,
    events: e.events,
    settings: mapSettings(st.settings),
    users,
  };
}

/** Обновить хранилище консоли данными ядра */
export async function syncAll() {
  const s = useStore.getState();
  const role = s.users.find((u) => u.id === s.session?.userId)?.role || 'viewer';
  try {
    const st = await fetchServerState(role);
    s.applyServerState(st);
    return true;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      setApiToken(null);
      s.serverLogout();
    }
    return false;
  }
}

// ─── Мутации ─────────────────────────────────────────────────────────────────

export const api = {
  addDevice: (d: { name: string; type: string; address: string; port?: number; path?: string; method?: string; body?: string; interval: number; tags: string[] }) =>
    req<{ device: any }>('/api/devices', { method: 'POST', body: d }),
  updateDevice: (id: string, patch: Record<string, unknown>) =>
    req<{ device: any }>(`/api/devices/${id}`, { method: 'PUT', body: patch }),
  deleteDevice: (id: string) => req<{ ok: boolean }>(`/api/devices/${id}`, { method: 'DELETE' }),
  checkDevice: (id: string) => req<{ result: { ok: boolean; latency: number }; device: any }>(`/api/devices/${id}/check`, { method: 'POST' }),

  addTag: (label: string, color: string) => req<{ tag: Tag }>('/api/tags', { method: 'POST', body: { label, color } }),
  deleteTag: (id: string) => req<{ ok: boolean }>(`/api/tags/${id}`, { method: 'DELETE' }),

  saveSettings: (cs: Settings) => req<{ settings: any }>('/api/settings', { method: 'PUT', body: toServerSettings(cs) }),

  saveUser: (u: { id?: string; login: string; name: string; role: string; scope: string[]; pass?: string }) =>
    u.id
      ? req<{ user: any }>(`/api/users/${u.id}`, { method: 'PUT', body: { name: u.login, role: u.role, scope: u.scope, ...(u.pass ? { password: u.pass } : {}) } })
      : req<{ user: any }>('/api/users', { method: 'POST', body: { name: u.login, role: u.role, scope: u.scope, password: u.pass } }),
  deleteUser: (id: string) => req<{ ok: boolean }>(`/api/users/${id}`, { method: 'DELETE' }),

  createAgentToken: (name: string) => req<{ agent: any; token: string }>('/api/agents/token', { method: 'POST', body: { name } }),
  retokenAgent: (id: string) => req<{ token: string }>(`/api/agents/${id}/retoken`, { method: 'POST' }),
  deleteAgent: (id: string) => req<{ ok: boolean }>(`/api/agents/${id}`, { method: 'DELETE' }),
  patchAgent: (id: string, patch: Record<string, unknown>) => req<{ agent: any }>(`/api/agents/${id}`, { method: 'PUT', body: patch }),
};
