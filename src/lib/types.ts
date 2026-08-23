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
  status: DeviceStatus;
  latency: number | null; // мс, null = нет ответа
  baseline: number | null; // скользящая базовая задержка
  history: number[]; // -1 = сбой
  fails: number;
  lastCheck: number;
  lastChange: number;
  checking: boolean;
  approx: boolean; // true = значение синтезировано (не реальный зонд)
  createdAt: number;
  /** эмуляционный профиль — используется только встроенным (браузерным) движком */
  profile?: { base: number; failP: number; spikeP: number };
  spikeUntil?: number;
}

export interface Disk {
  id: string;
  label: string;
  total: number; // байт
  used: number;
  temp: number; // °C
}

export interface LanHost {
  ip: string;
  mac: string;
  hint?: string;
  online: boolean;
}

export interface LanNetwork {
  cidr: string;
  iface: string;
  hosts: LanHost[];
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
  cpuLoad: number;
  cpuCores: number;
  cpuTemp: number;
  ramUsed: number;
  ramTotal: number;
  ramTemp: number;
  disks: Disk[];
  rxBytes: number;
  txBytes: number;
  rxRate: number; // КБ/с
  txRate: number;
  networks: LanNetwork[];
  lastSeen: number;
  lastMetrics: number;
  lastScan: number;
  history: { t: number; cpu: number; ram: number }[];
  favorite: boolean;
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
  scope: DeviceType[]; // для viewer — разрешённые типы; 'agent' как псевдо-тип
  builtIn: boolean;
  createdAt: number;
}

export interface Settings {
  intervals: Record<DeviceType, number>;
  heartbeat: number;
  metrics: number;
  lanScan: number;
  failThreshold: number;
  degradeFactor: number; // во сколько раз выше базовой = деградация
  degradeMinMs: number;
  timeoutMs: number;
  simulate: boolean;
  notifications: {
    telegram: { enabled: boolean; botToken: string; chatId: string };
    email: { enabled: boolean; smtp: string; port: number; from: string; to: string };
    push: { enabled: boolean };
    on: { down: boolean; degraded: boolean; recover: boolean; agentOff: boolean; agentOn: boolean };
  };
}

export const DEVICE_TYPE_META: Record<DeviceType, { label: string; desc: string; defaultPort?: number }> = {
  ping: { label: 'PING', desc: 'ICMP-эхо, задержка и потеря пакетов' },
  http: { label: 'HTTP', desc: 'HTTP-запрос на хост:порт/путь' },
  api: { label: 'API', desc: 'Кастомная команда GET/POST с телом' },
  rtsp: { label: 'RTSP', desc: 'Проверка видеопотока (OPTIONS/DESCRIBE)' },
  sip: { label: 'SIP', desc: 'SIP OPTIONS эндпоинта телефонии' },
};

export const DEVICE_TYPES: DeviceType[] = ['ping', 'http', 'api', 'rtsp', 'sip'];
