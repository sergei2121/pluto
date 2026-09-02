// ─── PLUTO: клиент REST API серверного ядра ─────────────────────────────────
import type { Agent, AlertRule, AuditEntry, BackupEntry, Device, EventItem, Settings, SlaRow, SourceTestReport, Tag, User, Webhook } from './types';
import { getState, store } from './store';

const TOKEN_KEY = 'pluto_token';
let token: string | null = null;

export function setApiToken(t: string | null) { token = t; if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); }
export function getApiToken(): string | null { if (token == null) token = localStorage.getItem(TOKEN_KEY); return token; }

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const t = getApiToken();
  if (t) headers['Authorization'] = `Bearer ${t}`;
  const res = await fetch(path, { method, headers, body: body != null ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  return data as T;
}

export interface ServerState {
  devices: Device[];
  agents: Agent[];
  tags: Tag[];
  events: EventItem[];
  alertRules: AlertRule[];
  webhooks: Webhook[];
  audit: AuditEntry[];
  backups: BackupEntry[];
  settings: Settings;
  users?: User[];
}

/** Проверка доступности ядра; возвращает версию или null. */
export async function detectApi(): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch('/api/health', { signal: ctrl.signal });
    clearTimeout(to);
    if (!res.ok) return null;
    const d = await res.json();
    return d && d.version ? String(d.version) : 'legacy';
  } catch {
    return null;
  }
}

export const api = {
  login: (loginStr: string, pass: string) => req<{ token: string; user: User }>('POST', '/api/auth/login', { login: loginStr, pass }),
  me: () => req<User>('GET', '/api/auth/me'),
  state: () => req<ServerState>('GET', '/api/state'),

  addDevice: (b: unknown) => req<Device>('POST', '/api/devices', b),
  updateDevice: (id: string, b: unknown) => req<Device>('PUT', `/api/devices/${id}`, b),
  deleteDevice: (id: string) => req<{ ok: boolean }>('DELETE', `/api/devices/${id}`),
  clearDevices: () => req<{ ok: boolean; removed: number }>('DELETE', '/api/devices'),
  checkDevice: (id: string) => req<{ ok: boolean; latency: number }>('POST', `/api/devices/${id}/check`),

  addAgent: (b: unknown) => req<Agent>('POST', '/api/agents', b),
  updateAgent: (id: string, b: unknown) => req<Agent>('PUT', `/api/agents/${id}`, b),
  deleteAgent: (id: string) => req<{ ok: boolean }>('DELETE', `/api/agents/${id}`),
  pollAgent: (id: string) => req<Agent>('POST', `/api/agents/${id}/poll`),
  agentGlances: (id: string, range: string) =>
    req<{ range: string; retentionDays: number; points: unknown[] }>('GET', `/api/agents/${id}/glances?range=${encodeURIComponent(range)}`),
  testAgentSource: (id: string) => req<SourceTestReport>('GET', `/api/agents/${id}/test-glances`),

  addTag: (label: string, color: string) => req<Tag>('POST', '/api/tags', { label, color }),
  deleteTag: (id: string) => req<{ ok: boolean }>('DELETE', `/api/tags/${id}`),

  saveSettings: (s: Settings) => req<Settings>('PUT', '/api/settings', s),
  restartShowcase: () => req<{ ok: boolean; port: number }>('POST', '/api/showcase/restart'),
  mirrorSyncNow: () => req<{ ok: boolean; error?: string | null }>('POST', '/api/mirror/sync-now'),

  // пороги / алерты
  upsertAlertRule: (r: AlertRule) => req<AlertRule>('POST', '/api/alerts', r),
  deleteAlertRule: (id: string) => req<{ ok: boolean }>('DELETE', `/api/alerts/${id}`),

  // вебхуки
  upsertWebhook: (w: Webhook) => req<Webhook>('POST', '/api/webhooks', w),
  deleteWebhook: (id: string) => req<{ ok: boolean }>('DELETE', `/api/webhooks/${id}`),
  testWebhook: (id: string) => req<{ ok: boolean; error?: string | null }>('POST', `/api/webhooks/${id}/test`),

  // пользователи (с правами меню)
  saveUser: (u: User, password?: string) => req<User>('POST', '/api/users', { ...u, password }),
  deleteUser: (id: string) => req<{ ok: boolean }>('DELETE', `/api/users/${id}`),

  // 2FA
  twoFASetup: () => req<{ secret: string; otpauth: string }>('POST', '/api/2fa/setup'),
  twoFAConfirm: (code: string) => req<{ ok: boolean }>('POST', '/api/2fa/confirm', { code }),
  twoFADisable: () => req<{ ok: boolean }>('POST', '/api/2fa/disable'),

  // бэкапы
  backupNow: () => req<BackupEntry>('POST', '/api/backup/now'),
  downloadBackup: (name: string) => `/api/backup/${encodeURIComponent(name)}`,
  deleteBackup: (name: string) => req<{ ok: boolean }>('DELETE', `/api/backup/${encodeURIComponent(name)}`),

  // импорт устройств из CSV
  importDevices: (rows: unknown[]) => req<{ added: number; skipped: number }>('POST', '/api/devices/import', { rows }),

  // SLA
  sla: (days: number) => req<SlaRow[]>('GET', `/api/sla?days=${days}`),

  // инвентаризация агента
  collectInventory: (id: string) => req<Agent>('POST', `/api/agents/${id}/inventory`),
};

/** Полная синхронизация состояния с ядром. */
export async function syncAll(): Promise<void> {
  if (getState().apiMode !== 'server') return;
  const st = await api.state();
  store.applyServerState(st);
}

/** Восстановление сессии по сохранённому токену. */
export async function restoreServerSession(): Promise<boolean> {
  const t = getApiToken();
  if (!t) return false;
  try {
    const me = await api.me();
    store.enterServer(me);
    await syncAll();
    return true;
  } catch {
    setApiToken(null);
    return false;
  }
}
