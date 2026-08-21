// ─── PLUTO: модель данных ────────────────────────────────────────────────────

export type Role = 'admin' | 'viewer';
export type DeviceType = 'ping' | 'http' | 'api' | 'rtsp' | 'sip';
export type DeviceStatus = 'unknown' | 'up' | 'down' | 'degraded';
export type CheckScope = DeviceType | 'agent';
export type Route = 'dashboard' | 'devices' | 'agents' | 'settings' | 'deploy';

export interface User {
  id: string;
  login: string;
  pass: string;
  name: string;
  role: Role;
  scope: CheckScope[]; // для viewer — разрешённые типы устройств
  builtIn?: boolean;
  createdAt: number;
}

export interface Session {
  userId: string;
  at: number;
}

/** Скрытый профиль поведения цели (используется встроенным ядром) */
export interface DeviceProfile {
  base: number;   // базовая задержка, мс
  failP: number;  // вероятность сбоя проверки
  spikeP: number; // вероятность деградации
}

export interface Device {
  id: string;
  name: string;
  type: DeviceType;
  address: string;
  port?: number;
  path?: string;
  method?: 'GET' | 'POST';
  body?: string;
  interval: number; // секунды, кастомный интервал опроса
  tags: string[];
  favorite: boolean;
  status: DeviceStatus;
  latency: number | null;
  approx: boolean; // результат получен эмуляцией протокола
  checking: boolean;
  lastCheck: number;
  lastChange: number;
  fails: number;
  history: number[]; // задержки; -1 = сбой
  spikeUntil: number;
  profile: DeviceProfile;
  createdAt: number;
}

export interface DiskInfo {
  letter: string;
  label: string;
  used: number;
  total: number;
  temp: number;
}

export interface LanHost {
  ip: string;
  mac: string;
  hint?: string;
  online: boolean;
}

export interface LanNet {
  cidr: string;
  iface: string;
  hosts: LanHost[];
}

export interface MetricPoint {
  t: number;
  cpu: number;
  ram: number;
  rx: number; // КБ/с
  tx: number;
}

export interface Agent {
  id: string;
  name: string;
  hostname: string;
  token: string;
  ip: string;
  os: string;
  version: string;
  online: boolean;
  emulated: boolean;
  lastSeen: number;
  connectedAt: number;
  reconnectAt: number;
  cpuLoad: number;
  cpuCores: number;
  cpuTemp: number;
  ramUsed: number;  // байты
  ramTotal: number;
  ramTemp: number;
  disks: DiskInfo[];
  netIface: string;
  rxBytes: number;
  txBytes: number;
  rxRate: number; // КБ/с
  txRate: number;
  networks: LanNet[];
  nextScan: number;
  lastMetrics: number;
  history: MetricPoint[];
  favorite: boolean;
  createdAt: number;
}

export interface Tag {
  id: string;
  label: string;
  color: string;
}

export type Severity = 'info' | 'ok' | 'warn' | 'crit';

export interface EventItem {
  id: string;
  ts: number;
  sev: Severity;
  source: 'device' | 'agent' | 'system' | 'auth';
  text: string;
}

export interface NotificationSettings {
  telegram: { enabled: boolean; botToken: string; chatId: string };
  email: { enabled: boolean; smtp: string; port: number; from: string; to: string };
  push: { enabled: boolean };
  on: {
    down: boolean;
    degraded: boolean;
    recover: boolean;
    agentOff: boolean;
    agentOn: boolean;
  };
}

export interface Settings {
  intervals: Record<DeviceType, number>;
  heartbeat: number;  // сек
  metrics: number;    // сек
  lanScan: number;    // сек
  failThreshold: number;
  degradeFactor: number;
  degradeMinMs: number;
  timeoutMs: number;
  simulate: boolean; // сетевая эмуляция встроенного ядра
  notifications: NotificationSettings;
}

export const DEVICE_TYPES: DeviceType[] = ['ping', 'http', 'api', 'rtsp', 'sip'];
export const SCOPE_ALL: CheckScope[] = ['ping', 'http', 'api', 'rtsp', 'sip', 'agent'];

export const DEVICE_TYPE_META: Record<DeviceType, { label: string; short: string }> = {
  ping: { label: 'Ping (ICMP)', short: 'PING' },
  http: { label: 'HTTP-запрос', short: 'HTTP' },
  api: { label: 'API-команда', short: 'API' },
  rtsp: { label: 'RTSP-поток', short: 'RTSP' },
  sip: { label: 'SIP (OPTIONS)', short: 'SIP' },
};
