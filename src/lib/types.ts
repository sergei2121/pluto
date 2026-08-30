// ─── PLUTO: модель данных ───────────────────────────────────────────────────

export type DeviceType = 'ping' | 'http' | 'api' | 'rtsp' | 'sip';
export type DeviceStatus = 'up' | 'down' | 'degraded' | 'unknown';
export type Route = 'dashboard' | 'devices' | 'agents' | 'telemetry' | 'bars' | 'settings' | 'deploy';
export type Severity = 'ok' | 'warn' | 'crit' | 'info';
export type Role = 'admin' | 'viewer';
export type ApiMode = 'embedded' | 'server';

export interface DeviceProfile {
  base: number;
  failP: number;
  spikeP: number;
}

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
  latency: number | null;
  baseline: number | null;
  history: number[]; // -1 = сбой
  fails: number;
  lastCheck: number;
  lastChange: number;
  checking: boolean;
  approx: boolean; // true = значение синтезировано (не реальный зонд)
  profile: DeviceProfile; // эмуляционный профиль (встроенный режим)
  spikeUntil: number;
  createdAt: number;
}

export const DEVICE_TYPE_META: Record<DeviceType, { label: string; desc: string }> = {
  ping: { label: 'PING', desc: 'ICMP-эхо: задержка и потеря пакетов' },
  http: { label: 'HTTP', desc: 'HTTP-запрос на хост:порт/путь' },
  api: { label: 'API', desc: 'Кастомная команда GET/POST с телом' },
  rtsp: { label: 'RTSP', desc: 'Проверка видеопотока (OPTIONS/DESCRIBE)' },
  sip: { label: 'SIP', desc: 'SIP OPTIONS эндпоинта телефонии' },
};

export const DEVICE_TYPES: DeviceType[] = ['ping', 'http', 'api', 'rtsp', 'sip'];

// ─── AIDA64: точка показаний (листинг RemoteSensor) ─────────────────────────

export interface AidaPoint {
  t: number; // unix ms
  cpuUsage: number | null; // %  — пункт «CPUu»
  cpuTemp: number | null; // °C — пункт «CPU»
  ram: number | null; // %  — пункт «RAM»
  ssdTemp: number | null; // °C — пункт «SSD»
  diskC: number | null; // %  — пункт «UseC»
  usedSpaceC: number | null; // ГБ — пункт «UsedSpaceC»
  tx: number | null; // КБ/с — пункт «TX»
  rx: number | null; // КБ/с — пункт «RX»
  uptimeSec: number | null; // сек — пункт «Uptime»
}

export type AidaRange = '5m' | '30m' | '3h' | '24h' | '7d' | '30d' | '60d';

export const AIDA_RANGES: { v: AidaRange; label: string }[] = [
  { v: '5m', label: '5 мин' }, { v: '30m', label: '30 мин' }, { v: '3h', label: '3 часа' },
  { v: '24h', label: '24 часа' }, { v: '7d', label: '7 дней' }, { v: '30d', label: '30 дней' },
  { v: '60d', label: '60 дней' },
];

export const AIDA_FIELDS: { k: keyof AidaPoint; label: string; unit: string }[] = [
  { k: 'cpuUsage', label: 'CPUu', unit: '%' },
  { k: 'cpuTemp', label: 'CPU', unit: '°C' },
  { k: 'ram', label: 'RAM', unit: '%' },
  { k: 'ssdTemp', label: 'SSD', unit: '°C' },
  { k: 'diskC', label: 'UseC', unit: '%' },
  { k: 'usedSpaceC', label: 'UsedSpaceC', unit: 'ГБ' },
  { k: 'tx', label: 'TX', unit: 'КБ/с' },
  { k: 'rx', label: 'RX', unit: 'КБ/с' },
  { k: 'uptimeSec', label: 'Uptime', unit: 'с' },
];

// ─── Glances: точка показаний (веб-страница, порт 61208) ────────────────────

export interface GlancesPoint {
  t: number;
  cpu: number | null; // CPU, %
  user: number | null;
  system: number | null;
  iowait: number | null;
  idle: number | null;
  irq: number | null;
  nice: number | null;
  steal: number | null;
  mem: number | null; // MEM, %
  memTotal: number | null; // ГБ
  memUsed: number | null; // ГБ
  memFree: number | null; // ГБ
  rx: number | null; // КБ/с
  tx: number | null; // КБ/с
  pkg: number | null; // Package — температура ЦП, °C
}

export type GlancesRange = '5m' | '30m' | '3h' | '24h' | '7d' | '30d';

export const GLANCES_RANGES: { v: GlancesRange; label: string }[] = [
  { v: '5m', label: '5 мин' }, { v: '30m', label: '30 мин' }, { v: '3h', label: '3 часа' },
  { v: '24h', label: '24 часа' }, { v: '7d', label: '7 дней' }, { v: '30d', label: '30 дней' },
];

export const GLANCES_FIELDS: { k: keyof GlancesPoint; label: string; unit: string }[] = [
  { k: 'cpu', label: 'CPU', unit: '%' },
  { k: 'user', label: 'user', unit: '%' },
  { k: 'system', label: 'system', unit: '%' },
  { k: 'iowait', label: 'iowait', unit: '%' },
  { k: 'idle', label: 'idle', unit: '%' },
  { k: 'mem', label: 'MEM', unit: '%' },
  { k: 'memUsed', label: 'used', unit: 'ГБ' },
  { k: 'memTotal', label: 'total', unit: 'ГБ' },
  { k: 'rx', label: 'Rx/s', unit: 'КБ/с' },
  { k: 'tx', label: 'Tx/s', unit: 'КБ/с' },
  { k: 'pkg', label: 'Package', unit: '°C' },
];

// ─── Агент: IP + AIDA64 + Glances + relay (без токенов и установки ПО) ──────

export interface PingResult {
  ip: string;
  alive: boolean;
  latency: number | null;
}

export interface AgentTarget {
  target: string;
  results: PingResult[];
  lastCheck: number;
}

export interface Agent {
  id: string;
  name: string;
  ip: string;
  aidaUrl: string; // листинг AIDA64 RemoteSensor
  glancesUrl: string; // веб-страница Glances (http://<IP>:61208)
  relayUrl: string; // aida-monitor внутри VLAN (loopback-обход + пинги)
  pingTargets: string[]; // IP / диапазон / подсеть — пингуются через relay
  favorite: boolean;
  online: boolean;
  latency: number | null;
  onlineSince: number;
  lastSeen: number;
  lastPoll: number;
  lastAida: number;
  lastGlances: number;
  lastError: string | null;
  latest: AidaPoint | null;
  glancesLatest: GlancesPoint | null;
  aida: AidaPoint[]; // 60 дней
  glances: GlancesPoint[]; // 30 дней
  latHist: { t: number; ms: number | null }[];
  targets: AgentTarget[];
  createdAt: number;
}

// ─── Glances-устройство (вкладка Bars, самостоятельные серверы) ─────────────

export interface GlancesDevice {
  id: string;
  name: string;
  url: string;
  serverLink: string;
  createdAt: number;
  lastScrape: number;
  lastError: string | null;
  online: boolean;
  latest: GlancesPoint | null;
  history?: GlancesPoint[];
}

// ─── Прочее ─────────────────────────────────────────────────────────────────

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
  login: string;
  role: Role;
  scope: string[]; // типы устройств + 'agent' + 'glances'
  builtIn: boolean;
  createdAt: number;
}

export interface Settings {
  intervals: Record<DeviceType | 'glances' | 'agent' | 'aida', number>;
  timeoutMs: number;
  failThreshold: number;
  degradeFactor: number;
  degradeMinMs: number;
  notifications: {
    telegram: { enabled: boolean; botToken: string; chatId: string };
    email: { enabled: boolean; smtp: string; from: string; to: string };
    push: { enabled: boolean };
    on: { down: boolean; degraded: boolean; recover: boolean; agentOff: boolean; agentOn: boolean };
  };
}

/** Отчёт диагностики источника (AIDA64 / Glances). */
export interface SourceTestReport {
  ok: boolean;
  url: string;
  via: 'direct' | 'relay' | null;
  error?: string;
  bytes?: number;
  sample?: string;
  recognized?: string[];
  missing?: string[];
  values?: Record<string, number | null>;
}
