// ─── PLUTO Core: хранилище, авторизация, WebSocket-сервер ───────────────────
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const DATA_DIR = process.env.DATA_DIR || './data';
const DB_FILE = path.join(DATA_DIR, 'db.json');

export const DEFAULT_SETTINGS = {
  intervals: { ping: 60, http: 60, api: 180, rtsp: 120, sip: 120, glances: 60, agent: 30, aida: 10 },
  timeoutMs: 3000,
  failThreshold: 3,
  degradeFactor: 10,
  degradeMinMs: 250,
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
  glances: [],
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
    console.error('[pluto] db.json повреждён, создаём новую базу:', e.message);
  }
  db = { ...DEFAULT_DB(), ...(data || {}) };
  db.settings = {
    ...DEFAULT_SETTINGS,
    ...(db.settings || {}),
    intervals: { ...DEFAULT_SETTINGS.intervals, ...((db.settings || {}).intervals || {}) },
    notifications: { ...DEFAULT_SETTINGS.notifications, ...((db.settings || {}).notifications || {}) },
  };

  // Нормализация записей: db.json живёт между версиями ядра, старые записи
  // могут не иметь новых полей — гарантируем дефолты, чтобы клиенты не падали.
  db.devices = (db.devices || []).map((d) => ({
    ...d,
    tags: Array.isArray(d.tags) ? d.tags : [],
    history: Array.isArray(d.history) ? d.history : [],
    checking: false,
    profile: d.profile || { base: 20, failP: 0.03, spikeP: 0.02 },
  }));
  db.agents = (db.agents || []).map((a) => ({
    ...a,
    pingTargets: Array.isArray(a.pingTargets) ? a.pingTargets : [],
    targets: Array.isArray(a.targets) ? a.targets : [],
    latHist: Array.isArray(a.latHist) ? a.latHist : [],
    aida: Array.isArray(a.aida) ? a.aida : [],
    glances: Array.isArray(a.glances) ? a.glances : [],
    aidaUrl: a.aidaUrl || '',
    glancesUrl: a.glancesUrl || '',
    relayUrl: a.relayUrl || '',
    latest: a.latest || null,
    glancesLatest: a.glancesLatest || null,
    glancesDisks: Array.isArray(a.glancesDisks) ? a.glancesDisks : [],
    glancesNetIface: a.glancesNetIface || null,
    lastAida: a.lastAida || 0,
    lastGlances: a.lastGlances || 0,
  }));
  db.glances = (db.glances || []).map((g) => ({ ...g, history: Array.isArray(g.history) ? g.history : [], disks: Array.isArray(g.disks) ? g.disks : [], netIface: g.netIface || null, scraping: false }));

  // первый запуск: администратор по умолчанию
  if (!db.users.length) {
    db.users.push({
      id: uid(),
      name: 'admin',
      login: 'admin',
      role: 'admin',
      scope: [],
      builtIn: true,
      passHash: hashPass(process.env.ADMIN_PASSWORD || 'pluto'),
      createdAt: Date.now(),
    });
    pushEvent('info', 'system', 'Первый запуск ядра: создан администратор admin');
    saveDb();
  }
  return db;
}

export function saveDb() {
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
  }, 250);
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

// ─── Минимальный WebSocket-сервер (RFC 6455, без зависимостей) ──────────────

export function attachWs(httpServer, onConnection) {
  httpServer.on('upgrade', (req, socket) => {
    const url = new URL(req.url, 'http://localhost');
    const key = req.headers['sec-websocket-key'];
    if (url.pathname !== '/ws' || !key) {
      socket.destroy();
      return;
    }
    const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n',
    );
    onConnection(wrapSocket(socket), url, socket.remoteAddress);
  });
}

function wrapSocket(socket) {
  let buf = Buffer.alloc(0);
  const onMessage = [];
  const onClose = [];
  let closed = false;

  const conn = {
    send(text) {
      if (closed) return;
      const payload = Buffer.from(text, 'utf8');
      let header;
      if (payload.length < 126) header = Buffer.from([0x81, payload.length]);
      else if (payload.length < 65536) {
        header = Buffer.alloc(4);
        header[0] = 0x81;
        header[1] = 126;
        header.writeUInt16BE(payload.length, 2);
      } else {
        header = Buffer.alloc(10);
        header[0] = 0x81;
        header[1] = 127;
        header.writeBigUInt64BE(BigInt(payload.length), 2);
      }
      try { socket.write(Buffer.concat([header, payload])); } catch { /* сокет закрыт */ }
    },
    close() {
      closed = true;
      try { socket.write(Buffer.from([0x88, 0x00])); } catch { /* ignore */ }
      socket.end();
    },
    onMessage(fn) { onMessage.push(fn); },
    onClose(fn) { onClose.push(fn); },
  };

  const emitClose = () => {
    if (closed) return;
    closed = true;
    onClose.forEach((f) => f());
  };

  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      const opcode = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f;
      let off = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        len = Number(buf.readBigUInt64BE(2));
        off = 10;
      }
      if (buf.length < off + (masked ? 4 : 0) + len) return;
      let mask = null;
      if (masked) { mask = buf.subarray(off, off + 4); off += 4; }
      const payload = Buffer.from(buf.subarray(off, off + len));
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      buf = buf.subarray(off + len);
      if (opcode === 0x8) { emitClose(); socket.end(); return; }
      if (opcode === 0x9) { socket.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload])); continue; }
      if (opcode === 0xa) continue;
      if (opcode === 0x1 || opcode === 0x2) onMessage.forEach((f) => f(payload.toString('utf8')));
    }
  });
  socket.on('close', emitClose);
  socket.on('error', emitClose);
  return conn;
}
