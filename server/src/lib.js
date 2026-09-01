// ─── PLUTO Core: хранилище, авторизация, события ─────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const DATA_DIR = process.env.DATA_DIR || './data';
const DB_FILE = path.join(DATA_DIR, 'db.json');

export const DEFAULT_SETTINGS = {
  intervals: { ping: 60, http: 60, api: 180, rtsp: 120, sip: 120, agent: 30, glances: 60 },
  timeoutMs: 3000,
  failThreshold: 3,
  degradeFactor: 10,
  degradeMinMs: 250,
  showcase: { port: 8081 },
  notifications: {
    telegram: { enabled: false, botToken: '', chatId: '' },
    email: { enabled: false, smtp: '', from: '', to: '' },
    push: { enabled: false },
    on: { down: true, degraded: true, recover: true, agentOff: true, agentOn: false },
  },
};

const DEFAULT_DB = () => ({
  users: [],
  sessions: [],
  devices: [],
  agents: [],
  tags: [],
  events: [],
  settings: DEFAULT_SETTINGS,
});

let db = null;
let saveTimer = null;

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
    ...DEFAULT_SETTINGS,
    ...(db.settings || {}),
    intervals: { ...DEFAULT_SETTINGS.intervals, ...((db.settings || {}).intervals || {}) },
    notifications: { ...DEFAULT_SETTINGS.notifications, ...((db.settings || {}).notifications || {}) },
    showcase: { ...DEFAULT_SETTINGS.showcase, ...((db.settings || {}).showcase || {}) },
  };

  // Нормализация записей между версиями ядра
  db.devices = (db.devices || []).map((d) => ({
    ...d,
    tags: Array.isArray(d.tags) ? d.tags : [],
    history: Array.isArray(d.history) ? d.history : [],
    showcase: !!d.showcase,
    checking: false,
  }));
  db.agents = (db.agents || []).map((a) => ({
    ...a,
    pingTargets: Array.isArray(a.pingTargets) ? a.pingTargets : [],
    targets: Array.isArray(a.targets) ? a.targets : [],
    latHist: Array.isArray(a.latHist) ? a.latHist : [],
    glances: Array.isArray(a.glances) ? a.glances : [],
    glancesLatest: a.glancesLatest || null,
    glancesError: a.glancesError || null,
    relayUrl: a.relayUrl || '',
    glancesUrl: a.glancesUrl || '',
    lastGlances: a.lastGlances || 0,
  }));

  if (!db.users.length) {
    db.users.push({
      id: uid(), login: 'admin', name: 'admin', role: 'admin', scope: [],
      passHash: hashPass(process.env.ADMIN_PASSWORD || 'pluto'), builtIn: true, createdAt: Date.now(),
    });
    pushEvent('info', 'system', 'Первый запуск ядра: создан администратор admin');
  }
  saveDb();
  return db;
}

export function saveDb() {
  // Дебаунс: при тысячах устройств проверки идут непрерывно, и сериализация
  // базы на каждый чих блокировала бы event loop. 2 с — безопасный компромисс.
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = DB_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(db));
      fs.renameSync(tmp, DB_FILE);
    } catch (e) {
      console.error('[pluto] ошибка записи БД:', e.message);
    }
  }, 2000);
}

export function getDb() {
  return db;
}

export function uid() {
  return crypto.randomBytes(6).toString('hex');
}

export function pushEvent(sev, source, text) {
  db.events.unshift({ id: uid(), ts: Date.now(), sev, source, text });
  if (db.events.length > 300) db.events.length = 300;
  saveDb();
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

export function issueSession(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  db.sessions.push({ token, userId, createdAt: Date.now() });
  if (db.sessions.length > 200) db.sessions.splice(0, db.sessions.length - 200);
  saveDb();
  return token;
}

export function authUser(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return null;
  const s = db.sessions.find((x) => x.token === token);
  if (!s) return null;
  return db.users.find((u) => u.id === s.userId) || null;
}

export const publicUser = (u) => ({
  id: u.id, login: u.login, name: u.name, role: u.role, scope: u.scope,
  builtIn: u.builtIn, createdAt: u.createdAt,
});
