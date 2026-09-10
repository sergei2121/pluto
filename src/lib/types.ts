// ─── PLUTO: модель данных ───────────────────────────────────────────────────

export type DeviceType = 'ping' | 'http' | 'api' | 'rtsp' | 'sip' | 'snmp' | 'ssl';
export type DeviceStatus = 'up' | 'down' | 'degraded' | 'unknown';
export type Route =
  | 'dashboard' | 'devices' | 'agents' | 'agent-pings' | 'topology'
  | 'stats-bars' | 'stats-ws' | 'sla' | 'showcase' | 'settings' | 'deploy';
export type Severity = 'ok' | 'warn' | 'crit' | 'info';
export type Role = 'admin' | 'viewer';

/** Куда попадает агент в статистике: Bars, WS или никуда (только «Агенты»). */
export type StatsView = '' | 'bars' | 'ws';

/** Метка SNMP (OID) для чтения с сетевого устройства. */
export interface SnmpOid {
  oid: string;
  label: string;
  unit?: string;
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
  // SNMP
  snmpCommunity?: string; // public
  snmpOids?: SnmpOid[]; // что читать
  snmpValues?: Record<string, string>; // oid -> значение (последний опрос)
  // SSL
  sslDaysLeft?: number | null; // дней до истечения сертификата
  sslSubject?: string; // кому выдан
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

/** Период для статистики. */
export type StatsRange = '5m' | '30m' | '3h' | '24h' | '7d' | '30d';

/** Куда попадает агент в статистике. */
export type StatsView2 = '' | 'bars' | 'ws';

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
  pingsFavorite: boolean; // окно «Пинги агентов» на главной
  pingsShowcase: boolean; // окно «Пинги агентов» на публичной витрине
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
  /** Инвентаризация: данные о машине, собираемые через relay. */
  inventory?: AgentInventory | null;
  createdAt: number;
}

/** Инвентаризационные данные машины (hostname, ОС, железо) — собирает relay. */
export interface AgentInventory {
  hostname: string | null;
  os: string | null;
  cpuModel: string | null;
  cores: number | null;
  ramGB: number | null;
  arch: string | null;
  collectedAt: number;
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
  source: 'device' | 'agent' | 'system' | 'audit';
  text: string;
}

// ─── Пороги и алерты ────────────────────────────────────────────────────────

/** Метрика, по которой можно строить порог. */
export type AlertMetric =
  | 'cpu' | 'gpu' | 'ram' | 'cput' | 'ssdt' | 'diskUsed' | 'swap' | 'load1' // Glances
  | 'latency' | 'sslDaysLeft'; // устройства

export type AlertOp = 'gt' | 'lt' | 'gte' | 'lte';

/** Правило порога: метрика + оператор + значение + длительность нарушения. */
export interface AlertRule {
  id: string;
  name: string;
  metric: AlertMetric;
  op: AlertOp;
  value: number;
  /** Мин. длительность нарушения (сек) до срабатывания, чтобы не дёргать на всплесках. */
  forSec: number;
  sev: Severity; // с какой важностью создавать событие
  notify: boolean; // отправлять ли уведомление
  target: string; // '' = все агенты/устройства; иначе id агента/устройства
  enabled: boolean;
  /** Сервер ведёт: с какого момента метрика нарушает порог (для forSec). */
  breachSince?: number | null;
  lastTriggered?: number | null;
}

// ─── Webhook-интеграции ─────────────────────────────────────────────────────

export interface Webhook {
  id: string;
  name: string;
  url: string;
  /** Какие события отправлять. */
  events: { down: boolean; degraded: boolean; recover: boolean; agentOff: boolean; agentOn: boolean; threshold: boolean };
  enabled: boolean;
  lastSent?: number | null;
  lastError?: string | null;
}

// ─── Бэкапы БД ──────────────────────────────────────────────────────────────

export interface BackupEntry {
  name: string; // имя файла
  ts: number; // время создания
  size: number; // байт
}

// ─── Журнал действий (audit) ───────────────────────────────────────────────

export interface AuditEntry {
  id: string;
  ts: number;
  user: string; // логин
  action: string; // add-device, del-agent, change-settings, login...
  detail: string;
}

// ─── 2FA ────────────────────────────────────────────────────────────────────

export interface TwoFAState {
  enabled: boolean;
  secret: string | null; // base32-секрет TOTP (показывается один раз при включении)
  pendingSecret?: string | null; // при активации — до подтверждения кодом
}

// ─── Пользователи и права ──────────────────────────────────────────────────

export interface User {
  id: string;
  login: string;
  name: string;
  role: Role;
  /**
   * Права viewer:
   *  menu   — какие пункты бокового меню доступны;
   *  device — какие типы устройств видны/управляемы.
   * Для admin поля игнорируются (полный доступ).
   */
  menuScope: Route[];
  deviceScope: DeviceType[];
  builtIn: boolean;
  twoFA: TwoFAState;
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
  snmp: { community: string; timeoutMs: number }; // глобальные SNMP-настройки
  backup: { enabled: boolean; keep: number; lastAt: number | null }; // авто-бэкап (раз в сутки)
  prometheus: { enabled: boolean }; // /metrics для Prometheus
  telegramBot: { enabled: boolean; token: string }; // команды бота (/status, /ping)
  notifications: {
    telegram: { enabled: boolean; botToken: string; chatId: string };
    email: { enabled: boolean; smtp: string; from: string; to: string };
    push: { enabled: boolean };
    on: { down: boolean; degraded: boolean; recover: boolean; agentOff: boolean; agentOn: boolean; threshold: boolean };
  };
  showcase: { port: number; fullscreen: boolean }; // fullscreen — дежурный ТВ-режим
}

export const DEVICE_TYPE_META: Record<DeviceType, { label: string; desc: string }> = {
  ping: { label: 'PING', desc: 'ICMP-эхо, задержка и потеря пакетов' },
  http: { label: 'HTTP', desc: 'HTTP-запрос на хост:порт/путь' },
  api: { label: 'API', desc: 'Кастомная команда GET/POST с телом' },
  rtsp: { label: 'RTSP', desc: 'Проверка видеопотока (OPTIONS/DESCRIBE)' },
  sip: { label: 'SIP', desc: 'SIP OPTIONS эндпоинта телефонии' },
  snmp: { label: 'SNMP', desc: 'Сетевое оборудование: аптайм, порты, температура' },
  ssl: { label: 'SSL', desc: 'Срок действия TLS-сертификата, предупреждение заранее' },
};

export const DEVICE_TYPES: DeviceType[] = ['ping', 'http', 'api', 'rtsp', 'sip', 'snmp', 'ssl'];

/** Пункты бокового меню (для настройки прав viewer). */
export const MENU_ITEMS: { route: Route; label: string; adminOnly?: boolean }[] = [
  { route: 'dashboard', label: 'Главная' },
  { route: 'devices', label: 'Устройства' },
  { route: 'agents', label: 'Агенты' },
  { route: 'agent-pings', label: 'Пинги агентов' },
  { route: 'topology', label: 'Топология' },
  { route: 'stats-bars', label: 'Статистика Bars' },
  { route: 'stats-ws', label: 'Статистика WS' },
  { route: 'sla', label: 'SLA-отчёт' },
  { route: 'showcase', label: 'Витрина', adminOnly: true },
  { route: 'settings', label: 'Настройки системы', adminOnly: true },
  { route: 'deploy', label: 'Развёртывание' },
];

/** Предустановленные SNMP-OID (MIB-II, поддерживаются почти всеми устройствами). */
export const SNMP_PRESETS: SnmpOid[] = [
  { oid: '1.3.6.1.2.1.1.3.0', label: 'Аптайм' },
  { oid: '1.3.6.1.2.1.1.5.0', label: 'Имя хоста' },
  { oid: '1.3.6.1.2.1.25.3.3.1.2', label: 'Загрузка CPU, %' },
  { oid: '1.3.6.1.2.1.25.2.3.1.6', label: 'Использовано RAM' },
  { oid: '1.3.6.1.2.1.2.2.1.8', label: 'Статус портов (ifOperStatus)' },
];

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

/** SLA-строка: доступность устройства за период. */
export interface SlaRow {
  id: string;
  name: string;
  type: DeviceType;
  uptimePct: number; // % доступности
  downCount: number; // сколько раз падало
  avgLatency: number | null;
}
