// ─── PLUTO: хранилище (useSyncExternalStore, без внешних зависимостей) ──────
import { useSyncExternalStore } from 'react';
import type { Agent, Device, EventItem, Role, Route, Settings, Severity, Tag, User } from './types';
import { DEVICE_TYPE_META } from './types';
import { clamp, genToken, hashStr, mulberry32, rnd, rndInt, uid } from './util';
import { api, apiLogin, getApiToken, setApiToken, syncAll, type ServerState } from './api';

export const FAVORITES_LIMIT = 15;
const LS_KEY = 'pluto.state.v1';

// ─── Тосты (отдельный маленький стор) ───────────────────────────────────────

export interface Toast {
  id: string;
  kind: 'ok' | 'warn' | 'crit' | 'info';
  text: string;
}

let toastState: { list: Toast[] } = { list: [] };
const toastListeners = new Set<() => void>();

export const useToasts = {
  getState: () => toastState,
  subscribe(l: () => void) {
    toastListeners.add(l);
    return () => toastListeners.delete(l);
  },
  push(kind: Toast['kind'], text: string) {
    const t: Toast = { id: uid('toast'), kind, text };
    toastState = { list: [...toastState.list, t].slice(-4) };
    toastListeners.forEach((l) => l());
    window.setTimeout(() => {
      toastState = { list: toastState.list.filter((x) => x.id !== t.id) };
      toastListeners.forEach((l) => l());
    }, 4200);
  },
  drop(id: string) {
    toastState = { list: toastState.list.filter((x) => x.id !== id) };
    toastListeners.forEach((l) => l());
  },
};

export function useToastList(): Toast[] {
  return useSyncExternalStore(
    (cb) => {
      toastListeners.add(cb);
      return () => toastListeners.delete(cb);
    },
    () => toastState.list,
  );
}

// ─── Значения по умолчанию ──────────────────────────────────────────────────

export function defaultSettings(): Settings {
  return {
    intervals: { ping: 30, http: 60, api: 120, rtsp: 60, sip: 120 },
    heartbeat: 10,
    metrics: 3,
    lanScan: 300,
    failThreshold: 3,
    degradeFactor: 10,
    degradeMinMs: 250,
    timeoutMs: 3000,
    simulate: true,
    notifications: {
      telegram: { enabled: false, botToken: '', chatId: '' },
      email: { enabled: false, smtp: '', port: 587, from: '', to: '' },
      push: { enabled: false },
      on: { down: true, degraded: true, recover: true, agentOff: true, agentOn: false },
    },
  };
}

export function seedAdmin(): User {
  return {
    id: 'u-admin',
    login: 'admin',
    name: 'Администратор',
    role: 'admin',
    scope: [],
    builtIn: true,
    createdAt: Date.now(),
  };
}

export interface Session {
  userId: string;
  at: number;
}

export type ApiMode = 'embedded' | 'server';

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

  nav: (r: Route, param?: string) => void;
  login: (l: string, p: string) => string | null;
  logout: () => void;
  enterServer: (u: User) => void;
  loginServer: (l: string, p: string) => Promise<string | null>;
  serverLogout: () => void;
  applyServerState: (st: ServerState) => void;
  pushEvent: (sev: Severity, source: EventItem['source'], text: string) => void;

  addDevice: (d: Partial<Device> & { name: string; type: Device['type']; address: string; interval: number; tags: string[] }) => void;
  updateDevice: (id: string, patch: Partial<Device>) => void;
  patchDevice: (id: string, patch: Partial<Device>) => void;
  removeDevice: (id: string) => void;
  toggleDeviceFav: (id: string) => void;

  addEmulatedAgent: () => Agent | null;
  patchAgent: (id: string, patch: Partial<Agent>) => void;
  removeAgent: (id: string) => void;
  toggleAgentFav: (id: string) => void;

  addTag: (label: string, color: string) => string | null;
  removeTag: (id: string) => void;

  saveSettings: (s: Settings) => void;
  setSettingsRaw: (s: Settings) => void;

  addUser: (u: { login: string; name: string; role: Role; scope: string[]; pass: string }) => string | null;
  updateUser: (id: string, patch: Partial<User> & { pass?: string }) => string | null;
  removeUser: (id: string) => string | null;

  resetBase: () => void;
}

function mkEvent(sev: Severity, source: EventItem['source'], text: string): EventItem {
  return { id: uid('e'), ts: Date.now(), sev, source, text };
}

function profileFor(type: Device['type'], seed: () => number) {
  const baseByType: Record<Device['type'], number> = { ping: 24, http: 60, api: 90, rtsp: 45, sip: 70 };
  return { base: Math.round(baseByType[type] * (0.6 + seed() * 0.9)), failP: 0.02, spikeP: 0.015 };
}

// ─── Инфраструктура стора ───────────────────────────────────────────────────

const listeners = new Set<() => void>();
let state: PlutoState;

function set(partial: Partial<PlutoState> | ((s: PlutoState) => Partial<PlutoState>)) {
  const p = typeof partial === 'function' ? partial(state) : partial;
  state = { ...state, ...p };
  persist();
  listeners.forEach((l) => l());
}

function get(): PlutoState {
  return state;
}

let persistTimer: number | null = null;
function persist() {
  if (persistTimer) return;
  persistTimer = window.setTimeout(() => {
    persistTimer = null;
    try {
      const { users, session, devices, agents, tags, events, settings } = state;
      localStorage.setItem(LS_KEY, JSON.stringify({ users, session, devices, agents, tags, events, settings }));
    } catch {
      /* переполнение — игнорируем */
    }
  }, 300);
}

// ─── Начальное состояние + все действия ─────────────────────────────────────

/** Подпись ядра, вшитая в index.html при отдаче страницы сервером PLUTO Core. */
const INJECTED_CORE: string | null =
  typeof window !== 'undefined'
    ? (((window as unknown as { __PLUTO_CORE__?: { v?: string } }).__PLUTO_CORE__?.v as string) ?? null)
    : null;

function initialState(): PlutoState {
  const srv = () => get().apiMode === 'server';
  const sync = () => void syncAll();
  const toast = (k: Toast['kind'], t: string) => useToasts.push(k, t);

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

    nav: (r, param = '') => set({ route: r, routeParam: param }),

    login: (l, p) => {
      const st = get();
      const u = st.users.find((x) => x.login === l.trim());
      if (!u) return 'Пользователь не найден';
      const stored = (u as User & { pass?: string }).pass;
      if (u.builtIn) {
        if (p !== 'pluto' && stored !== p) return 'Неверный пароль';
      } else if (stored !== p) {
        return 'Неверный пароль';
      }
      set({ session: { userId: u.id, at: Date.now() }, route: 'dashboard', routeParam: '' });
      get().pushEvent('info', 'system', `Вход в систему: ${u.login}`);
      return null;
    },

    logout: () => {
      const st = get();
      const u = st.users.find((x) => x.id === st.session?.userId);
      if (st.apiMode === 'server') {
        setApiToken(null);
        set({ session: null, apiMode: 'embedded', users: [seedAdmin()] });
      } else {
        set({ session: null });
      }
      if (u) get().pushEvent('info', 'system', `Выход из системы: ${u.login}`);
    },

    enterServer: (user) => {
      set({
        apiMode: 'server',
        users: [user],
        session: { userId: user.id, at: Date.now() },
        route: 'dashboard',
        routeParam: '',
        events: [mkEvent('info', 'system', 'Консоль подключена к серверному ядру — проверки и телеметрия реальные')],
      });
    },

    loginServer: async (l, p) => {
      try {
        const user = await apiLogin(l.trim(), p);
        get().enterServer(user);
        sync();
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : 'Не удалось связаться с ядром';
      }
    },

    serverLogout: () => {
      setApiToken(null);
      // Если страницу отдало настоящее ядро (подпись в index.html), остаёмся
      // в серверном режиме: вход выполнится через API, а не через эмуляцию.
      if (INJECTED_CORE) {
        set({ session: null, apiMode: 'server', coreVersion: INJECTED_CORE });
      } else {
        set({ apiMode: 'embedded', session: null, users: [seedAdmin()] });
      }
    },

    applyServerState: (st) => {
      const patch: Partial<PlutoState> = {
        devices: st.devices,
        agents: st.agents,
        tags: st.tags,
        events: st.events,
        settings: st.settings,
      };
      if (st.users) patch.users = st.users;
      set(patch);
    },

    pushEvent: (sev, source, text) => {
      const st = get();
      set({ events: [mkEvent(sev, source, text), ...st.events].slice(0, 200) });
    },

    addDevice: (d) => {
      if (srv()) {
        api.addDevice({
          name: d.name.trim() || d.address,
          type: d.type,
          address: d.address.trim(),
          port: d.port ?? null,
          path: d.path || '',
          method: d.method ?? null,
          body: d.body ?? null,
          interval: clamp(Math.round(d.interval), 5, 86400),
          tags: d.tags,
        }).then(sync).catch((e) => toast('warn', (e as Error)?.message || 'Не удалось добавить устройство'));
        return;
      }
      const st = get();
      const seed = mulberry32(hashStr(d.type + ':' + d.address));
      const dev: Device = {
        id: uid('d'),
        name: d.name.trim() || d.address,
        type: d.type,
        address: d.address.trim(),
        port: d.port ?? null,
        path: d.path || '',
        method: d.method ?? null,
        body: d.body ?? null,
        interval: clamp(Math.round(d.interval), 5, 86400),
        tags: d.tags,
        favorite: false,
        status: 'unknown',
        latency: null,
        baseline: null,
        history: [],
        fails: 0,
        lastCheck: 0,
        lastChange: Date.now(),
        checking: false,
        approx: true,
        createdAt: Date.now(),
        profile: profileFor(d.type, seed),
        spikeUntil: 0,
      };
      set({ devices: [...st.devices, dev] });
      st.pushEvent('info', 'device', `Добавлено устройство «${dev.name}» (${DEVICE_TYPE_META[dev.type].label} ${dev.address})`);
    },

    updateDevice: (id, patch) => {
      if (srv()) {
        const body: Record<string, unknown> = {};
        for (const k of ['name', 'type', 'address', 'port', 'path', 'method', 'body', 'interval', 'tags', 'favorite'] as const) {
          if (k in patch) body[k] = (patch as any)[k];
        }
        api.updateDevice(id, body).then(sync).catch((e) => toast('warn', (e as Error)?.message || 'Не удалось обновить'));
        return;
      }
      const st = get();
      const dev = st.devices.find((x) => x.id === id);
      set({ devices: st.devices.map((x) => (x.id === id ? { ...x, ...patch } : x)) });
      if (dev && (patch.name || patch.interval || patch.tags)) {
        st.pushEvent('info', 'device', `Настройки устройства «${patch.name ?? dev.name}» обновлены`);
      }
    },

    patchDevice: (id, patch) => {
      if (srv()) return;
      set((st) => ({ devices: st.devices.map((d) => (d.id === id ? { ...d, ...patch } : d)) }));
    },

    removeDevice: (id) => {
      if (srv()) {
        api.deleteDevice(id).then(sync).catch((e) => toast('warn', (e as Error)?.message || 'Не удалось удалить'));
        return;
      }
      const st = get();
      const dev = st.devices.find((x) => x.id === id);
      set({ devices: st.devices.filter((x) => x.id !== id) });
      if (dev) st.pushEvent('info', 'device', `Устройство «${dev.name}» удалено из мониторинга`);
    },

    toggleDeviceFav: (id) => {
      const st = get();
      const d = st.devices.find((x) => x.id === id);
      if (!d) return;
      const count = st.devices.filter((x) => x.favorite).length + st.agents.filter((x) => x.favorite).length;
      if (!d.favorite && count >= FAVORITES_LIMIT) {
        toast('warn', `В избранном не больше ${FAVORITES_LIMIT} элементов`);
        return;
      }
      if (srv()) {
        api.updateDevice(id, { favorite: !d.favorite }).then(sync).catch(() => {});
        return;
      }
      set({ devices: st.devices.map((x) => (x.id === id ? { ...x, favorite: !x.favorite } : x)) });
    },

    addEmulatedAgent: () => {
      const st = get();
      if (srv()) {
        api.createAgentToken('agent-' + uid('t').slice(-4))
          .then((r) => { toast('ok', `Токен создан: ${r.token}`); sync(); })
          .catch((e) => toast('warn', (e as Error)?.message || 'Не удалось создать токен'));
        return null;
      }
      const n = st.agents.length + 1;
      const rng = mulberry32(hashStr('agent' + n + Date.now()));
      const disks = Array.from({ length: rndInt(1, 3) }, (_, i) => {
        const total = (i === 0 ? rndInt(240, 520) : rndInt(900, 2000)) * 1024 ** 3;
        return { id: uid('disk'), label: String.fromCharCode(67 + i) + ':', total, used: total * rnd(0.2, 0.75), temp: rnd(30, 44) };
      });
      const a: Agent = {
        id: uid('a'),
        name: 'WIN-AGENT-' + String(n).padStart(2, '0'),
        hostname: 'WIN-AGENT-' + String(n).padStart(2, '0'),
        token: genToken(),
        ip: `192.168.1.${rndInt(20, 240)}`,
        os: 'Windows 11 Pro',
        version: '1.6.0',
        online: true,
        emulated: true,
        cpuLoad: rnd(8, 45),
        cpuCores: [4, 6, 8, 12][Math.floor(rng() * 4)],
        cpuTemp: rnd(38, 55),
        ramUsed: rnd(4, 9) * 1024 ** 3,
        ramTotal: [8, 16, 32][Math.floor(rng() * 3)] * 1024 ** 3,
        ramTemp: rnd(34, 45),
        disks,
        rxBytes: 0,
        txBytes: 0,
        rxRate: rnd(100, 900),
        txRate: rnd(40, 300),
        networks: [],
        lastSeen: Date.now(),
        lastMetrics: Date.now(),
        lastScan: 0,
        history: [],
        favorite: false,
        createdAt: Date.now(),
      };
      set({ agents: [...st.agents, a] });
      st.pushEvent('ok', 'agent', `Агент ${a.hostname} (${a.ip}) подключился`);
      return a;
    },

    patchAgent: (id, patch) => {
      if (srv()) return;
      set((st) => ({ agents: st.agents.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));
    },

    removeAgent: (id) => {
      if (srv()) {
        api.deleteAgent(id).then(sync).catch((e) => toast('warn', (e as Error)?.message || 'Не удалось удалить агента'));
        return;
      }
      const st = get();
      const a = st.agents.find((x) => x.id === id);
      set({ agents: st.agents.filter((x) => x.id !== id) });
      if (a) st.pushEvent('info', 'agent', `Агент ${a.hostname} отключён и удалён из реестра`);
    },

    toggleAgentFav: (id) => {
      const st = get();
      const a = st.agents.find((x) => x.id === id);
      if (!a) return;
      const count = st.devices.filter((x) => x.favorite).length + st.agents.filter((x) => x.favorite).length;
      if (!a.favorite && count >= FAVORITES_LIMIT) {
        toast('warn', `В избранном не больше ${FAVORITES_LIMIT} элементов`);
        return;
      }
      if (srv()) {
        api.patchAgent(id, { favorite: !a.favorite }).then(sync).catch(() => {});
        return;
      }
      set({ agents: st.agents.map((x) => (x.id === id ? { ...x, favorite: !x.favorite } : x)) });
    },

    addTag: (label, color) => {
      const st = get();
      const l = label.trim();
      if (!l) return 'Укажите название тега';
      if (srv()) {
        api.addTag(l, color).then(sync).catch((e) => toast('warn', (e as Error)?.message || 'Не удалось создать тег'));
        return null;
      }
      if (st.tags.some((t) => t.label.toLowerCase() === l.toLowerCase())) return 'Такой тег уже есть';
      if (st.tags.length >= 30) return 'Не более 30 тегов';
      set({ tags: [...st.tags, { id: uid('t'), label: l, color }] });
      st.pushEvent('info', 'system', `Создан тег «${l}»`);
      return null;
    },

    removeTag: (id) => {
      if (srv()) {
        api.deleteTag(id).then(sync).catch((e) => toast('warn', (e as Error)?.message || 'Не удалось удалить тег'));
        return;
      }
      const st = get();
      const t = st.tags.find((x) => x.id === id);
      set({
        tags: st.tags.filter((x) => x.id !== id),
        devices: st.devices.map((d) => ({ ...d, tags: d.tags.filter((x) => x !== id) })),
      });
      if (t) st.pushEvent('info', 'system', `Тег «${t.label}» удалён`);
    },

    saveSettings: (settings) => {
      if (srv()) {
        api.saveSettings(settings).then(sync).catch((e) => toast('warn', (e as Error)?.message || 'Не удалось сохранить'));
        return;
      }
      set({ settings });
      get().pushEvent('info', 'system', 'Системные настройки сохранены');
      toast('ok', 'Настройки сохранены');
    },

    setSettingsRaw: (settings) => set({ settings }),

    addUser: (u) => {
      const st = get();
      if (!u.login.trim()) return 'Укажите логин';
      if (st.users.some((x) => x.login === u.login.trim())) return 'Логин занят';
      if (!u.pass || u.pass.length < 4) return 'Пароль минимум 4 символа';
      const nu: User & { pass?: string } = {
        id: uid('u'),
        login: u.login.trim(),
        name: u.name.trim() || u.login.trim(),
        role: u.role,
        scope: u.scope as User['scope'],
        builtIn: false,
        createdAt: Date.now(),
        pass: u.pass,
      };
      set({ users: [...st.users, nu] });
      st.pushEvent('info', 'system', `Создан пользователь ${nu.login} (${nu.role === 'admin' ? 'администратор' : 'наблюдатель'})`);
      return null;
    },

    updateUser: (id, patch) => {
      const st = get();
      set({ users: st.users.map((u) => (u.id === id ? { ...u, ...patch } : u)) });
      return null;
    },

    removeUser: (id) => {
      const st = get();
      const u = st.users.find((x) => x.id === id);
      if (!u) return 'Пользователь не найден';
      if (u.builtIn) return 'Нельзя удалить администратора по умолчанию';
      set({ users: st.users.filter((x) => x.id !== id) });
      st.pushEvent('info', 'system', `Пользователь ${u.login} удалён`);
      return null;
    },

    resetBase: () => {
      localStorage.removeItem(LS_KEY);
      set({
        devices: [],
        agents: [],
        tags: [],
        events: [mkEvent('info', 'system', 'База очищена — система готова к первому запуску')],
        settings: defaultSettings(),
      });
      toast('ok', 'База очищена');
    },
  };

  return s;
}

state = initialState();

// rehydrate из localStorage
try {
  const raw = localStorage.getItem(LS_KEY);
  if (raw) {
    const p = JSON.parse(raw);
    state = {
      ...state,
      ...p,
      settings: { ...state.settings, ...(p.settings ?? {}), notifications: { ...state.settings.notifications, ...(p.settings?.notifications ?? {}) } },
      devices: (p.devices ?? []).map((d: Device) => ({ ...d, checking: false })),
      agents: (p.agents ?? []).map((a: Agent) => ({ ...a, history: [] })),
      route: 'dashboard',
      routeParam: '',
      apiMode: INJECTED_CORE ? 'server' : 'embedded',
      coreVersion: INJECTED_CORE,
    };
  }
} catch {
  /* повреждённые данные — чистая база */
}

export const useStore = {
  getState: get,
  setState: set,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

/** Подписка с селектором */
export function usePluto<T>(selector: (s: PlutoState) => T): T {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => selector(state),
  );
}

export function useCurrentUser(): User | null {
  const session = usePluto((s) => s.session);
  const users = usePluto((s) => s.users);
  return users.find((u) => u.id === session?.userId) ?? null;
}

export function visibleDevices(devices: Device[], user: User | null): Device[] {
  if (!user || user.role === 'admin') return devices;
  return devices.filter((d) => user.scope.includes(d.type));
}

export function visibleAgents(agents: Agent[], user: User | null): Agent[] {
  if (!user) return [];
  if (user.role === 'admin' || (user.scope as string[]).includes('agent')) return agents;
  return [];
}
