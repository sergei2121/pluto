// ─── PLUTO Core: HTTP-сервер, проверки, relay-агенты, публичная витрина ──────
import http from 'node:http';
import net from 'node:net';
import dgram from 'node:dgram';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import {
  loadDb, getDb, saveDb, uid, pushEvent, hashPass, verifyPass,
  issueSession, authUser, publicUser, DEFAULT_SETTINGS,
} from './lib.js';

const VERSION = '1.13.1';
const HTTP_PORT = parseInt(process.env.HTTP_PORT || '8080', 10);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(__dirname, '..', 'web');

const db = loadDb();

// ─── HTTP-хелперы ────────────────────────────────────────────────────────────

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}
function text(res, code, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

// ─── Проверки устройств ─────────────────────────────────────────────────────

function checkPing(addr, timeoutMs) {
  return new Promise((resolve) => {
    const secs = Math.max(1, Math.round(timeoutMs / 1000));
    const t0 = Date.now();
    execFile('ping', ['-c', '1', '-W', String(secs), addr], { timeout: timeoutMs + 2000 }, (err, stdout) => {
      if (err) return resolve({ ok: false, latency: 0 });
      const m = /time[=<]\s*([\d.]+)\s*ms/.exec(stdout || '');
      resolve(m ? { ok: true, latency: Math.max(1, Math.round(parseFloat(m[1]))) } : { ok: true, latency: Date.now() - t0 });
    });
  });
}

async function checkHttp(addr, port, pth, method, body, timeoutMs) {
  const t0 = Date.now();
  let url;
  try {
    url = /^https?:\/\//.test(addr) ? addr : `http://${addr}${port ? ':' + port : ''}${pth ? (pth.startsWith('/') ? pth : '/' + pth) : '/'}`;
  } catch { return { ok: false, latency: 0 }; }
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), timeoutMs);
    await fetch(url, { method: method || 'GET', signal: ctrl.signal, body: body && method !== 'GET' ? body : undefined });
    clearTimeout(to);
    return { ok: true, latency: Math.max(1, Date.now() - t0) };
  } catch { return { ok: false, latency: 0 }; }
}

function checkRtsp(addr, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => { if (!done) { done = true; try { sock.destroy(); } catch {} resolve({ ok, latency: ok ? Date.now() - t0 : 0 }); } };
    const t0 = Date.now();
    const to = setTimeout(() => finish(false), timeoutMs);
    let host = addr, port = 554;
    try {
      const u = new URL(addr); host = u.hostname; port = parseInt(u.port, 10) || 554;
    } catch { const m = /^([^:/]+)(?::(\d+))?/.exec(addr); if (m) { host = m[1]; port = parseInt(m[2], 10) || 554; } }
    const sock = net.connect(port, host, () => {
      sock.write(`OPTIONS ${addr} RTSP/1.0\r\nCSeq: 1\r\n\r\n`);
    });
    sock.on('data', (d) => { clearTimeout(to); finish(/RTSP\/1\.0 200/.test(String(d))); });
    sock.on('error', () => { clearTimeout(to); finish(false); });
  });
}

function checkSip(addr, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => { if (!done) { done = true; try { sock.close(); } catch {} resolve({ ok, latency: ok ? Date.now() - t0 : 0 }); } };
    const t0 = Date.now();
    const to = setTimeout(() => finish(false), timeoutMs);
    let host = addr, port = 5060;
    const m = /^sip:([^@:/]+)(?::(\d+))?/.exec(addr);
    if (m) { host = m[1]; port = parseInt(m[2], 10) || 5060; }
    const sock = dgram.createSocket('udp4');
    sock.on('message', (d) => { clearTimeout(to); finish(/SIP\/2\.0 200/.test(String(d))); });
    sock.on('error', () => { clearTimeout(to); finish(false); });
    const req = `OPTIONS sip:${host}:${port} SIP/2.0\r\nVia: SIP/2.0/UDP pluto\r\nCSeq: 1 OPTIONS\r\nCall-ID: ${uid()}@pluto\r\n\r\n`;
    sock.send(req, port, host);
  });
}

async function runDeviceCheck(d) {
  const t = db.settings.timeoutMs || 3000;
  if (d.type === 'ping') return checkPing(d.address, t);
  if (d.type === 'http') return checkHttp(d.address, d.port, d.path, 'GET', null, t);
  if (d.type === 'api') return checkHttp(d.address, d.port, d.path, d.method || 'GET', d.body, t);
  if (d.type === 'rtsp') return checkRtsp(d.address, t);
  if (d.type === 'sip') return checkSip(d.address, t);
  return { ok: false, latency: 0 };
}

function applyDeviceResult(d, r) {
  const now = Date.now();
  const history = [...d.history, r.ok ? r.latency : -1].slice(-48);
  const cfg = db.settings;
  if (!r.ok) {
    const fails = (d.fails || 0) + 1;
    if (fails >= cfg.failThreshold && d.status !== 'down') {
      pushEvent('crit', 'device', `${d.type.toUpperCase()} ${d.address} — потеря связи (${fails} сб. подряд)`);
    }
    Object.assign(d, { fails, status: fails >= cfg.failThreshold ? 'down' : d.status, latency: null, lastCheck: now, lastChange: d.status === 'down' ? d.lastChange : now, history, checking: false });
  } else {
    const degraded = r.latency > cfg.degradeMinMs && d.latency != null && r.latency > d.latency * cfg.degradeFactor;
    const status = degraded ? 'degraded' : 'up';
    if (d.status === 'down') pushEvent('ok', 'device', `${d.name} (${d.address}) — связь восстановлена`);
    else if (degraded && d.status !== 'degraded') pushEvent('warn', 'device', `${d.name}: деградация связи — ${r.latency} мс`);
    Object.assign(d, { fails: 0, status, latency: r.latency, lastCheck: now, lastChange: status === d.status ? d.lastChange : now, history, checking: false });
  }
  saveDb();
}

// ─── Relay-агенты: пинг целей через pluto-relay на ПК ───────────────────────

function expandTargets(target) {
  const t = String(target).trim();
  const ip = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(t);
  if (ip) return [t];
  const range = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.)(\d{1,3})\s*-\s*(\d{1,3})$/.exec(t);
  if (range) {
    const out = [];
    for (let i = Math.min(+range[2], +range[3]); i <= Math.max(+range[2], +range[3]) && out.length < 256; i++) out.push(range[1] + i);
    return out;
  }
  const cidr = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.)\d{1,3}\/(\d{1,2})$/.exec(t);
  if (cidr && parseInt(cidr[2], 10) >= 24) {
    const out = [];
    for (let i = 1; i < 255; i++) out.push(cidr[1] + i);
    return out;
  }
  return [];
}

// ─── Телеметрия Glances (данные для журнала статистики) ─────────────────────

const GLANCES_RETENTION_MS = 30 * 86400000; // хранение истории — 30 дней
const GLANCES_MAX_POINTS = 4000;

function fetchJson(url, timeoutMs = 7000) {
  return new Promise((resolve, reject) => {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), timeoutMs);
    fetch(url, { signal: ctrl.signal })
      .then((r) => {
        clearTimeout(to);
        if (!r.ok) return reject(new Error('HTTP ' + r.status));
        return r.json().then(resolve, reject);
      })
      .catch((e) => { clearTimeout(to); reject(e); });
  });
}

const num = (v) => (typeof v === 'number' && isFinite(v) ? Math.round(v * 10) / 10 : null);

/** Сетевой адаптер «виртуальный»? (veth, docker, virbr, vpn, tap, hyper-v и т.п.) */
function isVirtualIface(name) {
  return /^(veth|docker|br-|virbr|tap|tun|vboxnet|vmnet|hyper-v|hyper_v|isatap|teredo|bluetooth|loopback|lo$)/i.test(String(name));
}

/** Разбор ответа Glances (/api/4/all или /api/3/all) в полный снимок. */
function parseGlancesAll(data) {
  const cpu = data.cpu || {};
  const mem = data.mem || {};
  const swap = data.swap || {};
  const load = data.load || {};

  // ядра CPU
  const cores = Array.isArray(data.percpu) ? data.percpu.map((c) => num(c.total)) : [];

  // GPU: берём первую карту (glances отдаёт массив)
  let gpu = null, gpuTemp = null;
  const gpus = Array.isArray(data.gpu) ? data.gpu : [];
  if (gpus.length) { gpu = num(gpus[0].proc ?? gpus[0].percent ?? null); gpuTemp = num(gpus[0].temperature ?? null); }

  // диски (fs)
  const disks = (Array.isArray(data.fs) ? data.fs : []).map((f) => ({
    mnt: String(f.mnt_point || f.device_name || '?'),
    percent: num(f.percent ?? null),
    usedGB: f.used != null ? Math.round((f.used / 1073741824) * 10) / 10 : null,
    sizeGB: f.size != null ? Math.round((f.size / 1073741824) * 10) / 10 : null,
  }));

  // сетевые адаптеры (bytes/s → КБ/с), все + выбор реального по трафику
  const adapters = (Array.isArray(data.network) ? data.network : [])
    .filter((n) => n.interface_name)
    .map((n) => ({
      name: String(n.interface_name),
      rx: n.bytes_recv != null ? Math.round((n.bytes_recv / 1024) * 10) / 10 : num(n.rx ?? null),
      tx: n.bytes_sent != null ? Math.round((n.bytes_sent / 1024) * 10) / 10 : num(n.tx ?? null),
    }));
  let mainAdapter = null, best = -1;
  for (const a of adapters) {
    if (isVirtualIface(a.name)) continue;
    const traffic = (a.rx || 0) + (a.tx || 0);
    if (traffic > best) { best = traffic; mainAdapter = a.name; }
  }
  if (!mainAdapter && adapters.length) mainAdapter = adapters[0].name;
  const main = adapters.find((a) => a.name === mainAdapter) || null;

  // все датчики: температуры и вентиляторы
  const sensors = (Array.isArray(data.sensors) ? data.sensors : [])
    .filter((s) => s.value != null)
    .map((s) => ({
      label: String(s.label || s.name || 'sensor'),
      value: Math.round(Number(s.value) * 10) / 10,
      unit: s.unit === 'RPM' ? 'об/м' : '°C',
      kind: s.type === 'fan_speed' || s.unit === 'RPM' ? 'fan' : 'temp',
    }));

  const cput = num(cpu.temperature ?? null)
    ?? (() => { const s = sensors.find((s) => s.kind === 'temp' && /package|^cpu/i.test(s.label)); return s ? s.value : null; })();
  const ssdt = (() => { const s = sensors.find((s) => s.kind === 'temp' && /ssd|nvme|disk/i.test(s.label)); return s ? s.value : null; })();

  const mainFs = disks.find((d) => d.mnt === '/' || /^[A-Za-z]:\\?$/.test(d.mnt)) || disks[0] || null;

  let uptimeSec = null;
  const up = data.uptime;
  if (typeof up === 'string') {
    const hms = /(\d+):(\d{1,2}):(\d{1,2})/.exec(up);
    const dm = /(\d+)\s*(?:д|d)/i.exec(up);
    if (hms) uptimeSec = (dm ? parseInt(dm[1], 10) : 0) * 86400 + parseInt(hms[1], 10) * 3600 + parseInt(hms[2], 10) * 60 + parseInt(hms[3], 10);
  } else if (typeof up === 'number') uptimeSec = Math.round(up);

  return {
    t: Date.now(),
    cpu: num(cpu.total ?? null),
    cpuCores: cores,
    gpu, gpuTemp,
    ram: num(mem.percent ?? null),
    ramUsedGB: mem.used != null ? Math.round((mem.used / 1073741824) * 10) / 10 : null,
    ramTotalGB: mem.total != null ? Math.round((mem.total / 1073741824) * 10) / 10 : null,
    swap: num(swap.percent ?? null),
    load1: num(load.min1 ?? null), load5: num(load.min5 ?? null),
    cput, ssdt,
    disks, adapters, mainAdapter,
    rx: main ? main.rx : null, tx: main ? main.tx : null,
    sensors, uptimeSec,
    via: 'api',
    // компактные значения для точки истории
    _point: {
      cpu: num(cpu.total ?? null), gpu, ram: num(mem.percent ?? null),
      rx: main ? main.rx : null, tx: main ? main.tx : null,
      cput, ssdt, diskUsed: mainFs ? mainFs.percent : null,
    },
  };
}

/** Опрос Glances: /api/4/all → /api/3/all. Возвращает снимок или null. */
async function pollGlances(baseUrl) {
  const base = String(baseUrl).replace(/\/+$/, '');
  for (const ver of [4, 3]) {
    try {
      const data = await fetchJson(`${base}/api/${ver}/all`);
      if (data && data.cpu) {
        const snap = parseGlancesAll(data);
        snap.via = 'api' + ver;
        return snap;
      }
    } catch { /* пробуем следующую версию API */ }
  }
  return null;
}

/** Дописать точку в историю агента со сжатием и чисткой >30 дней. */
function glancesAppend(a, point) {
  if (!Array.isArray(a.glances)) a.glances = [];
  const arr = a.glances;
  const last = arr[arr.length - 1];
  if (last) {
    const age = point.t - last.t;
    const sameMin = Math.floor(last.t / 60000) === Math.floor(point.t / 60000);
    const sameHour = Math.floor(last.t / 3600000) === Math.floor(point.t / 3600000);
    // сжатие: старше 7 дней — почасовые бакеты, старше суток — поминутные
    if ((age > 7 * 86400000 && sameHour) || (age > 86400000 && sameMin)) {
      for (const k of ['cpu', 'gpu', 'ram', 'rx', 'tx', 'cput', 'ssdt', 'diskUsed']) {
        if (point[k] == null) continue;
        last[k] = last[k] == null ? point[k] : Math.round(((last[k] + point[k]) / 2) * 10) / 10;
      }
      last.t = point.t;
      return;
    }
  }
  arr.push(point);
  if (arr.length > GLANCES_MAX_POINTS) arr.splice(0, arr.length - GLANCES_MAX_POINTS);
  const cutoff = point.t - GLANCES_RETENTION_MS;
  let i = 0;
  while (i < arr.length && arr[i].t < cutoff) i++;
  if (i > 0) arr.splice(0, i);
}

async function relayPing(agent, targets) {
  if (!agent.relayUrl) return [];
  const base = String(agent.relayUrl).replace(/\/+$/, '');
  const url = `${base}/ping?targets=${encodeURIComponent(targets.join(','))}`;
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(to);
    if (!res.ok) return [];
    const arr = await res.json();
    return Array.isArray(arr) ? arr.map((r) => ({ ip: r.ip, alive: !!r.alive, latency: r.latency ?? null })) : [];
  } catch { return []; }
}

async function pollAgent(a) {
  const now = Date.now();
  // 1) доступность самого ПК
  const self = await checkPing(a.ip, db.settings.timeoutMs || 3000);
  a.online = self.ok;
  a.latency = self.ok ? self.latency : null;
  a.lastPoll = now;
  if (self.ok) { a.onlineSince = a.onlineSince || now; a.lastSeen = now; }
  else { a.onlineSince = 0; }

  // 2) телеметрия Glances (свой интервал, хранение 30 дней)
  if (self.ok && a.glancesUrl) {
    const giv = Math.max(15, db.settings.intervals.glances || 60) * 1000;
    if (now - (a.lastGlances || 0) >= giv) {
      a.lastGlances = now;
      try {
        const snap = await pollGlances(a.glancesUrl);
        if (snap) {
          const { _point, ...rest } = snap;
          a.glancesLatest = rest;
          a.glancesError = null;
          glancesAppend(a, { t: snap.t, ..._point });
        } else {
          a.glancesError = 'Glances не ответил (проверьте «glances -w» и адрес)';
        }
      } catch (e) {
        a.glancesError = 'Glances: ' + (e.message || 'ошибка запроса');
      }
    }
  }

  // 3) пинг целей через relay (устройства, доступные только этому ПК)
  if (self.ok && a.relayUrl) {
    const targets = [];
    for (const tgt of a.pingTargets) {
      const ips = expandTargets(tgt);
      if (!ips.length) continue;
      const results = await relayPing(a, ips);
      targets.push({ target: tgt, lastCheck: Date.now(), results });
    }
    a.targets = targets;
  }
  saveDb();
}

// ─── Публичная витрина (отдельный порт, без авторизации) ────────────────────

function showcaseDevices() {
  return db.devices.filter((d) => d.showcase).map((d) => ({
    name: d.name, type: d.type, address: d.address,
    status: d.status, latency: d.latency ?? null, lastCheck: d.lastCheck || null,
  }));
}

const SHOWCASE_HTML = `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PLUTO — статус</title>
<style>
body{margin:0;background:#0b0e1a;color:#dfe3f5;font:15px/1.5 'IBM Plex Sans',system-ui,sans-serif}
.wrap{max-width:720px;margin:0 auto;padding:32px 20px}
h1{font-size:20px;letter-spacing:.2em;margin:0 0 4px;color:#8f7df0}
.sub{font-size:12px;color:#8b93b8;margin:0 0 24px}
.row{display:flex;align-items:center;gap:12px;padding:12px 16px;border:1px solid #242b4a;border-radius:10px;background:#12162a;margin-bottom:10px}
.dot{width:10px;height:10px;border-radius:50%;flex:none}
.up{background:#55c795;box-shadow:0 0 8px #55c79588}
.down{background:#e07a80;box-shadow:0 0 8px #e07a8088}
.degraded{background:#dfa65e;box-shadow:0 0 8px #dfa65e88}
.unknown{background:#8b93b8}
.name{font-weight:600;flex:1}
.type{font:11px monospace;color:#8b93b8;text-transform:uppercase}
.addr{font:12px monospace;color:#aeb6d8}
.lat{font:12px monospace;color:#5fc6d8;width:70px;text-align:right}
.empty{color:#8b93b8;text-align:center;padding:40px 0}
.upd{font:11px monospace;color:#8b93b8;text-align:right;margin-top:16px}
</style></head><body><div class="wrap">
<h1>PLUTO</h1><p class="sub">Публичный статус инфраструктуры</p>
<div id="list"><div class="empty">Загрузка…</div></div>
<div class="upd" id="upd"></div></div>
<script>
const STATUS={up:['В сети','up'],down:['Авария','down'],degraded:['Деградация','degraded'],unknown:['Ожидание','unknown']};
async function tick(){
  try{
    const r=await fetch('/api/showcase');const d=await r.json();
    const el=document.getElementById('list');
    if(!d.devices.length){el.innerHTML='<div class="empty">Нет устройств на витрине</div>';}
    else{el.innerHTML=d.devices.map(x=>{const[label,cls]=STATUS[x.status]||STATUS.unknown;
      return '<div class="row"><span class="dot '+cls+'"></span><span class="name">'+
      String(x.name).replace(/</g,'&lt;')+'</span><span class="type">'+x.type+'</span>'+
      '<span class="addr">'+String(x.address).replace(/</g,'&lt;')+'</span>'+
      '<span class="lat">'+(x.latency==null?'—':x.latency+' мс')+'</span></div>';}).join('');}
    document.getElementById('upd').textContent='обновлено '+new Date().toLocaleTimeString('ru-RU');
  }catch(e){}
}
tick();setInterval(tick,10000);
</script></body></html>`;

let showcaseServer = null;
function startShowcase() {
  stopShowcase();
  // Порт витрины: переменная окружения (из docker-compose / .env) — единая точка
  // конфигурации, т.к. проброс порта в контейнере фиксирован. Если не задана —
  // берём значение из настроек (по умолчанию 8081).
  const port = parseInt(process.env.SHOWCASE_PORT, 10) || db.settings.showcase.port || 8081;
  showcaseServer = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname === '/api/showcase') {
      return json(res, 200, { devices: showcaseDevices() });
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return text(res, 200, SHOWCASE_HTML, 'text/html; charset=utf-8');
    }
    return text(res, 404, 'not found');
  });
  showcaseServer.on('error', (e) => console.error(`[pluto] витрина: порт ${port} —`, e.message));
  showcaseServer.listen(port, () => console.log(`[pluto] витрина (публичная, без входа): http://0.0.0.0:${port}`));
}
function stopShowcase() {
  if (showcaseServer) { try { showcaseServer.close(); } catch {} showcaseServer = null; }
}

// ─── Планировщик ────────────────────────────────────────────────────────────
// Ограничение параллельных проверок: при тысячах устройств иначе одновременно
// стартуют сотни процессов ping, ядро захлёбывается и интерфейс перестаёт отвечать.

const MAX_CONCURRENT_CHECKS = 24;
let activeChecks = 0;

function scheduleDeviceCheck(d) {
  if (activeChecks >= MAX_CONCURRENT_CHECKS) return; // допроверим на следующем тике
  activeChecks++;
  d.checking = true;
  runDeviceCheck(d)
    .then((r) => applyDeviceResult(d, r))
    .catch(() => {})
    .finally(() => { d.checking = false; activeChecks--; });
}

// Стартуем проверки постепенно, а не все сразу: устройства со сроком опроса
// размазываются по первым тикам (fair-очередь по давности последней проверки).
setInterval(() => {
  const now = Date.now();
  if (activeChecks < MAX_CONCURRENT_CHECKS) {
    const due = [];
    for (const d of db.devices) {
      const iv = Math.max(5, d.interval || db.settings.intervals[d.type] || 60) * 1000;
      if (!d.checking && now - (d.lastCheck || 0) >= iv) due.push(d);
    }
    due.sort((x, y) => (x.lastCheck || 0) - (y.lastCheck || 0));
    for (const d of due) {
      if (activeChecks >= MAX_CONCURRENT_CHECKS) break;
      scheduleDeviceCheck(d);
    }
  }
  const aiv = Math.max(10, db.settings.intervals.agent || 30) * 1000;
  for (const a of db.agents) {
    if (!a._polling && now - (a.lastPoll || 0) >= aiv) {
      a._polling = true;
      pollAgent(a).catch(() => {}).finally(() => { a._polling = false; });
    }
  }
}, 1000);

// ─── HTTP-сервер консоли и API ──────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;
  const method = req.method || 'GET';

  try {
    // ── публичные маршруты ──
    if (p === '/api/health') return json(res, 200, { ok: true, name: 'pluto-core', version: VERSION });
    if (p === '/api/version') return json(res, 200, { version: VERSION });

    // ── статика консоли (до авторизации) ──
    if (method === 'GET' && !p.startsWith('/api/')) {
      let file = path.normalize(path.join(WEB_DIR, p === '/' ? 'index.html' : p));
      if (!file.startsWith(WEB_DIR)) return json(res, 403, { error: 'forbidden' });
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(WEB_DIR, 'index.html');
      if (!fs.existsSync(file)) return text(res, 200, 'PLUTO Core работает. Веб-консоль не найдена: пересоберите образ.');
      const ext = path.extname(file).toLowerCase();
      if (ext === '.html' || !ext) {
        const html = fs.readFileSync(file, 'utf8').replace('<head>', `<head><script>window.__PLUTO_CORE__={v:"${VERSION}"}</script>`);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
        return res.end(html);
      }
      // Браузеры жёстко проверяют MIME для модульных скриптов: JS с
      // «application/octet-stream» отклоняется, и интерфейс остаётся пустым.
      const MIME = {
        '.js': 'application/javascript; charset=utf-8',
        '.mjs': 'application/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.ico': 'image/x-icon',
        '.webmanifest': 'application/manifest+json; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.map': 'application/json; charset=utf-8',
        '.woff': 'font/woff',
        '.woff2': 'font/woff2',
        '.txt': 'text/plain; charset=utf-8',
        '.wasm': 'application/wasm',
      };
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        // хэшированные ассеты Vite можно кэшировать надолго, остальное — нет
        'Cache-Control': /^\/assets\//.test(p) ? 'public, max-age=31536000, immutable' : 'no-cache',
      });
      return fs.createReadStream(file).pipe(res);
    }

    // ── авторизация ──
    if (p === '/api/auth/login' && method === 'POST') {
      const b = await readBody(req);
      const u = db.users.find((x) => x.login === String(b.login || '').trim());
      if (!u || !verifyPass(String(b.password || ''), u.passHash)) return json(res, 401, { error: 'Неверный логин или пароль' });
      pushEvent('info', 'system', `Вход в систему: ${u.name}`);
      return json(res, 200, { token: issueSession(u.id), user: publicUser(u) });
    }

    const user = authUser(req);
    if (!user) return json(res, 401, { error: 'Требуется авторизация' });
    const isAdmin = user.role === 'admin';

    if (p === '/api/auth/me') return json(res, 200, publicUser(user));

    // ── состояние ──
    if (p === '/api/state' && method === 'GET') {
      const vis = isAdmin ? db.devices : db.devices.filter((d) => user.scope.includes(d.type));
      // лёгкая проекция: историю режем до 16 точек (хватает для спарклайнов),
      // тяжёлые поля не отдаём — иначе при тысячах устройств каждый поллинг
      // гоняет мегабайты JSON и интерфейс тормозит
      const devices = vis.map((d) => ({
        id: d.id, name: d.name, type: d.type, address: d.address, port: d.port ?? null,
        path: d.path || '', method: d.method ?? null, body: d.type === 'api' ? d.body ?? null : null,
        interval: d.interval, tags: d.tags, favorite: d.favorite, showcase: !!d.showcase,
        status: d.status, latency: d.latency ?? null, fails: d.fails || 0,
        lastCheck: d.lastCheck || 0, lastChange: d.lastChange || 0, checking: !!d.checking,
        history: (d.history || []).slice(-16),
      }));
      const agentsRaw = isAdmin || user.scope.includes('agent') ? db.agents : [];
      const agents = agentsRaw.map((a) => ({
        id: a.id, name: a.name, ip: a.ip, relayUrl: a.relayUrl || '', glancesUrl: a.glancesUrl || '',
        pingTargets: a.pingTargets || [], targets: a.targets || [], favorite: !!a.favorite,
        online: !!a.online, latency: a.latency ?? null,
        onlineSince: a.onlineSince || 0, lastSeen: a.lastSeen || 0, lastPoll: a.lastPoll || 0,
        lastGlances: a.lastGlances || 0, glancesError: a.glancesError || null,
        glancesLatest: a.glancesLatest || null,
        glances: (a.glances || []).slice(-120), // хвост для мини-графиков; полная история — /glances
        latHist: (a.latHist || []).slice(-120), createdAt: a.createdAt,
      }));
      return json(res, 200, {
        devices, agents, tags: db.tags, events: (db.events || []).slice(0, 100), settings: db.settings,
        users: isAdmin ? db.users.map(publicUser) : undefined,
      });
    }

    // ── устройства ──
    if (p === '/api/devices' && method === 'POST' && isAdmin) {
      const b = await readBody(req);
      if (!b.address) return json(res, 400, { error: 'укажите адрес устройства' });
      const d = {
        id: uid(), name: String(b.name || '').trim() || String(b.address),
        type: ['ping', 'http', 'api', 'rtsp', 'sip'].includes(b.type) ? b.type : 'ping',
        address: String(b.address).trim(), port: b.port != null ? parseInt(b.port, 10) : null,
        path: String(b.path || ''), method: b.method || null, body: b.body || null,
        interval: Math.max(5, parseInt(b.interval, 10) || db.settings.intervals[b.type] || 60),
        tags: Array.isArray(b.tags) ? b.tags : [], favorite: !!b.favorite, showcase: !!b.showcase,
        status: 'unknown', latency: null, history: [], fails: 0,
        lastCheck: 0, lastChange: Date.now(), checking: false, approx: false, createdAt: Date.now(),
      };
      db.devices.push(d);
      pushEvent('info', 'device', `Добавлено устройство «${d.name}» (${d.type.toUpperCase()} ${d.address})`);
      saveDb();
      runDeviceCheck(d).then((r) => applyDeviceResult(d, r));
      return json(res, 200, d);
    }
    let m = p.match(/^\/api\/devices\/([^/]+)$/);
    if (m && isAdmin) {
      const d = db.devices.find((x) => x.id === m[1]);
      if (!d) return json(res, 404, { error: 'устройство не найдено' });
      if (method === 'PUT' || method === 'PATCH') {
        const b = await readBody(req);
        for (const k of ['name', 'type', 'address', 'port', 'path', 'method', 'body', 'interval', 'tags', 'favorite', 'showcase']) if (k in b) d[k] = b[k];
        saveDb();
        return json(res, 200, d);
      }
      if (method === 'DELETE') {
        db.devices = db.devices.filter((x) => x.id !== d.id);
        pushEvent('info', 'device', `Устройство «${d.name}» удалено`);
        saveDb();
        return json(res, 200, { ok: true });
      }
    }
    m = p.match(/^\/api\/devices\/([^/]+)\/check$/);
    if (m && method === 'POST' && isAdmin) {
      const d = db.devices.find((x) => x.id === m[1]);
      if (!d) return json(res, 404, { error: 'устройство не найдено' });
      const r = await runDeviceCheck(d);
      applyDeviceResult(d, r);
      return json(res, 200, { ok: r.ok, latency: r.latency });
    }

    // ── агенты (relay) ──
    if (p === '/api/agents' && method === 'POST' && isAdmin) {
      const b = await readBody(req);
      const ip = String(b.ip || '').trim();
      if (!ip) return json(res, 400, { error: 'укажите IP-адрес ПК' });
      const a = {
        id: uid(), name: String(b.name || '').trim() || ('ПК ' + ip), ip,
        relayUrl: String(b.relayUrl || '').trim(),
        glancesUrl: String(b.glancesUrl || '').trim(),
        pingTargets: Array.isArray(b.pingTargets) ? b.pingTargets.map(String) : [],
        targets: [], favorite: !!b.favorite, online: false, latency: null,
        onlineSince: 0, lastSeen: 0, lastPoll: 0, lastGlances: 0,
        latHist: [], glances: [], glancesLatest: null, glancesError: null, createdAt: Date.now(),
      };
      db.agents.push(a);
      pushEvent('info', 'agent', `Добавлен агент «${a.name}» (${a.ip})`);
      saveDb();
      pollAgent(a);
      return json(res, 200, a);
    }
    m = p.match(/^\/api\/agents\/([^/]+)$/);
    if (m && isAdmin) {
      const a = db.agents.find((x) => x.id === m[1]);
      if (!a) return json(res, 404, { error: 'агент не найден' });
      if (method === 'PUT' || method === 'PATCH') {
        const b = await readBody(req);
        for (const k of ['name', 'ip', 'relayUrl', 'glancesUrl', 'favorite']) if (k in b) a[k] = b[k];
        if (Array.isArray(b.pingTargets)) a.pingTargets = b.pingTargets.map(String);
        saveDb();
        return json(res, 200, a);
      }
      if (method === 'DELETE') {
        db.agents = db.agents.filter((x) => x.id !== a.id);
        pushEvent('info', 'agent', `Агент «${a.name}» удалён`);
        saveDb();
        return json(res, 200, { ok: true });
      }
    }
    m = p.match(/^\/api\/agents\/([^/]+)\/poll$/);
    if (m && method === 'POST' && isAdmin) {
      const a = db.agents.find((x) => x.id === m[1]);
      if (!a) return json(res, 404, { error: 'агент не найден' });
      await pollAgent(a);
      return json(res, 200, a);
    }
    // Ручной relay-пинг произвольных целей через агента
    m = p.match(/^\/api\/agents\/([^/]+)\/relay-ping$/);
    if (m && method === 'GET' && isAdmin) {
      const a = db.agents.find((x) => x.id === m[1]);
      if (!a) return json(res, 404, { error: 'агент не найден' });
      const targets = String(url.searchParams.get('targets') || '').split(/[,\s]+/).filter(Boolean);
      const ips = targets.flatMap(expandTargets);
      if (!ips.length) return json(res, 400, { error: 'нет корректных целей' });
      const results = await relayPing(a, ips);
      return json(res, 200, results);
    }
    // История Glances за период (журнал статистики)
    m = p.match(/^\/api\/agents\/([^/]+)\/glances$/);
    if (m && method === 'GET') {
      const a = db.agents.find((x) => x.id === m[1]);
      if (!a) return json(res, 404, { error: 'агент не найден' });
      if (!isAdmin && !user.scope.includes('agent')) return json(res, 403, { error: 'нет доступа к агентам' });
      const ranges = { '5m': 3e5, '30m': 18e5, '3h': 108e5, '24h': 864e5, '7d': 6048e5, '30d': 2592e6 };
      const rq = url.searchParams.get('range');
      const range = ranges[rq] ? rq : '3h';
      const cutoff = Date.now() - ranges[range];
      let pts = (a.glances || []).filter((x) => x.t >= cutoff);
      if (pts.length > 1200) { // прореживаем до ≤1200 точек
        const bw = ranges[range] / 1200;
        const out = [];
        let cur = null, bi = -1;
        for (const pt of pts) {
          const idx = Math.floor((pt.t - cutoff) / bw);
          if (idx !== bi) { if (cur) out.push(cur); cur = { ...pt }; bi = idx; }
          else {
            for (const k of ['cpu', 'gpu', 'ram', 'rx', 'tx', 'cput', 'ssdt', 'diskUsed']) {
              if (pt[k] == null) continue;
              cur[k] = cur[k] == null ? pt[k] : Math.round(((cur[k] + pt[k]) / 2) * 10) / 10;
            }
            cur.t = pt.t;
          }
        }
        if (cur) out.push(cur);
        pts = out;
      }
      return json(res, 200, { range, retentionDays: 30, points: pts });
    }

    // ── витрина: настройки ──
    if (p === '/api/showcase/restart' && method === 'POST' && isAdmin) {
      startShowcase();
      return json(res, 200, { ok: true, port: db.settings.showcase.port });
    }

    // ── настройки ──
    if (p === '/api/settings' && method === 'PUT' && isAdmin) {
      const b = await readBody(req);
      const prevPort = db.settings.showcase.port;
      db.settings = { ...db.settings, ...b };
      saveDb();
      if (db.settings.showcase.port !== prevPort) startShowcase();
      pushEvent('info', 'system', 'Системные настройки сохранены');
      return json(res, 200, db.settings);
    }

    return json(res, 404, { error: 'Маршрут не найден' });
  } catch (e) {
    console.error('[pluto] ошибка запроса:', e);
    return json(res, 500, { error: 'внутренняя ошибка' });
  }
});

server.listen(HTTP_PORT, () => {
  console.log(`[pluto] core v${VERSION} · консоль и API: http://0.0.0.0:${HTTP_PORT} · health: /api/health`);
});
startShowcase();
