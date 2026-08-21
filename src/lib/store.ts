// ─── PLUTO: хранилище (чистая база, persist в localStorage) ──────────────────
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  Agent, Device, DeviceType, EventItem, Route, Session, Settings, Severity, Tag, User,
} from './types';
import { SCOPE_ALL } from './types';
import { genToken, hashPass, mulberry32, hashStr, rnd, rndInt, uid, macFrom, clamp } from './util';

export const FAVORITES_LIMIT = 15;

const defaultSettings: Settings = {
  intervals: { ping: 30, http: 60, api: 120, rtsp: 60, sip: 120 },
  heartbeat: 10,
  metrics: 3,
  lanScan: 300,
  failThreshold: 3,
  degradeFactor: 5,
  degradeMinMs: 80,
  timeoutMs: 4000,
  simulate: true,
  notifications: {
    telegram: { enabled: false, botToken: '', chatId: '' },
    email: { enabled: false, smtp: '', port: 587, from: '', to: '' },
    push: { enabled: false },
    on: { down: true, degraded: true, recover: true, agentOff: true, agentOn: false },
  },
};

function seedAdmin(): User {
  return {
    id: 'u-root',
    login: 'admin',
    pass: hashPass('pluto'),
    name: 'Администратор',
    role: 'admin',
    scope: [...SCOPE_ALL],
    builtIn: true,
    createdAt: Date.now(),
  };
}

interface PlutoState {
  users: User[];
  session: Session | null;
  devices: Device[];
  agents: Agent[];
  tags: Tag[];
  events: EventItem[];
  settings: Settings;
  route: Route;
  routeParam: string;

  nav: (r: Route, param?: string) => void;
  login: (l: string, p: string) => string | null;
  logout: () => void;

  pushEvent: (sev: Severity, source: EventItem['source'], text: string) => void;

  saveUser: (u: Omit<User, 'id' | 'createdAt'> & { id?: string }) => string | null;
  removeUser: (id: string) => string | null;

  addDevice: (d: {
    name: string; type: DeviceType; address: string; port?: number; path?: string;
    method?: 'GET' | 'POST'; body?: string; interval: number; tags: string[];
  }) => void;
  updateDevice: (id: string, patch: Partial<Device>) => void;
  patchDevice: (id: string, patch: Partial<Device>) => void; // без событий (движок)
  removeDevice: (id: string) => void;
  toggleDeviceFav: (id: string) => void;

  addEmulatedAgent: () => Agent;
  patchAgent: (id: string, patch: Partial<Agent>) => void;
  removeAgent: (id: string) => void;
  toggleAgentFav: (id: string) => void;
  regenAgentToken: (id: string) => string;

  addTag: (label: string, color: string) => string | null;
  removeTag: (id: string) => void;

  saveSettings: (s: Settings) => void;
  setSettingsRaw: (s: Settings) => void;
  resetBase: () => void;
}

function mkEvent(sev: Severity, source: EventItem['source'], text: string): EventItem {
  return { id: uid('ev'), ts: Date.now(), sev, source, text };
}

export const useStore = create<PlutoState>()(
  persist(
    (set, get) => ({
      users: [seedAdmin()],
      session: null,
      devices: [],
      agents: [],
      tags: [],
      events: [mkEvent('info', 'system', 'Ядро PLUTO инициализировано. Создана чистая база — демонстрационных данных нет.')],
      settings: defaultSettings,
      route: 'dashboard',
      routeParam: '',

      nav: (r, param = '') => set({ route: r, routeParam: param }),

      login: (l, p) => {
        const u = get().users.find((x) => x.login.toLowerCase() === l.trim().toLowerCase());
        if (!u || u.pass !== hashPass(p)) return 'Неверный логин или пароль';
        set({
          session: { userId: u.id, at: Date.now() },
          route: 'dashboard',
          events: [mkEvent('info', 'auth', `Вход в систему: ${u.login}`), ...get().events].slice(0, 250),
        });
        return null;
      },

      logout: () => {
        const u = get().users.find((x) => x.id === get().session?.userId);
        set({
          session: null,
          events: [mkEvent('info', 'auth', `Выход из системы: ${u?.login ?? '—'}`), ...get().events].slice(0, 250),
        });
      },

      pushEvent: (sev, source, text) =>
        set((s) => ({ events: [mkEvent(sev, source, text), ...s.events].slice(0, 250) })),

      // ── Пользователи ──
      saveUser: (data) => {
        const s = get();
        const login = data.login.trim().toLowerCase();
        if (!login || login.length < 3) return 'Логин — минимум 3 символа';
        const dup = s.users.find((u) => u.login.toLowerCase() === login && u.id !== data.id);
        if (dup) return 'Такой логин уже существует';
        if (data.id) {
          set({
            users: s.users.map((u) =>
              u.id === data.id
                ? {
                    ...u, name: data.name, login,
                    pass: data.pass ? hashPass(data.pass) : u.pass,
                    role: u.builtIn ? 'admin' : data.role,
                    scope: data.role === 'admin' ? [...SCOPE_ALL] : data.scope,
                  }
                : u,
            ),
          });
          s.pushEvent('info', 'system', `Пользователь ${login} обновлён`);
        } else {
          if (!data.pass || data.pass.length < 4) return 'Пароль — минимум 4 символа';
          const u: User = {
            id: uid('u'), login, pass: hashPass(data.pass), name: data.name || login,
            role: data.role, scope: data.role === 'admin' ? [...SCOPE_ALL] : data.scope,
            createdAt: Date.now(),
          };
          set({ users: [...s.users, u] });
          s.pushEvent('info', 'system', `Создан пользователь ${login} (${data.role === 'admin' ? 'администратор' : 'наблюдатель'})`);
        }
        return null;
      },

      removeUser: (id) => {
        const s = get();
        const u = s.users.find((x) => x.id === id);
        if (!u) return 'Пользователь не найден';
        if (u.builtIn) return 'Встроенного администратора удалить нельзя';
        if (s.session?.userId === id) return 'Нельзя удалить самого себя';
        set({ users: s.users.filter((x) => x.id !== id) });
        s.pushEvent('info', 'system', `Пользователь ${u.login} удалён`);
        return null;
      },

      // ── Устройства ──
      addDevice: (d) => {
        const s = get();
        const seed = mulberry32(hashStr(d.type + ':' + d.address));
        const baseByType: Record<DeviceType, [number, number]> = {
          ping: [2, 38], http: [8, 90], api: [20, 150], rtsp: [15, 120], sip: [10, 80],
        };
        const [bMin, bMax] = baseByType[d.type];
        const base = Math.round(bMin + seed() * (bMax - bMin));
        const problem = seed() < 0.16;
        const device: Device = {
          id: uid('d'),
          name: d.name.trim() || d.address,
          type: d.type,
          address: d.address.trim(),
          port: d.port, path: d.path, method: d.method, body: d.body,
          interval: clamp(Math.round(d.interval), 5, 86400),
          tags: d.tags,
          favorite: false,
          status: 'unknown', latency: null, approx: true, checking: false,
          lastCheck: 0, lastChange: Date.now(), fails: 0,
          history: [], spikeUntil: 0,
          profile: {
            base,
            failP: problem ? 0.14 : 0.004 + seed() * 0.03,
            spikeP: 0.012 + seed() * 0.02,
          },
          createdAt: Date.now(),
        };
        set({ devices: [device, ...s.devices] });
        s.pushEvent('info', 'device', `Добавлено устройство «${device.name}» (${d.address}, ${d.type.toUpperCase()})`);
      },

      updateDevice: (id, patch) => {
        const s = get();
        const dev = s.devices.find((d) => d.id === id);
        set({ devices: s.devices.map((d) => (d.id === id ? { ...d, ...patch } : d)) });
        if (dev && (patch.name || patch.interval || patch.tags)) {
          s.pushEvent('info', 'device', `Настройки устройства «${patch.name ?? dev.name}» обновлены`);
        }
      },

      patchDevice: (id, patch) =>
        set((s) => ({ devices: s.devices.map((d) => (d.id === id ? { ...d, ...patch } : d)) })),

      removeDevice: (id) => {
        const s = get();
        const dev = s.devices.find((d) => d.id === id);
        set({ devices: s.devices.filter((d) => d.id !== id) });
        if (dev) s.pushEvent('info', 'device', `Устройство «${dev.name}» удалено из мониторинга`);
      },

      toggleDeviceFav: (id) => {
        const s = get();
        const dev = s.devices.find((d) => d.id === id);
        if (!dev) return;
        const favCount = s.devices.filter((d) => d.favorite).length + s.agents.filter((a) => a.favorite).length;
        if (!dev.favorite && favCount >= FAVORITES_LIMIT) {
          useToasts.getState().push('warn', `Лимит избранного — ${FAVORITES_LIMIT} элементов`);
          return;
        }
        set({ devices: s.devices.map((d) => (d.id === id ? { ...d, favorite: !d.favorite } : d)) });
      },

      // ── Агенты ──
      addEmulatedAgent: () => {
        const s = get();
        const n = s.agents.length + 1;
        const seed = mulberry32(hashStr('agent-' + Date.now()));
        const hostname = `WS-${Math.floor(seed() * 46656).toString(36).toUpperCase().padStart(3, '0')}`;
        const sub = rndInt(2, 250);
        const myIp = `192.168.${sub}.${rndInt(10, 240)}`;
        const rng2 = mulberry32(hashStr(hostname));
        const diskCount = rndInt(1, 3);
        const letters = ['C', 'D', 'E'];
        const labels = ['System', 'Data', 'Backup'];
        const disks = Array.from({ length: diskCount }, (_, i) => {
          const total = [256, 512, 1024, 2048][rndInt(0, 3)] * 1024 ** 3;
          return {
            letter: letters[i], label: labels[i],
            used: total * (0.2 + rng2() * 0.6), total, temp: rndInt(30, 42),
          };
        });
        const hostHints = ['Роутер', 'IP-камера', 'Принтер', 'NAS', 'Шлюз VoIP', undefined, undefined, 'ПК пользователя'];
        const hostCount = rndInt(5, 14);
        const hosts = Array.from({ length: hostCount }, (_, i) => {
          const ip = `192.168.${sub}.${i + 1}`;
          return {
            ip, mac: macFrom(ip),
            hint: hostHints[rndInt(0, hostHints.length - 1)],
            online: rng2() > 0.25,
          };
        }).filter((h) => h.ip !== myIp);
        const ramTotal = [8, 16, 32, 64][rndInt(0, 3)] * 1024 ** 3;
        const agent: Agent = {
          id: uid('a'),
          name: `Агент ${hostname}`,
          hostname,
          token: genToken(),
          ip: myIp,
          os: 'Windows 11 Pro 23H2',
          version: '1.4.2',
          online: true,
          emulated: true,
          lastSeen: Date.now(),
          connectedAt: Date.now(),
          reconnectAt: 0,
          cpuLoad: rnd(8, 40),
          cpuCores: [4, 8, 12, 16][rndInt(0, 3)],
          cpuTemp: rnd(40, 55),
          ramUsed: ramTotal * rnd(0.25, 0.6),
          ramTotal,
          ramTemp: rnd(35, 48),
          disks,
          netIface: 'Ethernet 0',
          rxBytes: 0, txBytes: 0, rxRate: 0, txRate: 0,
          networks: [{ cidr: `192.168.${sub}.0/24`, iface: 'Ethernet 0', hosts }],
          nextScan: Date.now() + s.settings.lanScan * 1000,
          lastMetrics: 0,
          history: [],
          favorite: false,
          createdAt: Date.now(),
        };
        set({ agents: [agent, ...s.agents] });
        s.pushEvent('ok', 'agent', `Агент ${hostname} подключился к ядру (${myIp}, эмуляция)`);
        return agent;
      },

      patchAgent: (id, patch) =>
        set((s) => ({ agents: s.agents.map((a) => (a.id === id ? { ...a, ...patch } : a)) })),

      removeAgent: (id) => {
        const s = get();
        const a = s.agents.find((x) => x.id === id);
        set({ agents: s.agents.filter((x) => x.id !== id) });
        if (a) s.pushEvent('info', 'agent', `Агент ${a.hostname} отключён и удалён из реестра`);
      },

      toggleAgentFav: (id) => {
        const s = get();
        const a = s.agents.find((x) => x.id === id);
        if (!a) return;
        const favCount = s.devices.filter((d) => d.favorite).length + s.agents.filter((x) => x.favorite).length;
        if (!a.favorite && favCount >= FAVORITES_LIMIT) {
          useToasts.getState().push('warn', `Лимит избранного — ${FAVORITES_LIMIT} элементов`);
          return;
        }
        set({ agents: s.agents.map((x) => (x.id === id ? { ...x, favorite: !x.favorite } : x)) });
      },

      regenAgentToken: (id) => {
        const t = genToken();
        set((s) => ({ agents: s.agents.map((a) => (a.id === id ? { ...a, token: t } : a)) }));
        get().pushEvent('warn', 'agent', 'Токен агента перевыпущен — старый токен недействителен');
        return t;
      },

      // ── Теги ──
      addTag: (label, color) => {
        const s = get();
        const l = label.trim();
        if (!l) return 'Укажите название тега';
        if (s.tags.some((t) => t.label.toLowerCase() === l.toLowerCase())) return 'Такой тег уже есть';
        if (s.tags.length >= 30) return 'Не более 30 тегов';
        set({ tags: [...s.tags, { id: uid('t'), label: l, color }] });
        s.pushEvent('info', 'system', `Создан тег «${l}»`);
        return null;
      },

      removeTag: (id) => {
        const s = get();
        const t = s.tags.find((x) => x.id === id);
        set({
          tags: s.tags.filter((x) => x.id !== id),
          devices: s.devices.map((d) => (d.tags.includes(id) ? { ...d, tags: d.tags.filter((x) => x !== id) } : d)),
        });
        if (t) s.pushEvent('info', 'system', `Тег «${t.label}» удалён`);
      },

      // ── Настройки ──
      saveSettings: (settings) => {
        set({ settings });
        get().pushEvent('info', 'system', 'Системные настройки сохранены');
        useToasts.getState().push('ok', 'Настройки сохранены');
      },

      setSettingsRaw: (settings) => set({ settings }),

      resetBase: () => {
        set({
          devices: [], agents: [], tags: [],
          events: [mkEvent('warn', 'system', 'База очищена: удалены все устройства, агенты и теги')],
        });
      },
    }),
    {
      name: 'pluto-base-v1',
      version: 1,
      partialize: (s) => {
        const { route: _r, routeParam: _p, ...rest } = s;
        return rest as PlutoState;
      },
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<PlutoState>;
        return {
          ...current,
          ...p,
          settings: { ...current.settings, ...(p.settings ?? {}), notifications: { ...current.settings.notifications, ...(p.settings?.notifications ?? {}) } },
          devices: (p.devices ?? []).map((d) => ({ ...d, checking: false })),
          agents: (p.agents ?? []).map((a) => ({ ...a, history: [] })),
          route: 'dashboard',
          routeParam: '',
        };
      },
    },
  ),
);

// ─── Тосты (не сохраняются) ──────────────────────────────────────────────────

export interface Toast {
  id: string;
  kind: 'ok' | 'warn' | 'crit' | 'info';
  text: string;
}

export const useToasts = create<{ list: Toast[]; push: (kind: Toast['kind'], text: string) => void; drop: (id: string) => void }>((set) => ({
  list: [],
  push: (kind, text) => {
    const id = uid('toast');
    set((s) => ({ list: [...s.list.slice(-4), { id, kind, text }] }));
    window.setTimeout(() => set((s) => ({ list: s.list.filter((t) => t.id !== id) })), 4200);
  },
  drop: (id) => set((s) => ({ list: s.list.filter((t) => t.id !== id) })),
}));

// ─── Селекторы ───────────────────────────────────────────────────────────────

export function useCurrentUser(): User | null {
  return useStore((s) => s.users.find((u) => u.id === s.session?.userId) ?? null);
}

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
