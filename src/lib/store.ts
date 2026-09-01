// ─── PLUTO: хранилище состояния (pub/sub + useSyncExternalStore) ─────────────
import { useRef, useSyncExternalStore } from 'react';
import type { Agent, Device, EventItem, Route, Settings, Severity, Tag, User } from './types';
import { uid } from './util';

export type ApiMode = 'embedded' | 'server';

export interface PlutoState {
  users: User[];
  session: { userId: string; at: number } | null;
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

function defaultSettings(): Settings {
  return {
    intervals: { ping: 60, http: 60, api: 180, rtsp: 120, sip: 120, agent: 30, glances: 60 },
    timeoutMs: 3000,
    failThreshold: 3,
    degradeFactor: 10,
    degradeMinMs: 250,
    showcase: { port: 8081 },
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

const INJECTED_CORE: string | null =
  typeof window !== 'undefined'
    ? (((window as unknown as { __PLUTO_CORE__?: { v?: string } }).__PLUTO_CORE__?.v as string) ?? null)
    : null;

let state: PlutoState = {
  users: [seedAdmin()],
  session: null,
  devices: [],
  agents: [],
  tags: [],
  events: [mkEvent('info', 'system', 'PLUTO инициализирован — база чистая')],
  settings: defaultSettings(),
  route: 'dashboard',
  routeParam: '',
  apiMode: INJECTED_CORE ? 'server' : 'embedded',
  coreVersion: INJECTED_CORE,
};

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function set(patch: Partial<PlutoState>) {
  state = { ...state, ...patch };
  emit();
}

export function getState(): PlutoState {
  return state;
}

export function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function usePluto<T>(selector: (s: PlutoState) => T): T {
  // Кэш привязан к объекту state, а НЕ к рендеру: пока set() не создал новый
  // state, getSnapshot возвращает одну и ту же ссылку. Иначе useSyncExternalStore
  // видит «новое» значение при каждом вызове и уходит в бесконечный цикл.
  const cache = useRef<{ snap: PlutoState; value: T } | null>(null);
  return useSyncExternalStore(subscribe, () => {
    const snap = state;
    const c = cache.current;
    if (c && c.snap === snap) return c.value;
    const value = selector(snap);
    cache.current = { snap, value };
    return value;
  });
}

export function useCurrentUser(): User | null {
  return usePluto((s) => (s.session ? s.users.find((u) => u.id === s.session!.userId) ?? null : null));
}

export function visibleDevices(s: PlutoState, user: User | null): Device[] {
  if (!user) return [];
  if (user.role === 'admin') return s.devices;
  return s.devices.filter((d) => user.scope.includes(d.type));
}

export function visibleAgents(s: PlutoState, user: User | null): Agent[] {
  if (!user) return [];
  if (user.role === 'admin') return s.agents;
  return user.scope.includes('agent' as never) ? s.agents : [];
}

export const FAVORITES_LIMIT = 15;

// ─── Тосты ──────────────────────────────────────────────────────────────────
export interface Toast {
  id: string;
  kind: 'ok' | 'warn' | 'crit' | 'info';
  text: string;
}
let toasts: Toast[] = [];
const toastListeners = new Set<() => void>();
export const useToasts = {
  push(kind: Toast['kind'], text: string) {
    const t: Toast = { id: uid('t'), kind, text };
    toasts = [...toasts, t];
    toastListeners.forEach((l) => l());
    setTimeout(() => useToasts.drop(t.id), 5000);
  },
  drop(id: string) {
    toasts = toasts.filter((t) => t.id !== id);
    toastListeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    toastListeners.add(l);
    return () => toastListeners.delete(l);
  },
  get: () => toasts,
};
export function useToastList(): Toast[] {
  return useSyncExternalStore(useToasts.subscribe, useToasts.get);
}

// ─── Действия ───────────────────────────────────────────────────────────────
const toast = (k: Toast['kind'], t: string) => useToasts.push(k, t);

async function syncAll() {
  if (getState().apiMode !== 'server') return;
  const { syncAll: sync } = await import('./api');
  await sync();
}

export const store = {
  nav(route: Route, routeParam = '') {
    set({ route, routeParam });
  },

  setCoreVersion(v: string | null) {
    set({ coreVersion: v, apiMode: v ? 'server' : 'embedded' });
  },

  enterServer(user: User) {
    set({ apiMode: 'server', users: [user], session: { userId: user.id, at: Date.now() }, route: 'dashboard', routeParam: '' });
  },

  login(loginStr: string, pass: string): string | null {
    if (getState().apiMode === 'server') return 'Используйте серверный вход';
    const u = state.users.find((x) => x.login === loginStr.trim());
    if (!u) return 'Пользователь не найден';
    if (u.builtIn && pass !== 'pluto') return 'Неверный пароль';
    set({ session: { userId: u.id, at: Date.now() } });
    get().pushEvent('info', 'system', `Вход в систему: ${u.name}`);
    return null;
  },

  logout() {
    set({ session: null });
  },

  pushEvent(sev: Severity, source: EventItem['source'], text: string) {
    set({ events: [mkEvent(sev, source, text), ...state.events].slice(0, 300) });
  },

  applyServerState(st: {
    devices: Device[]; agents: Agent[]; tags: Tag[]; events: EventItem[];
    settings: Settings; users?: User[]; coreVersion?: string | null;
  }) {
    const patch: Partial<PlutoState> = {
      devices: (st.devices || []).map((d) => ({ ...d, history: Array.isArray(d.history) ? d.history : [], checking: false })),
      agents: (st.agents || []).map((a) => ({
        ...a,
        pingTargets: Array.isArray(a.pingTargets) ? a.pingTargets : [],
        targets: Array.isArray(a.targets) ? a.targets : [],
        latHist: Array.isArray(a.latHist) ? a.latHist : [],
        glances: Array.isArray(a.glances) ? a.glances : [],
        glancesLatest: a.glancesLatest ?? null,
        glancesError: a.glancesError ?? null,
        latency: a.latency ?? null,
        relayUrl: a.relayUrl ?? '',
        glancesUrl: a.glancesUrl ?? '',
        lastGlances: a.lastGlances ?? 0,
      })),
      tags: st.tags || [],
      events: st.events || [],
    };
    if (JSON.stringify(st.settings) !== JSON.stringify(state.settings)) patch.settings = st.settings;
    if (st.users) patch.users = st.users;
    set(patch);
  },

  // ── устройства ──
  async addDevice(d: Partial<Device> & { name: string; type: Device['type']; address: string }): Promise<void> {
    if (getState().apiMode === 'server') {
      const { api } = await import('./api');
      await api.addDevice(d as never);
      await syncAll();
      toast('ok', `Устройство «${d.name}» добавлено`);
      return;
    }
    const dev: Device = {
      id: uid('d'), name: d.name, type: d.type, address: d.address,
      port: d.port ?? null, path: d.path ?? '', method: d.method ?? null, body: d.body ?? null,
      interval: d.interval ?? state.settings.intervals[d.type] ?? 60,
      tags: d.tags ?? [], favorite: false, showcase: !!d.showcase,
      status: 'unknown', latency: null, history: [], fails: 0,
      lastCheck: 0, lastChange: Date.now(), checking: false, approx: false, createdAt: Date.now(),
    };
    set({ devices: [...state.devices, dev] });
    get().pushEvent('info', 'device', `Добавлено устройство «${dev.name}» (${dev.type.toUpperCase()} ${dev.address})`);
  },

  async updateDevice(id: string, patch: Partial<Device>): Promise<void> {
    if (getState().apiMode === 'server') {
      const { api } = await import('./api');
      await api.updateDevice(id, patch as never);
      await syncAll();
      return;
    }
    set({ devices: state.devices.map((d) => (d.id === id ? { ...d, ...patch } : d)) });
  },

  patchDevice(id: string, patch: Partial<Device>) {
    if (getState().apiMode === 'server') return;
    set({ devices: state.devices.map((d) => (d.id === id ? { ...d, ...patch } : d)) });
  },

  async removeDevice(id: string): Promise<void> {
    const dev = state.devices.find((d) => d.id === id);
    if (getState().apiMode === 'server') {
      const { api } = await import('./api');
      await api.deleteDevice(id);
      await syncAll();
    } else {
      set({ devices: state.devices.filter((d) => d.id !== id) });
    }
    if (dev) get().pushEvent('info', 'device', `Устройство «${dev.name}» удалено`);
  },

  toggleDeviceFav(id: string) {
    const d = state.devices.find((x) => x.id === id);
    if (!d) return;
    void store.updateDevice(id, { favorite: !d.favorite });
  },

  toggleDeviceShowcase(id: string) {
    const d = state.devices.find((x) => x.id === id);
    if (!d) return;
    void store.updateDevice(id, { showcase: !d.showcase });
    get().pushEvent('info', 'device', `«${d.name}» ${d.showcase ? 'убрано с витрины' : 'добавлено на витрину'}`);
  },

  // ── агенты (relay + Glances) ──
  async addAgent(d: { name: string; ip: string; relayUrl: string; glancesUrl?: string; pingTargets?: string[] }): Promise<void> {
    if (getState().apiMode === 'server') {
      const { api } = await import('./api');
      await api.addAgent(d as never);
      await syncAll();
      toast('ok', `Агент «${d.name}» добавлен`);
      return;
    }
    const a: Agent = {
      id: uid('ag'), name: d.name, ip: d.ip, relayUrl: d.relayUrl, glancesUrl: d.glancesUrl ?? '',
      pingTargets: d.pingTargets ?? [], targets: [], favorite: false,
      online: false, latency: null, onlineSince: 0, lastSeen: 0, lastPoll: 0, lastGlances: 0,
      latHist: [], glances: [], glancesLatest: null, glancesError: null, createdAt: Date.now(),
    };
    set({ agents: [...state.agents, a] });
    get().pushEvent('info', 'agent', `Добавлен агент «${a.name}» (${a.ip})`);
  },

  async updateAgent(id: string, patch: Partial<Agent>): Promise<void> {
    if (getState().apiMode === 'server') {
      const { api } = await import('./api');
      await api.updateAgent(id, patch as never);
      await syncAll();
      return;
    }
    set({ agents: state.agents.map((a) => (a.id === id ? { ...a, ...patch } : a)) });
  },

  patchAgent(id: string, patch: Partial<Agent>) {
    if (getState().apiMode === 'server') return;
    set({ agents: state.agents.map((a) => (a.id === id ? { ...a, ...patch } : a)) });
  },

  async removeAgent(id: string): Promise<void> {
    const a = state.agents.find((x) => x.id === id);
    if (getState().apiMode === 'server') {
      const { api } = await import('./api');
      await api.deleteAgent(id);
      await syncAll();
    } else {
      set({ agents: state.agents.filter((x) => x.id !== id) });
    }
    if (a) get().pushEvent('info', 'agent', `Агент «${a.name}» удалён`);
  },

  toggleAgentFav(id: string) {
    const a = state.agents.find((x) => x.id === id);
    if (!a) return;
    void store.updateAgent(id, { favorite: !a.favorite });
  },

  async pollAgentNow(id: string): Promise<void> {
    if (getState().apiMode === 'server') {
      const { api } = await import('./api');
      try {
        await api.pollAgent(id);
        await syncAll();
        toast('ok', 'Опрос агента выполнен');
      } catch (e) {
        toast('warn', e instanceof Error ? e.message : 'Опрос не удался');
      }
      return;
    }
    const { pollAgentEmbedded } = await import('./engine');
    pollAgentEmbedded(id);
  },

  // ── теги ──
  addTag(label: string, color: string): string | null {
    const l = label.trim();
    if (!l) return 'Укажите название тега';
    if (state.tags.some((t) => t.label.toLowerCase() === l.toLowerCase())) return 'Такой тег уже есть';
    set({ tags: [...state.tags, { id: uid('tag'), label: l, color }] });
    return null;
  },

  removeTag(id: string) {
    const t = state.tags.find((x) => x.id === id);
    set({
      tags: state.tags.filter((x) => x.id !== id),
      devices: state.devices.map((d) => ({ ...d, tags: d.tags.filter((x) => x !== id) })),
    });
    if (t) get().pushEvent('info', 'system', `Тег «${t.label}» удалён`);
  },

  // ── пользователи ──
  addUser(u: { login: string; name: string; role: User['role']; scope: string[] }): string | null {
    if (state.users.some((x) => x.login === u.login.trim())) return 'Логин уже занят';
    set({
      users: [...state.users, {
        id: uid('u'), login: u.login.trim(), name: u.name.trim() || u.login.trim(),
        role: u.role, scope: u.scope as User['scope'], builtIn: false, createdAt: Date.now(),
      }],
    });
    return null;
  },

  removeUser(id: string): string | null {
    const u = state.users.find((x) => x.id === id);
    if (!u) return 'Пользователь не найден';
    if (u.builtIn) return 'Нельзя удалить встроенного администратора';
    set({ users: state.users.filter((x) => x.id !== id) });
    return null;
  },

  // ── настройки ──
  saveSettings(settings: Settings) {
    if (getState().apiMode === 'server') {
      import('./api').then(({ api }) => api.saveSettings(settings).then(() => syncAll()).catch((e) => toast('warn', e?.message || 'Не удалось сохранить')));
      return;
    }
    set({ settings });
    get().pushEvent('info', 'system', 'Системные настройки сохранены');
    toast('ok', 'Настройки сохранены');
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

export function rehydrate() {
  if (INJECTED_CORE) return; // серверный режим — данные из ядра
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const p = JSON.parse(raw);
    state = {
      ...state,
      ...p,
      settings: { ...defaultSettings(), ...(p.settings || {}), showcase: { port: 8081, ...((p.settings || {}).showcase || {}) } },
      devices: (p.devices || []).map((d: Device) => ({ ...d, checking: false })),
      agents: (p.agents || []).map((a: Agent) => ({ ...a, latHist: [] })),
      session: p.session || null,
      route: 'dashboard',
      routeParam: '',
      apiMode: 'embedded',
    };
    emit();
  } catch { /* повреждённое состояние — стартуем чистыми */ }
}

export function persist() {
  if (getState().apiMode === 'server') return;
  try {
    const { devices, agents, tags, events, settings, users, session } = state;
    localStorage.setItem(LS_KEY, JSON.stringify({ devices, agents, tags, events, settings, users, session }));
  } catch { /* quota */ }
}

// автосохранение встроенного режима
if (typeof window !== 'undefined') {
  subscribe(() => {
    window.clearTimeout((persist as never as { _t?: number })._t);
    (persist as never as { _t?: number })._t = window.setTimeout(persist, 400);
  });
}

// ─── Восстановление серверной сессии ────────────────────────────────────────
export async function restoreServerSession(): Promise<boolean> {
  const { getApiToken, apiMe } = await import('./api');
  if (!getApiToken()) return false;
  try {
    const me = await apiMe();
    store.enterServer(me);
    return true;
  } catch {
    return false;
  }
}
