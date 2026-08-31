// ─── PLUTO: модель данных ───────────────────────────────────────────────────

export type DeviceType = 'ping' | 'http' | 'api' | 'rtsp' | 'sip';
export type DeviceStatus = 'up' | 'down' | 'degraded' | 'unknown';
export type Route = 'dashboard' | 'devices' | 'agents' | 'settings' | 'deploy';
export type Severity = 'ok' | 'warn' | 'crit' | 'info';
export type Role = 'admin' | 'viewer';

export interface Device {
  id: string;
  name: string;
  type: DeviceType;
  address: string;
  port?: number | null;
  path?: string;
  method?: string | null;
  body?: string | null;
  interval: number; // сек
  tags: string[];
  favorite: boolean;
  showcase: boolean; // NEW: показывать на публичной витрине
  status: DeviceStatus;
  latency: number | null; // мс, null = нет ответа
  history: number[]; // -1 = сбой
  fails: number;
  lastCheck: number;
  lastChange: number;
  checking: boolean;
  approx: boolean;
  createdAt: number;
}

/** Результат пинга одного IP через relay-агент. */
export interface RelayPingResult {
  ip: string;
  alive: boolean;
  latency: number | null; // мс
}

/** Результат опроса одной цели (IP / диапазон) через relay-агент. */
export interface RelayTargetResult {
  target: string;
  lastCheck: number;
  results: RelayPingResult[];
}

/** Агент = ПК, на котором запущен pluto-relay (только пинг). */
export interface Agent {
  id: string;
  name: string;
  ip: string; // адрес ПК
  relayUrl: string; // адрес pluto-relay, напр. http://192.168.1.10:8091
  pingTargets: string[]; // цели, доступные только этому ПК
  targets: RelayTargetResult[];
  favorite: boolean;
  online: boolean;
  latency: number | null;
  onlineSince: number;
  lastSeen: number;
  lastPoll: number;
  latHist: { t: number; ms: number | null }[];
  createdAt: number;
}

export interface Tag {
  id: string;
  label: string;
  color: string;
}

export interface EventItem {
  id: string;
  ts: number;
  sev: Severity;
  source: 'device' | 'agent' | 'system';
  text: string;
}

export interface User {
  id: string;
  login: string;
  name: string;
  role: Role;
  scope: DeviceType[];
  builtIn: boolean;
  createdAt: number;
}

export interface Settings {
  intervals: Record<DeviceType | 'agent', number>;
  timeoutMs: number;
  failThreshold: number;
  degradeFactor: number;
  degradeMinMs: number;
  showcase: { port: number }; // NEW: порт публичной витрины
  notifications: {
    telegram: { enabled: boolean; botToken: string; chatId: string };
    email: { enabled: boolean; smtp: string; from: string; to: string };
    push: { enabled: boolean };
    on: { down: boolean; degraded: boolean; recover: boolean; agentOff: boolean; agentOn: boolean };
  };
}

export const DEVICE_TYPES: DeviceType[] = ['ping', 'http', 'api', 'rtsp', 'sip'];

export const DEVICE_TYPE_META: Record<DeviceType, { label: string; desc: string }> = {
  ping: { label: 'PING', desc: 'ICMP-эхо, задержка и доступность' },
  http: { label: 'HTTP', desc: 'HTTP-запрос на хост:порт/путь' },
  api: { label: 'API', desc: 'Кастомная команда GET/POST' },
  rtsp: { label: 'RTSP', desc: 'Проверка видеопотока' },
  sip: { label: 'SIP', desc: 'SIP OPTIONS эндпоинта' },
};
