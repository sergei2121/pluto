// ─── PLUTO: модель данных ───────────────────────────────────────────────────

export type DeviceType = 'ping' | 'http' | 'api' | 'rtsp' | 'sip';
export type DeviceStatus = 'up' | 'down' | 'degraded' | 'unknown';
export type Route = 'dashboard' | 'devices' | 'agents' | 'telemetry' | 'settings' | 'deploy';
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
  interval: number;
  tags: string[];
  favorite: boolean;
  status: DeviceStatus;
  latency: number | null;
  baseline: number | null;
  history: number[];
  fails: number;
  lastCheck: number;
  lastChange: number;
  checking: boolean;
  approx: boolean;
  createdAt: number;
}

export interface Disk {
  label: string;
  total: number;
  used: number;
  temp: number;
}

export interface LanHost {
  ip: string;
  mac?: string;
  online: boolean;
}

export interface LanNetwork {
  cidr: string;
  iface: string;
  hosts: LanHost[];
}

/** Точка телеметрии AIDA64 (сенсорная веб-страница). null = нет значения. */
export interface AidaPoint {
  t: number; // unix ms
  cpuUsage: number | null; // %  — пункт AIDA64 «CPUu»
  cpuTemp: number | null; // °C — пункт «CPU»
  ram: number | null; // %  — пункт «RAM»
  ssdTemp: number | null; // °C — пункт «SSD»
  diskC: number | null; // %  — пункт «UseC»
  tx: number | null; // КБ/с — пункт «TX» (скорость загрузки адаптера)
  rx: number | null; // КБ/с — пункт «RX» (скорость отдачи адаптера)
  uptimeSec: number | null; // сек — пункт «Uptime»
}

export type AidaRange = '5m' | '30m' | '3h' | '24h' | '7d' | '30d' | '60d';

export interface Agent {
  id: string;
  name: string;
  hostname: string;
  token: string;
  ip: string;
  os: string;
  version: string;
  online: boolean;
  aida64Url?: string; // адрес сенсорной веб-страницы AIDA64
  aidaLatest?: AidaPoint | null;
  aida?: AidaPoint[]; // архив показаний (сервер отдаёт отдельным эндпоинтом)
  cpuLoad: number;
  cpuCores: number;
  cpuTemp: number;
  ramUsed: number;
  ramTotal: number;
  ramTemp: number;
  disks: Disk[];
  rxBytes: number;
  txBytes: number;
  rxRate: number;
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
  name: string;
  role: Role;
  scope: string[];
  builtIn: boolean;
  createdAt: number;
}

export interface Settings {
  intervals: Record<DeviceType, number>;
  heartbeat: number;
  metrics: number;
  lanScan: number;
  failThreshold: number;
  degradeFactor: number;
  degradeMinMs: number;
  timeoutMs: number;
  notifications: {
    telegram: { enabled: boolean; botToken: string; chatId: string };
    email: { enabled: boolean; smtp: string; port: number; from: string; to: string };
    push: { enabled: boolean };
    on: { down: boolean; degraded: boolean; recover: boolean; agentOff: boolean; agentOn: boolean };
  };
}

export const DEVICE_TYPE_META: Record<DeviceType, { label: string; desc: string }> = {
  ping: { label: 'PING', desc: 'ICMP-эхо, задержка и потеря пакетов' },
  http: { label: 'HTTP', desc: 'HTTP-запрос на хост:порт/путь' },
  api: { label: 'API', desc: 'Кастомная команда GET/POST с телом' },
  rtsp: { label: 'RTSP', desc: 'Проверка видеопотока (OPTIONS/DESCRIBE)' },
  sip: { label: 'SIP', desc: 'SIP OPTIONS эндпоинта телефонии' },
};

export const DEVICE_TYPES: DeviceType[] = ['ping', 'http', 'api', 'rtsp', 'sip'];
