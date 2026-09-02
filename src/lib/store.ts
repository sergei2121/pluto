// ─── PLUTO: хранилище состояния (pub/sub + useSyncExternalStore) ─────────────
import { useRef, useSyncExternalStore } from 'react';
import type {
  Agent, Device, EventItem, Route, Settings, Severity, StatsView, Tag, User,
} from './types';
import { uid, TAG_COLORS } from './util';

export interface Toast { id: string; kind: Severity; text: string; }

let toastId = 0;
export const useToasts = {
  list: [] as Toast[],
  push(kind: Severity, text: string) {
    const t: Toast = { id: `t${++toastId}`, kind, text };
    this.list = [...this.list, t];
    setTimeout(() => { this.list = this.list.filter((x) => x.id !== t.id); emitToast(); }, 4500);
    emitToast();
  },
};
// ВАЖНО: набор подписчиков, а не один listener — useSyncExternalStore
// подписывает каждый компонент, и одиночный слот перезаписывался последним
// подписчиком (из-за этого меню не переключалось).
const toastListeners = new Set<() => void>();
function emitToast() { toastListeners.forEach((cb) => cb()); }

export function useToastList(): Toast[] {
  return useSyncExternalStore(
    (cb) => { toastListeners.add(cb); return () => { toastListeners.delete(cb); }; },
    () => useToasts.list,
  );
}

function defaultSettings(): Settings {
  return {
    intervals: { ping: 60, http: 60, api: 180, rtsp: 120, sip: 120, agent: 30, glances: 20 },
    timeoutMs: 3000, failThreshold: 3, degradeFactor: 10, degradeMinMs: 250,
    mirror: { enabled: false, url: '', secret: '', interval: 60 },
    notifications: {
      telegram: { enabled: false, botToken: '', chatId: '' },
      email: { enabled: false, smtp: '', from: '', to: '' },
      push: { enabled: false },
      on: { down: true, degraded: true, recover: true, agentOff: true, agentOn: false },
    },
    showcase: { port: 8081 },
  };
}

function seedAdmin(): User {
  return { id: 'admin', login: 'admin', name: 'admin', role: 'admin', scope: [], builtIn: true, createdAt: Date.now() };
}

function mkEvent(sev: Severity, source: EventItem['source'], text: string): EventItem {
  return { id: uid('ev'), ts: Date.now(), sev, source, text };
}

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
  apiMode: 'embedded' | 'server';
  coreVersion: string | null;
}

let state: PlutoState = {
  users: [seedAdmin()],
  session: null,
  devices: [], agents: [], tags: [],
  events: [mkEvent('info', 'system', 'PLUTO инициализирован — база чистая')],
  settings: defaultSettings(),
  route: 'dashboard', routeParam: '',
  apiMode: 'embedded', coreVersion: null,
};

// Набор подписчиков: каждый компонент с usePluto получает свою подписку.
// Одиночный listener перезаписывался последним подписчиком — обновления
// не доходили до остальных компонентов (меню не переключалось).
const listeners = new Set<() => void>();
function emit() { listeners.forEach((cb) => cb()); }
function set(patch: Partial<PlutoState>) { state = { ...state, ...patch }; emit(); }
export function getState(): PlutoState { return state; }
function subscribe(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb); }; }

export function usePluto<T>(selector: (s: PlutoState) => T): T {
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
  return usePluto((s) => {
    const u = s.users.find((x) => x.id === s.session?.userId) || null;
    return u;
  });
}

function toast(kind: Severity, text: string) { useToasts.push(kind, text); }
async function syncAll() { const { syncAll: s } = await import('./api'); return s(); }

function safeAgent(a: Agent): Agent {
  return {
    ...a,
    pingTargets: Array.isArray(a.pingTargets) ? a.pingTargets : [],
    targets: Array.isArray(a.targets) ? a.targets : [],
    tags: Array.isArray(a.tags) ? a.tags : [],
    latHist: Array.isArray(a.latHist) ? a.latHist : [],
    glances: Array.isArray(a.glances) ? a.glances : [],
    glancesLatest: a.glancesLatest ?? null,
    glancesError: a.glancesError ?? null,
    latency: a.latency ?? null,
    relayUrl: a.relayUrl ?? '', glancesUrl: a.glancesUrl ?? '',
    lastGlances: a.lastGlances ?? 0,
    favorite: !!a.favorite, pingsFavorite: !!a.pingsFavorite, pingsShowcase: !!a.pingsShowcase,
    statsView: a.statsView ?? '',
  };
}

export const store = {
  nav(route: Route, routeParam = '') { set({ route, routeParam }); },
  setCoreVersion(v: string | null) { set({ coreVersion: v, apiMode: v ? 'server' : 'embedded' }); },

  enterServer(user: User) {
    set({ apiMode: 'server', users: [user], session: { userId: user.id, at: Date.now() } });
  },

  login(loginStr: string, pass: string): string | null {
    const u = state.users.find((x) => x.login.toLowerCase() === loginStr.trim().toLowerCase());
    if (!u) return 'Пользователь не найден';
    if (u.login === 'admin' && pass !== 'pluto') return 'Неверный пароль';
    set({ session: { userId: u.id, at: Date.now() }, route: 'dashboard' });
    return null;
  },

  logout() { set({ session: null }); },

  pushEvent(sev: Severity, source: EventItem['source'], text: string) {
    set({ events: [mkEvent(sev, source, text), ...state.events].slice(0, 300) });
  },

  applyServerState(st: { devices: Device[]; agents: Agent[]; tags: Tag[]; events: EventItem[]; settings: Settings; users?: User[] }) {
    const patch: Partial<PlutoState> = {
      devices: (st.devices || []).map((d) => ({ ...d, checking: false, tags: Array.isArray(d.tags) ? d.tags : [], history: Array.isArray(d.history) ? d.history : [] })),
      agents: (st.agents || []).map(safeAgent),
      tags: Array.isArray(st.tags) ? st.tags : [],
      events: st.events || [],
    };
    if (JSON.stringify(st.settings) !== JSON.stringify(state.settings)) patch.settings = st.settings;
    if (st.users) patch.users = st.users;
    set(patch);
  },

  // ── устройства ──
  async addDevice(d: Omit<Device, 'id' | 'status' | 'latency' | 'baseline' | 'history' | 'fails' | 'lastCheck' | 'lastChange' | 'checking' | 'approx' | 'createdAt'>): Promise<void> {
    if (getState().apiMode === 'server') {
      const { api } = await import('./api');
      await api.addDevice(d);
      await syncAll();
      return;
    }
    const dev: Device = { ...d, id: uid('dv'), status: 'unknown', latency: null, baseline: null, history: [], fails: 0, lastCheck: 0, lastChange: Date.now(), checking: false, approx: false, createdAt: Date.now() };
    set({ devices: [...state.devices, dev] });
    get().pushEvent('info', 'device', `Добавлено устройство «${dev.name}» (${dev.address})`);
  },

  async updateDevice(id: string, patch: Partial<Device>): Promise<void> {
    if (getState().apiMode === 'server') {
      const { api } = await import('./api');
      await api.updateDevice(id, patch);
      await syncAll();
      return;
    }
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

  async clearDevices(): Promise<number> {
    if (getState().apiMode === 'server') {
      const { api } = await import('./api');
      const r = await api.clearDevices();
      await syncAll();
      get().pushEvent('warn', 'system', `Очищен список устройств: удалено ${r.removed} шт.`);
      toast('ok', `Удалено устройств: ${r.removed}`);
      return r.removed;
    }
    const removed = state.devices.length;
    set({ devices: [] });
    get().pushEvent('warn', 'system', `Очищен список устройств: удалено ${removed} шт.`);
    return removed;
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
  },

  // ── агенты ──
  async addAgent(d: Omit<Agent, 'id' | 'targets' | 'tags' | 'favorite' | 'statsView' | 'pingsFavorite' | 'pingsShowcase' | 'online' | 'latency' | 'onlineSince' | 'lastSeen' | 'lastPoll' | 'lastGlances' | 'latHist' | 'glances' | 'glancesLatest' | 'glancesError' | 'createdAt'>): Promise<void> {
    if (getState().apiMode === 'server') {
      const { api } = await import('./api');
      await api.addAgent(d as never);
      await syncAll();
      toast('ok', `Агент «${d.name}» добавлен`);
      return;
    }
    const a: Agent = {
      ...d, id: uid('ag'), targets: [], tags: [], favorite: false, statsView: '', pingsFavorite: false, pingsShowcase: false,
      online: false, latency: null, onlineSince: 0, lastSeen: 0, lastPoll: 0, lastGlances: 0,
      latHist: [], glances: [], glancesLatest: null, glancesError: null, createdAt: Date.now(),
    };
    set({ agents: [...state.agents, a] });
    get().pushEvent('info', 'agent', `Добавлен агент «${a.name}» (${a.ip})`);
  },

  async updateAgent(id: string, patch: Partial<Agent>): Promise<void> {
    if (getState().apiMode === 'server') {
      const { api } = await import('./api');
      await api.updateAgent(id, patch);
      await syncAll();
      return;
    }
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

  async pollAgentNow(id: string): Promise<void> {
    if (getState().apiMode === 'server') {
      const { api } = await import('./api');
      await api.pollAgent(id);
      await syncAll();
    }
  },

  toggleAgentFav(id: string) {
    const a = state.agents.find((x) => x.id === id);
    if (!a) return;
    void store.updateAgent(id, { favorite: !a.favorite });
  },

  toggleAgentPingsFav(id: string) {
    const a = state.agents.find((x) => x.id === id);
    if (!a) return;
    void store.updateAgent(id, { pingsFavorite: !a.pingsFavorite });
  },

  toggleAgentPingsShowcase(id: string) {
    const a = state.agents.find((x) => x.id === id);
    if (!a) return;
    void store.updateAgent(id, { pingsShowcase: !a.pingsShowcase });
  },

  setAgentStatsView(id: string, view: StatsView) {
    const a = state.agents.find((x) => x.id === id);
    if (!a) return;
    void store.updateAgent(id, { statsView: view });
    const label = view === 'bars' ? 'в «Статистика Bars»' : view === 'ws' ? 'в «Статистика WS»' : 'убран из статистики';
    get().pushEvent('info', 'agent', `«${a.name}» ${label}`);
  },

  // ── теги ──
  async addTag(label: string, color?: string): Promise<string | null> {
    const l = label.trim();
    if (!l) return 'Укажите название тега';
    if (state.tags.some((t) => t.label.toLowerCase() === l.toLowerCase())) return 'Такой тег уже есть';
    const c = color || TAG_COLORS[state.tags.length % TAG_COLORS.length];
    if (getState().apiMode === 'server') {
      const { api } = await import('./api');
      await api.addTag(l, c);
      await syncAll();
      return null;
    }
    set({ tags: [...state.tags, { id: uid('tg'), label: l, color: c }] });
    get().pushEvent('info', 'system', `Создан тег «${l}»`);
    return null;
  },

  async removeTag(id: string): Promise<void> {
    if (getState().apiMode === 'server') {
      const { api } = await import('./api');
      await api.deleteTag(id);
      await syncAll();
    } else {
      set({ tags: state.tags.filter((t) => t.id !== id) });
    }
  },

  // ── настройки ──
  async saveSettings(settings: Settings): Promise<void> {
    if (getState().apiMode === 'server') {
      const { api } = await import('./api');
      await api.saveSettings(settings);
      await syncAll();
      toast('ok', 'Настройки сохранены');
      return;
    }
    set({ settings });
    toast('ok', 'Настройки сохранены');
  },
};

function get() { return store; }

// ─── Селекторы видимости по ролям ────────────────────────────────────────────

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
