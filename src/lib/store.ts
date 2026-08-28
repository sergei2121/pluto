// ─── PLUTO: центральное хранилище (встроенный + серверный режимы) ───────────
import { useRef, useSyncExternalStore } from 'react';
import type { Agent, Device, DeviceType, EventItem, Role, Route, Severity, Settings, Tag, User } from './types';
import { DEVICE_TYPES } from './types';
import { clamp, genToken, hashStr, mulberry32, rnd, rndInt, uid } from './util';
import { api, apiLogin, apiState, setApiToken, getApiToken, type ServerState } from './api';

export type ApiMode = 'embedded' | 'server';

export interface Session {
  userId: string;
  at: number;
}

export interface PlutoState {
  users: User[];
  session: Session | null;
  devices: Device[];
  agents: Agent[];
  tags: Tag[];
  events: EventItem[];
  settings: Settings;
  route: Route;
  routeParam: string;
  apiMode: ApiMode;
  coreVersion: string | null;
}

// ─── Тосты ──────────────────────────────────────────────────────────────────

export interface Toast {
  id: string;
  kind: 'ok' | 'warn' | 'crit' | 'info';
  text: string;
}

let toasts: Toast[] = [];
const toastListeners = new Set<() => void>();
function emitToasts() {
  toastListeners.forEach((l) => l());
}

export const useToasts = {
  subscribe(fn: () => void) {
    toastListeners.add(fn);
    return () => {
      toastListeners.delete(fn);
    };
  },
  list(): Toast[] {
    return toasts;
  },
  push(kind: Toast['kind'], text: string) {
    const t: Toast = { id: uid('toast'), kind, text };
    toasts = [...toasts.slice(-3), t];
    emitToasts();
    setTimeout(() => useToasts.drop(t.id), 4500);
  },
  drop(id: string) {
    toasts = toasts.filter((t) => t.id !== id);
    emitToasts();
  },
};

export function useToastList(): Toast[] {
  return useSyncExternalStore(useToasts.subscribe, useToasts.list);
}

// ─── Начальные значения ─────────────────────────────────────────────────────

export function defaultSettings(): Settings {
  return {
    intervals: { ping: 60, http: 60, api: 180, rtsp: 120, sip: 120 },
    heartbeat: 10,
    metrics: 15,
    lanScan: 300,
    failThreshold: 3,
    degradeFactor: 10,
    degradeMinMs: 250,
    timeoutMs: 3000,
    notifications: {
      telegram: { enabled: false, botToken: '', chatId: '' },
      email: { enabled: false, smtp: '', port: 587, from: '', to: '' },
      push: { enabled: false },
      on: { down: true, degraded: true, recover: true, agentOff: true, agentOn: false },
    },
  };
}

function seedAdmin(): User {
  return { id: 'u-admin', name: 'admin', role: 'admin', scope: [], builtIn: true, createdAt: Date.now() };
}

function mkEvent(sev: Severity, source: EventItem['source'], text: string): EventItem {
  return { id: uid('ev'), ts: Date.now(), sev, source, text };
}

/** Подпись ядра, вшитая в index.html при отдаче страницы сервером PLUTO Core. */
const INJECTED_CORE: string | null =
  typeof window !== 'undefined'
    ? (((window as unknown as { __PLUTO_CORE__?: { v?: string } }).__PLUTO_CORE__?.v as string) ?? null)
    : null;

const LS_KEY = 'pluto_state_v1';

function initialState(): PlutoState {
  const s: PlutoState = {
    users: [seedAdmin()],
    session: null,
    devices: [],
    agents: [],
    tags: [],
    events: [mkEvent('info', 'system', 'PLUTO инициализирован — база чистая, устройства не добавлены')],
    settings: defaultSettings(),
    route: 'dashboard',
    routeParam: '',
    apiMode: INJECTED_CORE ? 'server' : 'embedded',
    coreVersion: INJECTED_CORE,
  };
  // восстановление встроенной базы (только для embedded)
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw && !INJECTED_CORE) {
      const p = JSON.parse(raw) as Partial<PlutoState>;
      return {
        ...s,
        ...p,
        settings: { ...s.settings, ...(p.settings || {}), notifications: { ...s.settings.notifications, ...(p.settings?.notifications || {}) } },
        devices: (p.devices || []).map((d) => ({ ...d, checking: false })),
        agents: (p.agents || []).map((a) => ({ ...a, history: [] })),
        route: 'dashboard',
        routeParam: '',
        apiMode: 'embedded',
        coreVersion: null,
      };
    }
  } catch {
    /* повреждённая база — стартуем чистой */
  }
  return s;
}

// ─── Ядро стора ─────────────────────────────────────────────────────────────

let state: PlutoState = initialState();
const listeners = new Set<() => void>();

function persist() {
  if (state.apiMode !== 'embedded') return;
  try {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({
        users: state.users,
        session: state.session,
        devices: state.devices,
        agents: state.agents,
        tags: state.tags,
        events: state.events.slice(0, 100),
        settings: state.settings,
      }),
    );
  } catch {
    /* переполнение хранилища — не критично */
  }
}

function emit() {
  listeners.forEach((l) => l());
}

function set(patch: Partial<PlutoState>) {
  state = { ...state, ...patch };
  persist();
  emit();
}

export function getState(): PlutoState {
  return state;
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function usePluto<T>(selector: (s: PlutoState) => T): T {
  // Кэш снапшота: getSnapshot обязан возвращать ту же ссылку, пока состояние
  // не менялось, — иначе useSyncExternalStore входит в бесконечный цикл
  // перерисовок. Селектор вызывается заново только при новом объекте state.
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

// ─── Видимость по ролям ─────────────────────────────────────────────────────

export function visibleDevices(devices: Device[], user: User | null): Device[] {
  if (!user) return [];
  if (user.role === 'admin') return devices;
  return devices.filter((d) => user.scope.includes(d.type));
}

export function visibleAgents(agents: Agent[], user: User | null): Agent[] {
  if (!user) return [];
  if (user.role === 'admin') return agents;
  return user.scope.includes('agent') ? agents : [];
}

export function useCurrentUser(): User | null {
  const users = usePluto((s) => s.users);
  const session = usePluto((s) => s.session);
  if (!session) return null;
  return users.find((u) => u.id === session.userId) || null;
}

// ─── Действия ───────────────────────────────────────────────────────────────

function pushEvent(sev: Severity, source: EventItem['source'], text: string) {
  set({ events: [mkEvent(sev, source, text), ...state.events].slice(0, 300) });
}

function hashPass(p: string): string {
  return 'h' + hashStr('pluto:' + p).toString(36);
}

export const store = {
  nav(route: Route, param = '') {
    set({ route, routeParam: param });
  },

  // ── вход (встроенный) ──
  login(loginName: string, password: string): string | null {
    const u = state.users.find((x) => x.name.toLowerCase() === loginName.trim().toLowerCase());
    if (!u) return 'Пользователь не найден';
    const stored = (u as unknown as { passHash?: string }).passHash || hashPass('pluto');
    if (u.builtIn ? password !== 'pluto' && stored !== hashPass(password) : stored !== hashPass(password)) {
      return 'Неверный пароль';
    }
    set({ session: { userId: u.id, at: Date.now() }, route: 'dashboard', routeParam: '' });
    pushEvent('info', 'system', `Вход в систему: ${u.name}`);
    return null;
  },

  // ── вход (серверный) ──
  async loginServer(loginName: string, password: string): Promise<string | null> {
    try {
      const user = await apiLogin(loginName.trim(), password);
      set({
        apiMode: 'server',
        users: [user],
        session: { userId: user.id, at: Date.now() },
        route: 'dashboard',
        routeParam: '',
      });
      await syncAll();
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : 'Не удалось связаться с ядром';
    }
  },

  enterServer(user: User) {
    set({
      apiMode: 'server',
      users: [user],
      session: { userId: user.id, at: Date.now() },
      route: 'dashboard',
      routeParam: '',
    });
  },

  // ядро обнаружено, но сессии ещё нет — просто фиксируем режим и версию
  setCoreVersion(v: string) {
    set({ apiMode: 'server', coreVersion: v });
  },

  clearSession() {
    set({ session: null });
  },

  logout() {
    if (state.apiMode === 'server') {
      setApiToken(null);
      if (INJECTED_CORE) {
        set({ session: null, apiMode: 'server', coreVersion: INJECTED_CORE });
      } else {
        set({ apiMode: 'embedded', session: null, users: [seedAdmin()] });
      }
      return;
    }
    set({ session: null });
  },

  applyServerState(st: ServerState) {
    const cur = getState();
    const patch: Partial<PlutoState> = {
      devices: st.devices,
      agents: st.agents,
      events: st.events,
    };
    if (JSON.stringify(st.settings) !== JSON.stringify(cur.settings)) patch.settings = st.settings;
    if (JSON.stringify(st.tags) !== JSON.stringify(cur.tags)) patch.tags = st.tags;
    if (st.users && JSON.stringify(st.users) !== JSON.stringify(cur.users)) patch.users = st.users;
    set(patch);
  },

  // ── устройства ──
  addDevice(d: Omit<Device, 'id' | 'status' | 'latency' | 'baseline' | 'history' | 'fails' | 'lastCheck' | 'lastChange' | 'checking' | 'approx' | 'createdAt' | 'favorite'> & { favorite?: boolean }) {
    if (state.apiMode === 'server') {
      api
        .addDevice({ name: d.name.trim() || d.address, type: d.type, address: d.address.trim(), port: d.port, path: d.path, method: d.method, body: d.body, interval: clamp(Math.round(d.interval), 5, 86400), tags: d.tags })
        .then(() => syncAll())
        .catch((e) => useToasts.push('warn', e?.message || 'Не удалось добавить устройство'));
      return;
    }
    const seed = mulberry32(hashStr(d.type + ':' + d.address));
    const dev: Device = {
      ...d,
      favorite: d.favorite ?? false,
      id: uid('dev'),
      status: 'unknown',
      latency: null,
      baseline: Math.round(10 + seed() * 40),
      history: [],
      fails: 0,
      lastCheck: 0,
      lastChange: Date.now(),
      checking: false,
      approx: true,
      createdAt: Date.now(),
    };
    set({ devices: [...state.devices, dev] });
    pushEvent('info', 'device', `Добавлено устройство ${dev.name} (${dev.type.toUpperCase()})`);
  },

  updateDevice(id: string, patch: Partial<Device>) {
    if (state.apiMode === 'server') {
      const editable = ['name', 'type', 'address', 'port', 'path', 'method', 'body', 'interval', 'tags', 'favorite'] as const;
      const body: Record<string, unknown> = {};
      for (const k of editable) if (k in patch) body[k] = (patch as Record<string, unknown>)[k];
      api.updateDevice(id, body).then(() => syncAll()).catch((e) => useToasts.push('warn', e?.message || 'Не удалось обновить'));
      return;
    }
    const dev = state.devices.find((d) => d.id === id);
    set({ devices: state.devices.map((d) => (d.id === id ? { ...d, ...patch } : d)) });
    if (dev && (patch.name || patch.interval || patch.tags)) pushEvent('info', 'device', `Настройки «${patch.name ?? dev.name}» обновлены`);
  },

  patchDevice(id: string, patch: Partial<Device>) {
    if (state.apiMode === 'server') return;
    set({ devices: state.devices.map((d) => (d.id === id ? { ...d, ...patch } : d)) });
  },

  removeDevice(id: string) {
    if (state.apiMode === 'server') {
      api.deleteDevice(id).then(() => syncAll()).catch((e) => useToasts.push('warn', e?.message || 'Не удалось удалить'));
      return;
    }
    const dev = state.devices.find((d) => d.id === id);
    set({ devices: state.devices.filter((d) => d.id !== id) });
    if (dev) pushEvent('info', 'device', `Устройство «${dev.name}» удалено`);
  },

  toggleDeviceFav(id: string) {
    const d = state.devices.find((x) => x.id === id);
    if (!d) return;
    store.updateDevice(id, { favorite: !d.favorite });
  },

  // ── агенты ──
  async createAgentToken(name: string): Promise<{ token: string; agent: Agent } | null> {
    if (state.apiMode === 'server') {
      try {
        const r = await api.createAgentToken(name);
        await syncAll();
        return { token: r.token, agent: r.agent };
      } catch (e) {
        useToasts.push('warn', e instanceof Error ? e.message : 'Не удалось создать токен');
        return null;
      }
    }
    const agent: Agent = {
      id: uid('ag'),
      name: name || 'agent-' + uid('x').slice(-4),
      hostname: '',
      token: genToken(),
      ip: '',
      os: '',
      version: '',
      online: false,
      cpuLoad: 0,
      cpuCores: 0,
      cpuTemp: 0,
      ramUsed: 0,
      ramTotal: 0,
      ramTemp: 0,
      disks: [],
      rxBytes: 0,
      txBytes: 0,
      rxRate: 0,
      txRate: 0,
      networks: [],
      lastSeen: 0,
      lastMetrics: 0,
      lastScan: 0,
      history: [],
      favorite: false,
      createdAt: Date.now(),
    };
    set({ agents: [...state.agents, agent] });
    pushEvent('info', 'agent', `Создан токен для агента «${agent.name}»`);
    return { token: agent.token, agent };
  },

  updateAgent(id: string, patch: Partial<Agent>) {
    if (state.apiMode === 'server') {
      const body: Record<string, unknown> = {};
      for (const k of ['name', 'favorite', 'aida64Url'] as const) if (k in patch) body[k] = (patch as Record<string, unknown>)[k];
      api.updateAgent(id, body).then(() => syncAll()).catch(() => {});
      return;
    }
    set({ agents: state.agents.map((a) => (a.id === id ? { ...a, ...patch } : a)) });
  },

  patchAgent(id: string, patch: Partial<Agent>) {
    if (state.apiMode === 'server') return;
    set({ agents: state.agents.map((a) => (a.id === id ? { ...a, ...patch } : a)) });
  },

  removeAgent(id: string) {
    if (state.apiMode === 'server') {
      api.deleteAgent(id).then(() => syncAll()).catch((e) => useToasts.push('warn', e?.message || 'Не удалось удалить агента'));
      return;
    }
    const a = state.agents.find((x) => x.id === id);
    set({ agents: state.agents.filter((x) => x.id !== id) });
    if (a) pushEvent('info', 'agent', `Агент «${a.name}» удалён`);
  },

  toggleAgentFav(id: string) {
    const a = state.agents.find((x) => x.id === id);
    if (!a) return;
    store.updateAgent(id, { favorite: !a.favorite });
  },

  // ── теги ──
  addTag(label: string, color: string): string | null {
    const l = label.trim();
    if (!l) return 'Укажите название тега';
    if (state.apiMode === 'server') {
      api.addTag(l, color).then(() => syncAll()).catch((e) => useToasts.push('warn', e?.message || 'Не удалось создать тег'));
      return null;
    }
    if (state.tags.some((t) => t.label.toLowerCase() === l.toLowerCase())) return 'Такой тег уже есть';
    set({ tags: [...state.tags, { id: uid('tag'), label: l, color }] });
    return null;
  },

  removeTag(id: string) {
    if (state.apiMode === 'server') {
      api.deleteTag(id).then(() => syncAll()).catch((e) => useToasts.push('warn', e?.message || 'Не удалось удалить тег'));
      return;
    }
    const t = state.tags.find((x) => x.id === id);
    set({
      tags: state.tags.filter((x) => x.id !== id),
      devices: state.devices.map((d) => ({ ...d, tags: d.tags.filter((x) => x !== id) })),
    });
    if (t) pushEvent('info', 'system', `Тег «${t.label}» удалён`);
  },

  // ── настройки ──
  saveSettings(settings: Settings) {
    if (state.apiMode === 'server') {
      api.saveSettings(settings).then(() => syncAll()).catch((e) => useToasts.push('warn', e?.message || 'Не удалось сохранить'));
      return;
    }
    set({ settings });
    pushEvent('info', 'system', 'Системные настройки сохранены');
  },

  setSettingsRaw(settings: Settings) {
    set({ settings });
  },

  // ── пользователи ──
  addUser(u: { name: string; password: string; role: Role; scope: string[] }): string | null {
    if (state.apiMode === 'server') {
      api.addUser(u).then(() => syncAll()).catch((e) => useToasts.push('warn', e?.message || 'Не удалось создать'));
      return null;
    }
    if (state.users.some((x) => x.name.toLowerCase() === u.name.toLowerCase())) return 'Такой логин уже есть';
    const user: User & { passHash: string } = {
      id: uid('u'),
      name: u.name,
      role: u.role,
      scope: u.scope,
      builtIn: false,
      createdAt: Date.now(),
      passHash: hashPass(u.password),
    };
    set({ users: [...state.users, user] });
    pushEvent('info', 'system', `Создан пользователь ${u.name}`);
    return null;
  },

  updateUser(id: string, patch: Partial<User> & { password?: string }) {
    if (state.apiMode === 'server') {
      api.updateUser(id, patch as Record<string, unknown>).then(() => syncAll()).catch((e) => useToasts.push('warn', e?.message || 'Не удалось обновить'));
      return;
    }
    set({
      users: state.users.map((u) => {
        if (u.id !== id) return u;
        const nu: User & { passHash?: string } = { ...u, ...patch };
        if (patch.password) nu.passHash = hashPass(patch.password);
        return nu;
      }),
    });
  },

  removeUser(id: string): string | null {
    const u = state.users.find((x) => x.id === id);
    if (!u) return 'Пользователь не найден';
    if (u.builtIn) return 'Нельзя удалить встроенного администратора';
    if (state.apiMode === 'server') {
      api.deleteUser(id).then(() => syncAll()).catch((e) => useToasts.push('warn', e?.message || 'Не удалось удалить'));
      return null;
    }
    set({ users: state.users.filter((x) => x.id !== id) });
    pushEvent('info', 'system', `Пользователь ${u.name} удалён`);
    return null;
  },

  pushEvent,
};

// ─── Синхронизация с ядром ──────────────────────────────────────────────────

export async function syncAll(): Promise<void> {
  if (getState().apiMode !== 'server' || !getApiToken()) return;
  try {
    const st = await apiState();
    getState(); // no-op
    store.applyServerState(st);
  } catch (e) {
    if (e instanceof Error && e.message.includes('Сессия истекла')) {
      set({ session: null });
    }
  }
}

// вспомогательные экспорты для движка
export const FAVORITES_LIMIT = 15;
export { rnd, rndInt, clamp, DEVICE_TYPES };
export type { DeviceType };
