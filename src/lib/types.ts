// ─── PLUTO: модель данных ───────────────────────────────────────────────────

export type DeviceType = 'ping' | 'http' | 'api' | 'rtsp' | 'sip';
export type DeviceStatus = 'up' | 'down' | 'degraded' | 'unknown';
export type Route = 'dashboard' | 'devices' | 'agents' | 'stats-bars' | 'stats-ws' | 'showcase' | 'settings' | 'deploy';
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
export interface GlancesSensor { label: string; value: number; unit: string; kind: string; } // температуры, вент.

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
  mainAdapter: string | null; // выбранный реальный адаптер
  rx: number | null; // основной адаптер, КБ/с
  tx: number | null;
  sensors: GlancesSensor[]; // все доступные температуры/вентиляторы
  uptimeSec: number | null;
  via: string; // api4 | api3
}

/** Куда попадает агент в статистике: Bars, WS или никуда (только «Агенты»). */
export type StatsView = '' | 'bars' | 'ws';

export type StatsRange = '5m' | '30m' | '3h' | '24h' | '7d' | '30d';

/** Агент = ПК: пинг (uptime), телеметрия Glances и relay-пинги локальных устройств. */
export interface Agent {
  id: string;
  name: string;
  ip: string; // адрес ПК
  relayUrl: string; // адрес pluto-relay, напр. http://192.168.1.10:8091
  glancesUrl: string; // адрес Glances (glances -w), напр. http://192.168.1.10:61208
  pingTargets: string[]; // цели, доступные только этому ПК
  targets: RelayTargetResult[];
  tags: string[]; // присвоенные теги (редактируются в «Изменить»)
  favorite: boolean; // избранное на главной
  /** В какую вкладку статистики попадает агент: 'bars' | 'ws' | '' (ни в какую). */
  statsView: StatsView;
  online: boolean;
  latency: number | null; // пинг до ПК, мс
  onlineSince: number;
  lastSeen: number;
  lastPoll: number;
  lastGlances: number;
  latHist: { t: number; ms: number | null }[];
  glances: GlancesPoint[]; // история (в /api/state — хвост, полная — отдельным запросом)
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
  scope: DeviceType[];
  builtIn: boolean;
  createdAt: number;
}

export interface Settings {
  intervals: Record<DeviceType | 'agent' | 'glances', number>;
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
