// ─── PLUTO: глобальное хранилище (pub/sub + useSyncExternalStore) ───────────
import { useRef, useSyncExternalStore } from 'react';
import type {
  Agent, ApiMode, Device, EventItem, GlancesDevice, Route, Severity, Settings, Tag, User,
} from './types';
import { uid, clamp } from './util';
import { api, apiMe, syncAll, getApiToken, setApiToken } from './api';

// ─── Тосты ──────────────────────────────────────────────────────────────────

export interface Toast {
  id: string;
  kind: 'ok' | 'warn' | 'crit' | 'info';
  text: string;
}

let toastState: Toast[] = [];
const toastListeners = new Set<() => void>();

export const useToasts = {
  push(kind: Toast['kind'], text: string) {
    const t: Toast = { id: uid('toast'), kind, text };
    toastState = [...toastState.slice(-3), t];
    toastListeners.forEach((f) => f());
    setTimeout(() => useToasts.drop(t.id), 5200);
  },
  drop(id: string) {
    toastState = toastState.filter((t) => t.id !== id);
    toastListeners.forEach((f) => f());
  },
};

export function useToastList(): Toast[] {
  return useSyncExternalStore((f) => {
    toastListeners.add(f);
    return () => toastListeners.delete(f);
  }, () => toastState);
}

// ─── Хранилище ──────────────────────────────────────────────────────────────

interface PlutoState {
  users: User[];
  session: { userId: string; at: number } | null;
  devices: Device[];
  agents: Agent[];
  glances: GlancesDevice[];
  tags: Tag[];
  events: EventItem[];
  settings: Settings;
  route: Route;
  routeParam: string;
  apiMode: ApiMode;
  coreVersion: string | null;
  mirror: boolean;
  mirrorLast: { t: number; ok: boolean; error: string | null } | null;
  mirrorSyncedAt: number | null;
  mirrorVersion: string | null;
}

const INJECTED_CORE: string | null =
  typeof window !== 'undefined'
    ? (((window as unknown as { __PLUTO_CORE__?: { v?: string } }).__PLUTO_CORE__?.v as string) ?? null)
    : null;

function defaultSettings(): Settings {
  return {
    intervals: { ping: 60, http: 60, api: 180, rtsp: 120, sip: 120, glances: 60, agent: 30 },
    timeoutMs: 3000,
    failThreshold: 3,
    degradeFactor: 10,
    degradeMinMs: 250,
    mirror: { enabled: false, url: '', secret: '', interval: 60 },
    notifications: {
      telegram: { enabled: false, botToken: '', chatId: '' },
      email: { enabled: false, smtp: '', from: '', to: '' },
      push: { enabled: false },
      on: { down: true, degraded: true, recover: true, agentOff: true, agentOn: false },
    },
  };
}

function seedAdmin(): User {
  return { id: 'u-admin', name: 'admin', login: 'admin', role: 'admin', scope: [], builtIn: true, createdAt: Date.now() };
}

function mkEvent(sev: Severity, source: EventItem['source'], text: string): EventItem {
  return { id: uid('ev'), ts: Date.now(), sev, source, text };
}

let state: PlutoState = {
  users: [seedAdmin()],
  session: null,
  devices: [],
  agents: [],
  glances: [],
  tags: [],
  events: [mkEvent('info', 'system', 'PLUTO инициализирован — база чистая')],
  settings: defaultSettings(),
  route: 'dashboard',
  routeParam: '',
  apiMode: INJECTED_CORE ? 'server' : 'embedded',
  coreVersion: INJECTED_CORE,
  mirror: false,
  mirrorLast: null,
  mirrorSyncedAt: null,
  mirrorVersion: null,
};

const listeners = new Set<() => void>();

function subscribe(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}
function emit() {
  listeners.forEach((f) => f());
}
export function getState(): PlutoState {
  return state;
}
function set(patch: Partial<PlutoState>) {
  state = { ...state, ...patch };
  emit();
}

export function usePluto<T>(selector: (s: PlutoState) => T): T {
  const cache = useRef<{ snap: PlutoState; value: T } | null>(null);
  return useSyncExternalStore(subscribe, () => {
    const snap = getState();
    const c = cache.current;
    if (c && c.snap === snap) return c.value;
    const value = selector(snap);
    cache.current = { snap, value };
    return value;
  });
}

export function useCurrentUser(): User | null {
  const session = usePluto((s) => s.session);
  const users = usePluto((s) => s.users);
  if (!session) return null;
  return users.find((u) => u.id === session.userId) ?? null;
}

export function visibleDevices(s: PlutoState, user: User | null): Device[] {
  if (!user) return [];
  return user.role === 'admin' ? s.devices : s.devices.filter((d) => user.scope.includes(d.type));
}
export function visibleAgents(s: PlutoState, user: User | null): Agent[] {
  if (!user) return [];
  return user.role === 'admin' || user.scope.includes('agent') ? s.agents : [];
}
export function visibleGlances(s: PlutoState, user: User | null): GlancesDevice[] {
  if (!user) return [];
  return user.role === 'admin' || user.scope.includes('glances') ? s.glances : [];
}

// ─── Действия ───────────────────────────────────────────────────────────────

function toast(kind: Toast['kind'], text: string) {
  useToasts.push(kind, text);
}

export const store = {
  nav(r: Route, param = '') {
    set({ route: r, routeParam: param });
  },

  // ── auth ──
  login(loginName: string, password: string): string | null {
    const u = getState().users.find((x) => x.login === loginName.trim());
    if (!u) return 'Пользователь не найден';
    if (password.length < 3) return 'Неверный пароль';
    set({ session: { userId: u.id, at: Date.now() }, route: 'dashboard' });
    get().pushEvent('info', 'system', `Вход в систему: ${u.name}`);
    return null;
  },

  logout() {
    set({ session: null });
  },

  clearSession() {
    set({ session: null });
  },

  setCoreVersion(v: string | null) {
    set({ coreVersion: v, apiMode: v ? 'server' : 'embedded' });
  },

  enterServer(user: User) {
    set({ apiMode: 'server', users: [user], session: { userId: user.id, at: Date.now() }, route: 'dashboard', routeParam: '' });
  },

  async loginServer(loginName: string, password: string): Promise<string | null> {
    try {
      const user = await api.login(loginName.trim(), password);
      get().enterServer(user);
      void syncAll();
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : 'Не удалось связаться с ядром';
    }
  },

  serverLogout() {
    setApiToken(null);
    if (INJECTED_CORE) set({ session: null, apiMode: 'server', coreVersion: INJECTED_CORE });
    else set({ session: null, apiMode: 'embedded', users: [seedAdmin()] });
  },

  // ── синхронизация с ядром ──
  applyServerState(st: { devices: Device[]; agents: Agent[]; glances?: GlancesDevice[]; tags: Tag[]; events: EventItem[]; settings: Settings; users?: User[]; mirror?: boolean; mirrorLast?: { t: number; ok: boolean; error: string | null } | null; mirrorSyncedAt?: number | null; mirrorVersion?: string | null }) {
    const cur = getState();
    const safeAgent = (a: Agent): Agent => ({
      ...a,
      pingTargets: Array.isArray(a.pingTargets) ? a.pingTargets : [],
      targets: Array.isArray(a.targets) ? a.targets : [],
      latHist: Array.isArray(a.latHist) ? a.latHist : [],
      glances: Array.isArray(a.glances) ? a.glances : [],
      glancesLatest: a.glancesLatest ?? null,
      glancesDisks: Array.isArray(a.glancesDisks) ? a.glancesDisks : [],
      glancesNetIface: a.glancesNetIface ?? null,
      glancesSensors: Array.isArray(a.glancesSensors) ? a.glancesSensors : [],
      glancesCores: Array.isArray(a.glancesCores) ? a.glancesCores : [],
      latency: a.latency ?? null,
      lastError: a.lastError ?? null,
      glancesUrl: a.glancesUrl ?? '',
      relayUrl: a.relayUrl ?? '',
    });
    const patch: Partial<PlutoState> = {
      devices: (st.devices || []).map((d) => ({ ...d, history: Array.isArray(d.history) ? d.history : [], checking: false })),
      agents: (st.agents || []).map(safeAgent),
      glances: (st.glances ?? []).map((g) => ({ ...g, history: Array.isArray(g.history) ? g.history : [], disks: Array.isArray(g.disks) ? g.disks : [], netIface: g.netIface ?? null })),
      events: st.events || [],
    };
    if (JSON.stringify(st.settings) !== JSON.stringify(cur.settings)) patch.settings = st.settings;
    if (JSON.stringify(st.tags) !== JSON.stringify(cur.tags)) patch.tags = st.tags;
    if (st.users && JSON.stringify(st.users) !== JSON.stringify(cur.users)) patch.users = st.users;
    patch.mirror = !!st.mirror;
    patch.mirrorLast = st.mirrorLast ?? null;
    patch.mirrorSyncedAt = st.mirrorSyncedAt ?? null;
    patch.mirrorVersion = st.mirrorVersion ?? null;
    set(patch);
  },

  pushEvent(sev: Severity, source: EventItem['source'], text: string) {
    set({ events: [mkEvent(sev, source, text), ...getState().events].slice(0, 300) });
  },

  // ── устройства ──
  addDevice(d: Partial<Device>) {
    if (getState().apiMode === 'server') {
      api.addDevice(d as Record<string, unknown>).then(() => syncAll()).catch((e) => toast('warn', e?.message || 'Не удалось добавить'));
      return;
    }
    const dev: Device = {
      id: uid('dev'), name: d.name || d.address || 'устройство', type: d.type || 'ping', address: d.address || '',
      port: d.port ?? null, path: d.path ?? '', method: d.method ?? null, body: d.body ?? null,
      interval: d.interval || 60, tags: d.tags || [], favorite: false, status: 'unknown', latency: null,
      baseline: null, history: [], fails: 0, lastCheck: 0, lastChange: Date.now(), checking: false,
      approx: true, profile: d.profile || { base: 20, failP: 0.03, spikeP: 0.02 }, spikeUntil: 0, createdAt: Date.now(),
    };
    set({ devices: [...getState().devices, dev] });
    get().pushEvent('info', 'device', `Добавлено устройство «${dev.name}» (${dev.type.toUpperCase()} ${dev.address})`);
    toast('ok', `Устройство «${dev.name}» добавлено`);
  },

  updateDevice(id: string, patch: Partial<Device>) {
    if (getState().apiMode === 'server') {
      api.updateDevice(id, patch as Record<string, unknown>).then(() => syncAll()).catch((e) => toast('warn', e?.message || 'Не удалось обновить'));
      return;
    }
    set({ devices: getState().devices.map((d) => (d.id === id ? { ...d, ...patch } : d)) });
  },

  patchDevice(id: string, patch: Partial<Device>) {
    if (getState().apiMode === 'server') return;
    set({ devices: getState().devices.map((d) => (d.id === id ? { ...d, ...patch } : d)) });
  },

  removeDevice(id: string) {
    const d = getState().devices.find((x) => x.id === id);
    if (getState().apiMode === 'server') {
      api.deleteDevice(id).then(() => syncAll()).catch((e) => toast('warn', e?.message || 'Не удалось удалить'));
      return;
    }
    set({ devices: getState().devices.filter((x) => x.id !== id) });
    if (d) get().pushEvent('info', 'device', `Устройство «${d.name}» удалено`);
  },

  toggleDeviceFav(id: string) {
    const s = getState();
    const d = s.devices.find((x) => x.id === id);
    if (!d) return;
    if (s.apiMode === 'server') {
      api.updateDevice(id, { favorite: !d.favorite }).then(() => syncAll()).catch(() => {});
      return;
    }
    set({ devices: s.devices.map((x) => (x.id === id ? { ...x, favorite: !x.favorite } : x)) });
  },

  // ── агенты ──
  async addAgent(d: { name: string; ip: string; glancesUrl?: string; relayUrl?: string; pingTargets?: string[] }): Promise<Agent | null> {
    if (getState().apiMode === 'server') {
      try {
        await api.addAgent(d);
        await syncAll();
        toast('ok', `Агент «${d.name}» добавлен — первый опрос уже идёт`);
        return null;
      } catch (e) {
        toast('warn', e instanceof Error ? e.message : 'Не удалось добавить агента');
        return null;
      }
    }
    const a: Agent = {
      id: uid('ag'), name: d.name, ip: d.ip, glancesUrl: d.glancesUrl || '', relayUrl: d.relayUrl || '',
      pingTargets: d.pingTargets || [], favorite: false, online: false, latency: null, onlineSince: 0,
      lastSeen: 0, lastPoll: 0, lastGlances: 0, lastError: null, glancesLatest: null,
      glancesDisks: [], glancesNetIface: null, glancesSensors: [], glancesCores: [],
      glances: [], latHist: [], targets: [], createdAt: Date.now(),
    };
    set({ agents: [...getState().agents, a] });
    get().pushEvent('info', 'agent', `Добавлен агент «${a.name}» (${a.ip})`);
    return a;
  },

  updateAgent(id: string, patch: Partial<Agent>) {
    if (getState().apiMode === 'server') {
      const body: Record<string, unknown> = {};
      for (const k of ['name', 'ip', 'aidaUrl', 'glancesUrl', 'relayUrl', 'favorite'] as const) {
        if (k in patch) body[k] = (patch as Record<string, unknown>)[k];
      }
      if ('pingTargets' in patch) body.pingTargets = patch.pingTargets;
      api.updateAgent(id, body).then(() => syncAll()).catch((e) => toast('warn', e?.message || 'Не удалось обновить'));
      return;
    }
    set({ agents: getState().agents.map((a) => (a.id === id ? { ...a, ...patch } : a)) });
  },

  patchAgent(id: string, patch: Partial<Agent>) {
    if (getState().apiMode === 'server') return;
    set({ agents: getState().agents.map((a) => (a.id === id ? { ...a, ...patch } : a)) });
  },

  removeAgent(id: string) {
    const a = getState().agents.find((x) => x.id === id);
    if (getState().apiMode === 'server') {
      api.deleteAgent(id).then(() => syncAll()).catch((e) => toast('warn', e?.message || 'Не удалось удалить'));
      return;
    }
    set({ agents: getState().agents.filter((x) => x.id !== id) });
    if (a) get().pushEvent('info', 'agent', `Агент «${a.name}» удалён`);
  },

  toggleAgentFav(id: string) {
    const s = getState();
    const a = s.agents.find((x) => x.id === id);
    if (!a) return;
    if (s.apiMode === 'server') {
      api.updateAgent(id, { favorite: !a.favorite }).then(() => syncAll()).catch(() => {});
      return;
    }
    set({ agents: s.agents.map((x) => (x.id === id ? { ...x, favorite: !x.favorite } : x)) });
  },

  async pollAgentNow(id: string) {
    if (getState().apiMode === 'server') {
      try {
        await api.pollAgent(id);
        await syncAll();
        toast('ok', 'Опрос выполнен');
      } catch (e) {
        toast('warn', e instanceof Error ? e.message : 'Опрос не удался');
      }
    }
  },

  // ── Glances-устройства (Bars) ──
  addGlancesDevice(d: { name: string; url: string; serverLink: string }): string | null {
    if (getState().apiMode === 'server') {
      api.addGlances(d).then(() => syncAll()).catch((e) => toast('warn', e?.message || 'Не удалось добавить'));
      return null;
    }
    const g: GlancesDevice = {
      id: uid('gl'), name: d.name, url: d.url, serverLink: d.serverLink, createdAt: Date.now(),
      lastScrape: 0, lastError: null, online: false, latest: null, history: [],
      disks: [], netIface: null,
    };
    set({ glances: [...getState().glances, g] });
    return null;
  },

  removeGlancesDevice(id: string) {
    if (getState().apiMode === 'server') {
      api.deleteGlances(id).then(() => syncAll()).catch((e) => toast('warn', e?.message || 'Не удалось удалить'));
      return;
    }
    set({ glances: getState().glances.filter((x) => x.id !== id) });
  },

  async scrapeGlancesNow(id: string) {
    if (getState().apiMode === 'server') {
      try {
        await api.scrapeGlances(id);
        await syncAll();
      } catch (e) {
        toast('warn', e instanceof Error ? e.message : 'Опрос не удался');
      }
    }
  },

  // ── теги ──
  addTag(label: string, color: string): string | null {
    const l = label.trim();
    if (!l) return 'Укажите название тега';
    const s = getState();
    if (s.tags.some((t) => t.label.toLowerCase() === l.toLowerCase())) return 'Такой тег уже есть';
    if (s.apiMode === 'server') {
      api.addTag(l, color).then(() => syncAll()).catch((e) => toast('warn', e?.message || 'Не удалось создать тег'));
      return null;
    }
    set({ tags: [...s.tags, { id: uid('tag'), label: l, color }] });
    return null;
  },

  removeTag(id: string) {
    if (getState().apiMode === 'server') {
      api.deleteTag(id).then(() => syncAll()).catch((e) => toast('warn', e?.message || 'Не удалось удалить тег'));
      return;
    }
    const t = getState().tags.find((x) => x.id === id);
    set({
      tags: getState().tags.filter((x) => x.id !== id),
      devices: getState().devices.map((d) => ({ ...d, tags: d.tags.filter((x) => x !== id) })),
    });
    if (t) get().pushEvent('info', 'system', `Тег «${t.label}» удалён`);
  },

  // ── пользователи ──
  addUser(u: { name: string; login: string; role: User['role']; scope: string[]; password: string }): string | null {
    const s = getState();
    if (!u.login.trim() || !u.name.trim()) return 'Заполните логин и имя';
    if (s.users.some((x) => x.login === u.login.trim())) return 'Такой логин уже есть';
    if (s.apiMode === 'server') {
      api.addUser(u).then(() => syncAll()).catch((e) => toast('warn', e?.message || 'Не удалось создать пользователя'));
      return null;
    }
    set({
      users: [...s.users, { id: uid('u'), name: u.name.trim(), login: u.login.trim(), role: u.role, scope: u.scope, builtIn: false, createdAt: Date.now() }],
    });
    return null;
  },

  removeUser(id: string): string | null {
    const s = getState();
    const u = s.users.find((x) => x.id === id);
    if (!u) return 'Пользователь не найден';
    if (u.builtIn) return 'Встроенного администратора удалить нельзя';
    if (s.apiMode === 'server') {
      api.deleteUser(id).then(() => syncAll()).catch((e) => toast('warn', e?.message || 'Не удалось удалить'));
      return null;
    }
    set({ users: s.users.filter((x) => x.id !== id) });
    return null;
  },

  setUserScope(id: string, scope: string[]) {
    if (getState().apiMode === 'server') {
      api.updateUser(id, { scope }).then(() => syncAll()).catch((e) => toast('warn', e?.message || 'Не удалось обновить'));
      return;
    }
    set({ users: getState().users.map((u) => (u.id === id ? { ...u, scope } : u)) });
  },

  // ── настройки ──
  saveSettings(settings: Settings) {
    if (getState().apiMode === 'server') {
      api.saveSettings(settings).then(() => syncAll()).catch((e) => toast('warn', e?.message || 'Не удалось сохранить'));
      return;
    }
    set({ settings });
    get().pushEvent('info', 'system', 'Системные настройки сохранены');
    toast('ok', 'Настройки сохранены');
  },

  async syncMirrorNow() {
    if (getState().apiMode !== 'server') {
      toast('warn', 'Синхронизация доступна только при работе с серверным ядром');
      return;
    }
    try {
      const r = await api.mirrorSyncNow();
      await syncAll();
      if (r.ok) toast('ok', 'Снапшот отправлен на зеркало');
      else toast('warn', r.error || 'Не удалось отправить снапшот');
    } catch (e) {
      toast('warn', e instanceof Error ? e.message : 'Не удалось отправить снапшот');
    }
  },

  setSettingsRaw(settings: Settings) {
    set({ settings });
  },
};

function get() {
  return store;
}

// ─── Персистентность (встроенный режим) ─────────────────────────────────────

const LS_KEY = 'pluto_state_v1';

export function persistNow() {
  if (getState().apiMode === 'server') return;
  try {
    const s = getState();
    localStorage.setItem(LS_KEY, JSON.stringify({
      users: s.users, devices: s.devices, agents: s.agents, glances: s.glances, tags: s.tags,
      events: s.events.slice(0, 120), settings: s.settings,
    }));
  } catch { /* квота localStorage */ }
}

export function rehydrate() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const p = JSON.parse(raw);
    set({
      users: Array.isArray(p.users) && p.users.length ? p.users : [seedAdmin()],
      devices: (p.devices || []).map((d: Device) => ({ ...d, checking: false, history: Array.isArray(d.history) ? d.history : [] })),
      agents: (p.agents || []).map((a: Agent) => ({ ...a, latHist: [], targets: a.targets || [] })),
      glances: p.glances || [],
      tags: p.tags || [],
      events: p.events || [],
      settings: { ...defaultSettings(), ...(p.settings || {}), intervals: { ...defaultSettings().intervals, ...(p.settings?.intervals || {}) } },
    });
  } catch { /* повреждённые данные — стартуем чистыми */ }
}

// автосохранение встроенного режима
let persistTimer: ReturnType<typeof setTimeout> | null = null;
const origEmit = emit;
function debouncedPersist() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(persistNow, 600);
}
listeners.add(debouncedPersist);
void origEmit;

// восстановление сессии серверного режима по токену
export async function restoreServerSession(): Promise<boolean> {
  if (!getApiToken()) return false;
  try {
    const me = await apiMe();
    store.enterServer(me);
    void syncAll();
    return true;
  } catch {
    setApiToken(null);
    return false;
  }
}

export const FAVORITES_LIMIT = 15;

// ограничение избранного
export function guardFavorites(): number {
  const s = getState();
  return s.devices.filter((d) => d.favorite).length + s.agents.filter((a) => a.favorite).length;
}

export function clampInterval(v: number): number {
  return clamp(Math.round(v), 5, 86400);
}
