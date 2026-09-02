// ─── PLUTO: модель данных ───────────────────────────────────────────────────

export type DeviceType = 'ping' | 'http' | 'api' | 'rtsp' | 'sip';
export type DeviceStatus = 'up' | 'down' | 'degraded' | 'unknown';
export type Route =
  | 'dashboard' | 'devices' | 'agents' | 'agent-pings'
  | 'stats-bars' | 'stats-ws' | 'showcase' | 'settings' | 'deploy';
export type Severity = 'ok' | 'warn' | 'crit' | 'info';
export type Role = 'admin' | 'viewer';

/** Куда попадает агент в статистике: Bars, WS или никуда (только «Агенты»). */
export type StatsView = '' | 'bars' | 'ws';

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
  showcase: boolean; // показывать на публичной витрине
  status: DeviceStatus;
  latency: number | null; // мс, null = нет ответа
  baseline: number | null; // скользящая базовая задержка
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

// ─── Телеметрия Glances ──────────────────────────────────────────────────────

/** Точка истории Glances (компактная — для графиков, хранение 30 дней). */
export interface GlancesPoint {
  t: number;
  cpu: number | null; // CPU, %
  gpu: number | null; // GPU, %
  ram: number | null; // RAM, %
  rx: number | null; // основной адаптер, КБ/с
  tx: number | null;
  cput: number | null; // температура CPU, °C
  ssdt: number | null; // температура SSD, °C
  diskUsed: number | null; // заполненность основной ФС, %
}

export interface GlancesDisk { mnt: string; percent: number | null; usedGB: number | null; sizeGB: number | null; }
export interface GlancesAdapter { name: string; rx: number | null; tx: number | null; } // КБ/с
export interface GlancesSensor { label: string; value: number; unit: string; kind: string; }

/** Полный снимок Glances (последний опрос — для карточки агента). */
export interface GlancesSnapshot {
  t: number;
  cpu: number | null;
  cpuCores: number[]; // загрузка каждого ядра, %
  gpu: number | null;
  gpuTemp: number | null;
  ram: number | null;
  ramUsedGB: number | null;
  ramTotalGB: number | null;
  swap: number | null;
  load1: number | null;
  load5: number | null;
  cput: number | null; // Package / CPU
  ssdt: number | null;
  disks: GlancesDisk[];
  adapters: GlancesAdapter[]; // все сетевые адаптеры
  mainAdapter: string | null;
  rx: number | null;
  tx: number | null;
  sensors: GlancesSensor[];
  uptimeSec: number | null;
  via: string; // api4 | api3
}

export type StatsRange = '5m' | '30m' | '3h' | '24h' | '7d' | '30d';

/** Агент = ПК: пинг (uptime), телеметрия Glances и relay-пинги локальных устройств. */
export interface Agent {
  id: string;
  name: string;
  ip: string;
  relayUrl: string;
  glancesUrl: string;
  pingTargets: string[];
  targets: RelayTargetResult[];
  tags: string[];
  favorite: boolean; // избранное на главной
  statsView: StatsView;
  pingsFavorite: boolean; // окно «Пинги агентов» на главной
  pingsShowcase: boolean; // окно «Пинги агентов» на витрине
  online: boolean;
  latency: number | null; // пинг до ПК, мс
  onlineSince: number;
  lastSeen: number;
  lastPoll: number;
  lastGlances: number;
  latHist: { t: number; ms: number | null }[];
  glances: GlancesPoint[];
  glancesLatest: GlancesSnapshot | null;
  glancesError: string | null;
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

export interface MirrorSettings { enabled: boolean; url: string; secret: string; interval: number; }

export interface Settings {
  intervals: Record<DeviceType | 'agent' | 'glances', number>;
  timeoutMs: number;
  failThreshold: number;
  degradeFactor: number; // во сколько раз выше базовой = деградация
  degradeMinMs: number;
  mirror: MirrorSettings;
  notifications: {
    telegram: { enabled: boolean; botToken: string; chatId: string };
    email: { enabled: boolean; smtp: string; from: string; to: string };
    push: { enabled: boolean };
    on: { down: boolean; degraded: boolean; recover: boolean; agentOff: boolean; agentOn: boolean };
  };
  showcase: { port: number };
}

export const DEVICE_TYPE_META: Record<DeviceType, { label: string; desc: string }> = {
  ping: { label: 'PING', desc: 'ICMP-эхо, задержка и потеря пакетов' },
  http: { label: 'HTTP', desc: 'HTTP-запрос на хост:порт/путь' },
  api: { label: 'API', desc: 'Кастомная команда GET/POST с телом' },
  rtsp: { label: 'RTSP', desc: 'Проверка видеопотока (OPTIONS/DESCRIBE)' },
  sip: { label: 'SIP', desc: 'SIP OPTIONS эндпоинта телефонии' },
};

export const DEVICE_TYPES: DeviceType[] = ['ping', 'http', 'api', 'rtsp', 'sip'];

/** Отчёт диагностики источника (Glances). */
export interface SourceTestReport {
  ok: boolean;
  url: string;
  via: string | null;
  error?: string;
  values?: GlancesPoint;
  recognized?: string[];
  missing?: string[];
  disks?: GlancesDisk[];
  netIface?: string | null;
}
