// ─── PLUTO Core: хранилище, авторизация ─────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const DATA_DIR = process.env.DATA_DIR || './data';
const DB_FILE = path.join(DATA_DIR, 'db.json');

/**
 * Нормализация записи хаба (агента) под текущую схему.
 * Единая реализация для loadDb() и importDb(): раньше нормализация была
 * продублирована в обоих местах и наборы полей могли разойтись.
 */
function normalizeAgent(a) {
  return {
    ...a, pingTargets: Array.isArray(a.pingTargets) ? a.pingTargets : [],
    targets: Array.isArray(a.targets) ? a.targets : [], tags: Array.isArray(a.tags) ? a.tags : [],
    latHist: Array.isArray(a.latHist) ? a.latHist : [], netdata: Array.isArray(a.netdata) ? a.netdata : [],
    // ГЛЮК-ФИКС: UI читает glancesLatest/glances/glancesError/lastGlances — ядро раньше писало только netdata*.
    // Единый канал телеметрии: дублируем netdata*-поля в glances*-алиасы при загрузке.
    glances: Array.isArray(a.glances) ? a.glances : (Array.isArray(a.netdata) ? a.netdata : []),
    glancesLatest: a.glancesLatest !== undefined ? a.glancesLatest : (a.netdataLatest || null),
    glancesError: a.glancesError !== undefined ? a.glancesError : (a.netdataError || null),
    lastGlances: a.lastGlances || a.lastNetdata || 0,
    netdataLatest: a.netdataLatest || null, netdataError: a.netdataError || null,
    relayUrl: a.relayUrl || '', glancesUrl: a.glancesUrl || '', netdataUrl: a.netdataUrl || '',
    agentUrl: a.agentUrl || '', aida64Url: a.aida64Url || '',
    telemetryUrl: a.telemetryUrl || '', telemetrySource: a.telemetrySource || '', lastNetdata: a.lastNetdata || 0,
    hardware: a.hardware || null, hardwareHistory: Array.isArray(a.hardwareHistory) ? a.hardwareHistory : [],
    favorite: !!a.favorite, pingsFavorite: !!a.pingsFavorite, pingsShowcase: !!a.pingsShowcase,
    statsView: a.statsView === 'bars' || a.statsView === 'ws' ? a.statsView : (a.stats ? 'ws' : ''),
  };
}

/** Нормализация записи устройства под текущую схему (единая для loadDb/importDb). */
function normalizeDevice(d) {
  return {
    ...d, tags: Array.isArray(d.tags) ? d.tags : [], history: Array.isArray(d.history) ? d.history : [],
    showcase: !!d.showcase, checking: false,
  };
}

export const DEFAULT_SETTINGS = {
  intervals: { ping: 60, http: 60, api: 180, rtsp: 120, sip: 120, agent: 30, netdata: 20 },
  timeoutMs: 3000, failThreshold: 3, degradeFactor: 10, degradeMinMs: 250,
  mirror: { enabled: false, url: '', secret: '', interval: 60 },
  slaReport: { enabled: false, schedule: 'daily', hour: 8, outputPath: '/home/pluto/Downloads' },
  notifications: {
    telegram: { enabled: false, botToken: '', chatId: '' },
    email: { enabled: false, smtp: '', from: '', to: '' },
    push: { enabled: false },
    integrations: {
      slack: { enabled: false, webhookUrl: '' },
      teams: { enabled: false, webhookUrl: '' },
      discord: { enabled: false, webhookUrl: '' },
    },
    on: {
      device: { down: true, degraded: true, recover: true },
      agent: { agentOff: true, agentOn: false },
      ping: { threshold: true, pingDown: true, pingRecover: false },
    },
  },
  showcase: { port: 8081 },
  // glances — устаревшее имя интервала телеметрии (исторически источник был Glances);
  // приводится к netdata в loadDb(), см. миграцию ниже
};

const DEFAULT_DB = () => ({
  users: [], sessions: [], devices: [], agents: [], tags: [], events: [], srvMaps: [],
  // Web Push подписки (endpoint + keys) — раньше коллекции не существовало,
  // из-за чего модуль webpush.js писал в несуществующее хранилище
  pushSubscriptions: [],
  // Месячная история пингов (см. db/pingHistory.js) — обязательные коллекции:
  // без них в loadDb() они затирались значениями по умолчанию при каждой загрузке
  pingEvents: [], pingDaily: [],
  settings: DEFAULT_SETTINGS,
});

let db = null;
let saveTimer = null;
let saveQueue = [];
let saveInProgress = false;
// Флаг «в базе есть несохранённые изменения» — для периодического сброса на диск
let dirtySinceSave = false;

/**
 * Улучшенная функция сохранения с очередью операций (пункт 8)
 * Предотвращает race conditions при множественных одновременных сохранениях
 */
export function saveDb() {
  dirtySinceSave = true;
  return new Promise((resolve, reject) => {
    saveQueue.push({ resolve, reject });
    _processSaveQueue();
  });
}

/** Есть ли несохранённые изменения (для периодического сброса планировщиком). */
export function hasUnsavedChanges() {
  return dirtySinceSave || saveQueue.length > 0;
}

async function _processSaveQueue() {
  if (saveInProgress || saveQueue.length === 0) {
    return;
  }

  saveInProgress = true;
  const currentBatch = [...saveQueue];
  saveQueue = [];

  try {
    await _doSave();
    dirtySinceSave = false;
    currentBatch.forEach(({ resolve }) => resolve());
  } catch (e) {
    console.error('[pluto] ошибка записи БД:', e.message);
    // Запись на диск не состоялась — изменения всё ещё не сохранены.
    // Возвращаем флаг и ставим батч обратно в очередь: иначе события
    // активности терялись навсегда при ошибке диска (ENOSPC/EACCES).
    dirtySinceSave = true;
    saveQueue.unshift(...currentBatch);
    currentBatch.forEach(({ reject }) => reject(e));
  }

  saveInProgress = false;
  
  // Обработка новых запросов, накопившихся во время сохранения
  if (saveQueue.length > 0) {
    setImmediate(() => _processSaveQueue());
  }
}

async function _doSave() {
  return new Promise((resolve, reject) => {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = DB_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(db));
      fs.renameSync(tmp, DB_FILE);
      resolve();
    } catch (e) {
      reject(e);
    }
  });
}

export function uid() { return crypto.randomBytes(6).toString('hex'); }

export function loadDb() {
  if (db) return db;
  let data = null;
  try {
    if (fs.existsSync(DB_FILE)) data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) {
    console.error('[pluto] повреждён db.json, создаём новую базу:', e.message);
  }
  db = { ...DEFAULT_DB(), ...(data || {}) };
  db.settings = {
    ...DEFAULT_SETTINGS, ...(db.settings || {}),
    intervals: (() => {
      const iv = { ...DEFAULT_SETTINGS.intervals, ...((db.settings || {}).intervals || {}) };
      // Миграция: исторически интервал телеметрии назывался glances (см. веб-консоль)
      if ((db.settings || {}).intervals?.glances != null && ((db.settings || {}).intervals?.netdata == null)) {
        iv.netdata = Number(db.settings.intervals.glances) || DEFAULT_SETTINGS.intervals.netdata;
      }
      return iv;
    })(),
    notifications: (() => {
      const nn = (db.settings || {}).notifications || {};
      const defOn = DEFAULT_SETTINGS.notifications.on;
      const oldOn = nn.on || {};
      let on;
      if (!oldOn.device && !oldOn.agent && !oldOn.ping) {
        // Миграция со старой плоской структуры на группы
        on = {
          device: {
            down: oldOn.down ?? defOn.device.down,
            degraded: oldOn.degraded ?? defOn.device.degraded,
            recover: oldOn.recover ?? defOn.device.recover,
          },
          agent: {
            agentOff: oldOn.agentOff ?? defOn.agent.agentOff,
            agentOn: oldOn.agentOn ?? defOn.agent.agentOn,
          },
          ping: {
            threshold: oldOn.threshold ?? defOn.ping.threshold,
            pingDown: defOn.ping.pingDown,
            pingRecover: defOn.ping.pingRecover,
          },
        };
      } else {
        on = {
          device: { ...defOn.device, ...(oldOn.device || {}) },
          agent: { ...defOn.agent, ...(oldOn.agent || {}) },
          ping: { ...defOn.ping, ...(oldOn.ping || {}) },
        };
      }
      return {
        ...DEFAULT_SETTINGS.notifications,
        ...nn,
        integrations: { ...DEFAULT_SETTINGS.notifications.integrations, ...(nn.integrations || {}) },
        on,
      };
    })(),
    mirror: { ...DEFAULT_SETTINGS.mirror, ...((db.settings || {}).mirror || {}) },
    showcase: { ...DEFAULT_SETTINGS.showcase, ...((db.settings || {}).showcase || {}) },
    slaReport: { ...DEFAULT_SETTINGS.slaReport, ...((db.settings || {}).slaReport || {}) },
  };
  if (db.users.length === 0) {
    db.users.push({
      id: uid(), login: 'admin', name: 'admin', role: 'admin',
      menuScope: [], deviceScope: [], twoFA: { enabled: false, secret: null },
      passHash: hashPass(process.env.ADMIN_PASSWORD || 'pluto'), builtIn: true, createdAt: Date.now(),
    });
    pushEvent('info', 'system', 'Первый запуск ядра: создан администратор admin');
    saveDb();
  }
  // нормализация записей (совместимость со старыми базами) - пункт 19 (миграции схемы)
  db.devices = (db.devices || []).map(normalizeDevice);
  db.agents = (db.agents || []).map(normalizeAgent);
  // пользователи: миграция со старой модели (scope) на новую (menuScope/deviceScope/twoFA)
  db.users = (db.users || []).map((u) => ({
    ...u,
    menuScope: Array.isArray(u.menuScope) ? u.menuScope
      : (u.role === 'admin' ? [] : Array.isArray(u.scope) ? u.scope.filter((s) => s !== 'agent' && s !== 'netdata') : []),
    deviceScope: Array.isArray(u.deviceScope) ? u.deviceScope
      : (Array.isArray(u.scope) ? u.scope.filter((s) => ['ping', 'http', 'api', 'rtsp', 'sip', 'snmp', 'ssl'].includes(s)) : []),
    twoFA: u.twoFA && typeof u.twoFA === 'object' ? { enabled: !!u.twoFA.enabled, secret: u.twoFA.secret || null } : { enabled: false, secret: null },
    builtIn: !!u.builtIn,
  }));
  db.devices.forEach((d) => (d.checking = false));
  return db;
}

export async function pushEvent(sev, source, text) {
  db.events.unshift({ id: uid(), ts: Date.now(), sev, source, text });
  if (db.events.length > 300) db.events.length = 300;
  await saveDb();
}

// ─── Авторизация (scrypt + сессии-токены) ───────────────────────────────────

export function hashPass(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 32);
  return salt.toString('hex') + ':' + key.toString('hex');
}

export function verifyPass(password, stored) {
  try {
    const [saltHex, keyHex] = stored.split(':');
    const key = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), 32);
    return crypto.timingSafeEqual(key, Buffer.from(keyHex, 'hex'));
  } catch {
    return false;
  }
}

// TTL сессии: 30 дней; продлевается при активности (скользящий срок).
// Раньше сессии не истекали никогда и хранились в открытом виде без ограничения жизни.
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Хеш токена сессии — в db.json храним не сам токен, а его SHA-256. */
function hashToken(token) { return crypto.createHash('sha256').update(token).digest('hex'); }

export async function issueSession(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  const now = Date.now();
  // очистка протухших сессий
  db.sessions = (db.sessions || []).filter((s) => now - (s.lastUsed || s.createdAt || 0) < SESSION_TTL_MS);
  db.sessions.push({ tokenHash: hashToken(token), userId, createdAt: now, lastUsed: now });
  if (db.sessions.length > 200) db.sessions.splice(0, db.sessions.length - 200);
  await saveDb();
  return token;
}

export function authUser(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return null;
  const tokenHash = hashToken(token);
  const now = Date.now();
  const s = db.sessions.find((x) => x.tokenHash === tokenHash);
  if (!s) return null;
  if (now - (s.lastUsed || s.createdAt || 0) >= SESSION_TTL_MS) {
    // сессия истекла — удаляем
    db.sessions = db.sessions.filter((x) => x !== s);
    void saveDb().catch(() => {});
    return null;
  }
  // скользящее продление: пишем не чаще раза в минуту, чтобы не дёргать диск
  if (now - (s.lastUsed || 0) > 60_000) {
    s.lastUsed = now;
    void saveDb().catch(() => {});
  }
  return db.users.find((u) => u.id === s.userId) || null;
}

/** Выход: удаление сессии по токену запроса. */
export async function revokeSession(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return false;
  const tokenHash = hashToken(token);
  const before = db.sessions.length;
  db.sessions = db.sessions.filter((x) => x.tokenHash !== tokenHash);
  if (db.sessions.length !== before) { await saveDb(); return true; }
  return false;
}

// ─── Экспорт/импорт базы (перенос на вновь развёрнутый PLUTO) ────────────────

/**
 * Дамп всей базы: устройства, агенты/хабы, настройки, теги, пользователи, карты
 * и полная история пингов (события + суточные агрегаты за месяц).
 * Сессии не включаются (секреты токенов).
 */
export function exportDb() {
  loadDb();
  return {
    __plutoExport: 2,
    version: 2,
    exportedAt: new Date().toISOString(),
    users: db.users,
    devices: (db.devices || []).map((d) => ({ ...d, checking: false })),
    agents: (db.agents || []).map((a) => ({ ...a })),
    tags: db.tags || [],
    srvMaps: db.srvMaps || [],
    settings: db.settings,
    events: (db.events || []).slice(0, 100),
    // история активности пингов: события смены состояния и суточная агрегация (30 дней)
    pingEvents: (db.pingEvents || []).slice(),
    pingDaily: (db.pingDaily || []).slice(),
    // снимки WMI/LibreHardwareMonitor по каждому хабу — переносятся вместе с базой
    hardware: Object.fromEntries((db.agents || []).filter((a) => a.hardware).map((a) => [a.id, a.hardware])),
  };
}

/**
 * Импорт дампа в живую базу. mode: 'merge' (по id) | 'replace' (полная замена).
 * Принимает дампы v1 (без истории пингов) и v2 (с pingEvents/pingDaily).
 * Сессии при replace очищаются — все залогиненные будут перелогинены.
 */
export function importDb(payload, mode = 'merge') {
  loadDb();
  if (!payload || (payload.__plutoExport !== 1 && payload.__plutoExport !== 2)) {
    throw new Error('Файл не является дампом базы PLUTO');
  }
  const pick = (arr) => (Array.isArray(arr) ? arr : []);
  const mergeById = (existing, incoming) => {
    const map = new Map(existing.map((x) => [x.id, x]));
    for (const item of incoming) {
      if (!item) continue;
      const id = item.id || uid();
      map.set(id, map.has(id) ? { ...map.get(id), ...item, id } : { ...item, id });
    }
    return [...map.values()];
  };
  // события/агрегаты истории пингов: только записи с корректной датой (как в sanitizePingEvents).
  // Метки из будущего (часы агента/relay спешат) клампим к Date.now() — иначе событие
  // оказывается за окном выдачи и в журнале светится «пустая дата».
  const validPingEvent = (e) => e && Number.isFinite(Number(e.ts)) && Number(e.ts) > 0;
  const clampEvTs = (e) => { const n = Number(e.ts), now = Date.now(); return n > now ? { ...e, ts: now } : e; };
  const validPingDaily = (d) => d && typeof d.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.date);
  const mergeByKey = (existing, incoming, keyOf) => {
    const map = new Map(existing.map((x) => [keyOf(x), x]));
    for (const item of incoming) if (item) map.set(keyOf(item), item);
    return [...map.values()];
  };

  if (mode === 'replace') {
    db.users = pick(payload.users);
    db.devices = pick(payload.devices);
    db.agents = pick(payload.agents);
    db.tags = pick(payload.tags);
    db.srvMaps = pick(payload.srvMaps);
    db.events = pick(payload.events);
    db.sessions = [];
    if (payload.settings) db.settings = payload.settings;
    db.pingEvents = pick(payload.pingEvents).filter(validPingEvent).map(clampEvTs);
    db.pingDaily = pick(payload.pingDaily).filter(validPingDaily);
  } else {
    db.users = mergeById(db.users || [], pick(payload.users));
    db.devices = mergeById(db.devices || [], pick(payload.devices));
    db.agents = mergeById(db.agents || [], pick(payload.agents));
    db.tags = [...new Set([...(db.tags || []), ...pick(payload.tags)])];
    db.srvMaps = mergeById(db.srvMaps || [], pick(payload.srvMaps));
    if (payload.settings) db.settings = { ...db.settings, ...payload.settings };
    db.pingEvents = mergeByKey(db.pingEvents || [], pick(payload.pingEvents).filter(validPingEvent).map(clampEvTs), (e) => `${e.key || ''}|${e.ts}`);
    db.pingDaily = mergeByKey(db.pingDaily || [], pick(payload.pingDaily).filter(validPingDaily), (d) => `${d.date}|${d.key || ''}`);
  }
  // импортированная история уже валидна — помечаем посев выполненным,
  // иначе seedPingHistoryFromAgents продублирует стартовые события
  db._pingSeeded = (db.pingEvents || []).length > 0;

  // повторная нормализация через loadDb-логику: сбрасываем кэш и перечитываем нельзя,
  // поэтому нормализуем на месте
  db.devices = (db.devices || []).map(normalizeDevice);
  db.agents = (db.agents || []).map(normalizeAgent);
  db.users = (db.users || []).map((u) => ({
    ...u,
    menuScope: Array.isArray(u.menuScope) ? u.menuScope : (u.role === 'admin' ? [] : []),
    deviceScope: Array.isArray(u.deviceScope) ? u.deviceScope : [],
    twoFA: u.twoFA && typeof u.twoFA === 'object' ? { enabled: !!u.twoFA.enabled, secret: u.twoFA.secret || null } : { enabled: false, secret: null },
    builtIn: !!u.builtIn,
  }));

  const counts = {
    devices: db.devices.length,
    agents: db.agents.length,
    users: db.users.length,
    tags: (db.tags || []).length,
    pingEvents: (db.pingEvents || []).length,
    pingDaily: (db.pingDaily || []).length,
  };
  void saveDb();
  return counts;
}
