// ─── PLUTO Core v1.10: REST API + движок опроса + шлюз агентов ──────────────
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import dgram from 'node:dgram';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import {
  loadDb, saveDb, uid, pushEvent, hashPass, verifyPass, issueSession, authUser, attachWs,
} from './lib.js';

const VERSION = '1.11.0';
const HTTP_PORT = parseInt(process.env.HTTP_PORT || '8080', 10);
const AGENT_PORT = parseInt(process.env.AGENT_PORT || '8443', 10);
// Зеркало-ретранслятор: PLUTO_MIRROR=1 запускает экземпляр в режиме «витрина»
// (read-only, не опрашивает ничего), MIRROR_SECRET защищает приём снапшотов.
const IS_MIRROR = process.env.PLUTO_MIRROR === '1';
const MIRROR_SECRET = (process.env.MIRROR_SECRET || '').trim();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(__dirname, '..', 'web');

const db = loadDb();

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}
function text(res, code, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); }
    });
  });
}
const publicUser = (u) => ({ id: u.id, name: u.name, login: u.login, role: u.role, scope: u.scope, builtIn: u.builtIn, createdAt: u.createdAt });

// ─── HTTP-клиент с абсолютным таймаутом ─────────────────────────────────────

function fetchText(rawUrl, timeoutMs = 7000) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(rawUrl); } catch { return reject(new Error('некорректный адрес')); }
    const lib = u.protocol === 'https:' ? https : http;
    let done = false;
    const r = lib.get(u, {
      timeout: timeoutMs,
      headers: { 'User-Agent': 'pluto-core', 'Accept': '*/*', 'Connection': 'close' },
    }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return fetchText(new URL(res.headers.location, u).toString(), timeoutMs).then(finish(resolve), finish(reject));
      }
      if (res.statusCode !== 200) { res.resume(); return finish(reject)(new Error(`HTTP ${res.statusCode}`)); }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (data += c));
      res.on('end', () => finish(resolve)(data));
    });
    const kill = setTimeout(() => { if (!done) r.destroy(new Error(`таймаут запроса (${timeoutMs} мс)`)); }, timeoutMs);
    function finish(fn) {
      return (v) => { if (done) return; done = true; clearTimeout(kill); fn(v); };
    }
    r.on('timeout', () => r.destroy(new Error('таймаут соединения')));
    r.on('error', (e) => finish(reject)(e));
  });
}

const isLoopbackUrl = (u) => /^https?:\/\/(127\.|localhost|0\.0\.0\.0|\[::1?\])/i.test(String(u || '').trim());

/** Чтение страницы напрямую или через relay (для loopback-адресов). */
async function fetchListing(url, relayUrl) {
  const target = String(url || '').trim();
  if (!target) throw new Error('не задан адрес источника');
  if (isLoopbackUrl(target)) {
    if (!relayUrl) throw new Error(`адрес ${target} локальный — сервер не может открыть его из контейнера. Укажите LAN-IP машины или настройте relay (aida-monitor)`);
    const base = String(relayUrl).replace(/\/+$/, '');
    try {
      const html = await fetchText(base + '/fetch?url=' + encodeURIComponent(target), 15000);
      return { html, via: 'relay' };
    } catch (e) {
      throw new Error('loopback-адрес, relay не ответил: ' + (e.message || e));
    }
  }
  const html = await fetchText(target, 7000);
  return { html, via: 'direct' };
}

// ─── Хранение рядов с ярусным сжатием ───────────────────────────────────────

function mergePoints(dst, src) {
  for (const k of Object.keys(src)) {
    if (k === 't') continue;
    const v = src[k];
    if (typeof v !== 'number' || !isFinite(v)) continue;
    dst[k] = dst[k] == null ? v : Math.round(((dst[k] + v) / 2) * 10) / 10;
  }
  dst.t = src.t;
}

/** < 24 ч — как есть; 24 ч–7 дн — минутные бакеты; > 7 дн — часовые. */
function compactSeries(arr, now) {
  const d1 = now - 86400000;
  const d7 = now - 7 * 86400000;
  const raw = [];
  const byMin = new Map();
  const byHour = new Map();
  for (const pt of arr) {
    if (pt.t >= d1) raw.push(pt);
    else if (pt.t >= d7) {
      const k = Math.floor(pt.t / 60000);
      const ex = byMin.get(k);
      if (ex) mergePoints(ex, pt);
      else byMin.set(k, { ...pt });
    } else {
      const k = Math.floor(pt.t / 3600000);
      const ex = byHour.get(k);
      if (ex) mergePoints(ex, pt);
      else byHour.set(k, { ...pt });
    }
  }
  const out = [...byHour.values(), ...byMin.values(), ...raw];
  out.sort((a, b) => a.t - b.t);
  return out;
}

const MAX_POINTS = 20000;
const GLANCES_RETENTION_MS = 30 * 86400000; // 30 дней

function seriesAppend(agent, key, pt, retentionMs) {
  if (!Array.isArray(agent[key])) agent[key] = [];
  const arr = agent[key];
  arr.push(pt);
  if (arr.length > MAX_POINTS) agent[key] = compactSeries(arr, pt.t);
  const cutoff = pt.t - retentionMs;
  let i = 0;
  while (i < agent[key].length && agent[key][i].t < cutoff) i++;
  if (i > 0) agent[key].splice(0, i);
}

const GLANCES_RANGE_MS = {
  '5m': 5 * 60000, '30m': 30 * 60000, '3h': 3 * 3600000, '24h': 24 * 3600000,
  '7d': 7 * 86400000, '30d': 30 * 86400000,
};

function rangePoints(arr, rangeMs, range) {
  const cutoff = Date.now() - rangeMs;
  let pts = (arr || []).filter((x) => x.t >= cutoff);
  if (pts.length > 1500) {
    const bw = rangeMs / 1500;
    const out = [];
    let cur = null, bi = -1;
    for (const pt of pts) {
      const idx = Math.floor((pt.t - cutoff) / bw);
      if (idx !== bi) { if (cur) out.push(cur); cur = { ...pt }; bi = idx; }
      else mergePoints(cur, pt);
    }
    if (cur) out.push(cur);
    pts = out;
  }
  return { range, retentionDays: Math.round(rangeMs / 86400000) || 30, points: pts };
}

// ─── Парсер Glances (столбцы CPU/MEM/Rx/Tx/Package) ─────────────────────────

const GLANCES_KEYS = ['cpu', 'user', 'system', 'iowait', 'idle', 'irq', 'nice', 'steal', 'mem', 'memTotal', 'memUsed', 'memFree', 'rx', 'tx', 'pkg', 'diskCount', 'diskUsed'];

function htmlToText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&deg;/gi, '°')
    .replace(/&amp;/gi, '&')
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(+c))
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');
}

function gSection(t, startRe, endRe) {
  const s = t.search(startRe);
  if (s < 0) return '';
  const rest = t.slice(s);
  const e = rest.slice(1).search(endRe);
  return e < 0 ? rest : rest.slice(0, e + 1);
}
const gNum = (s, re) => { const m = s.match(re); return m ? parseFloat(m[1]) : null; };

function gValGB(s, label) {
  const m = s.match(new RegExp(label + ':?\\s*([0-9]+(?:\\.[0-9]+)?)\\s*([KMGT])?', 'i'));
  if (!m) return null;
  const v = parseFloat(m[1]);
  const u = (m[2] || 'G').toUpperCase();
  if (u === 'T') return Math.round(v * 1024 * 100) / 100;
  if (u === 'G') return v;
  if (u === 'M') return Math.round((v / 1024) * 100) / 100;
  return Math.round((v / (1024 * 1024)) * 100) / 100;
}

function gNetKB(t, label) {
  const re = new RegExp(label + '/s:?\\s*([0-9]+(?:\\.[0-9]+)?)\\s*([KMGT])?', 'gi');
  let sum = 0, n = 0, m;
  while ((m = re.exec(t))) {
    const v = parseFloat(m[1]);
    const u = (m[2] || '').toUpperCase();
    const mult = u === 'T' ? 1e12 : u === 'G' ? 1e9 : u === 'M' ? 1e6 : u === 'K' ? 1e3 : 1;
    sum += (v * mult) / 1024;
    n++;
  }
  return n ? Math.round(sum * 10) / 10 : null;
}

function parseGlances(html) {
  const t = htmlToText(html);
  const cpuS = gSection(t, /\bCPU\b/i, /\b(MEM|LOAD|PERCPU|SWAP)\b/i);
  const memS = gSection(t, /\bMEM\b/i, /\b(SWAP|LOAD|NETWORK|DISK|SENSORS|PROCESSES)\b/i);
  return {
    cpu: gNum(cpuS, /\bCPU\s+([0-9]+(?:\.[0-9]+)?)\s*%/i),
    user: gNum(cpuS, /user:?\s*([0-9]+(?:\.[0-9]+)?)\s*%/i),
    system: gNum(cpuS, /system:?\s*([0-9]+(?:\.[0-9]+)?)\s*%/i),
    iowait: gNum(cpuS, /iowait:?\s*([0-9]+(?:\.[0-9]+)?)\s*%/i),
    idle: gNum(cpuS, /idle:?\s*([0-9]+(?:\.[0-9]+)?)\s*%/i),
    irq: gNum(cpuS, /irq:?\s*([0-9]+(?:\.[0-9]+)?)\s*%/i),
    nice: gNum(cpuS, /nice:?\s*([0-9]+(?:\.[0-9]+)?)\s*%/i),
    steal: gNum(cpuS, /steal:?\s*([0-9]+(?:\.[0-9]+)?)\s*%/i),
    mem: gNum(memS, /\bMEM\s+([0-9]+(?:\.[0-9]+)?)\s*%/i),
    memTotal: gValGB(memS, 'total'),
    memUsed: gValGB(memS, 'used'),
    memFree: gValGB(memS, 'free'),
    rx: gNetKB(t, 'Rx'),
    tx: gNetKB(t, 'Tx'),
    pkg: gNum(t, /Package[^0-9°]{0,24}?([0-9]+(?:\.[0-9]+)?)\s*°?\s*C/i),
    diskCount: null,
    diskUsed: null,
  };
}

/**
 * Сбор Glances через REST API — надёжный способ: веб-страница Glances — это SPA,
 * значения в сыром HTML отсутствуют, но тот же порт отдаёт JSON:
 *   /api/4/all (Glances 4.x) и /api/3/all (Glances 3.x).
 * Разбор HTML (parseGlances) оставлен как запасной вариант для очень старых версий.
 */
const GB = 1024 ** 3;
const n2 = (v) => (typeof v === 'number' && isFinite(v) ? Math.round(v * 100) / 100 : null);

/** Виртуальные интерфейсы, которые НЕ являются реальным адаптером (VM, контейнеры, туннели). */
const VIRT_NET = /^(lo|loopback|veth|virbr|docker|br[-\d]|vboxnet|vmnet|vnet|venet|tap|tun|bond|team|wsl|bluetooth|isatap|teredo|pseudo|any|virtual|hyper-v|vethernet|vmware|virtualbox|local area connection\s*\*)/i;

function glancesFromApi(data) {
  const pt = {
    cpu: null, user: null, system: null, iowait: null, idle: null, irq: null, nice: null, steal: null,
    mem: null, memTotal: null, memUsed: null, memFree: null, rx: null, tx: null, pkg: null,
    diskCount: null, diskUsed: null,
  };
  const cpu = data && data.cpu;
  if (cpu && typeof cpu === 'object') {
    pt.cpu = n2(cpu.total);
    pt.user = n2(cpu.user);
    pt.system = n2(cpu.system);
    pt.iowait = n2(cpu.iowait);
    pt.idle = n2(cpu.idle);
    pt.irq = n2(cpu.irq);
    pt.nice = n2(cpu.nice);
    pt.steal = n2(cpu.steal);
  }
  const mem = data && data.mem;
  if (mem && typeof mem === 'object') {
    pt.mem = n2(mem.percent);
    pt.memTotal = n2((mem.total || 0) / GB);
    pt.memUsed = n2((mem.used || 0) / GB);
    pt.memFree = n2((mem.free || 0) / GB);
  }

  // ── FILE SYS (плагин fs): количество ФС и заполненность основной ──
  let disks = [];
  const fs = data && data.fs;
  if (Array.isArray(fs)) {
    disks = fs
      .filter((f) => f && typeof f.percent === 'number')
      .map((f) => ({
        mnt: String(f.mnt_point || f.device_name || '?'),
        percent: n2(f.percent),
        usedGB: n2((f.used || 0) / GB),
        sizeGB: n2((f.size || 0) / GB),
      }));
    if (disks.length) {
      pt.diskCount = disks.length;
      const root = disks.find((d) => d.mnt === '/' || d.mnt === '\\')
        || disks.find((d) => /^[A-Za-z]:[\\/]?$/.test(d.mnt)) // Windows: диск C:
        || disks[0];
      pt.diskUsed = root.percent;
    }
  }

  // ── NETWORK: реальный адаптер, не виртуальный ──
  // Из физических (после отсева виртуальных) берём самый нагруженный —
  // через него, как правило, идёт аплинк. Если всё отфильтровалось —
  // берём лучший из всех, чтобы не терять данные.
  let netIface = null;
  const net = data && data.network;
  if (Array.isArray(net) && net.length) {
    const phys = net.filter((i) => i && i.interface_name && !VIRT_NET.test(String(i.interface_name)));
    const cand = phys.length ? phys : net;
    let best = null;
    let bestT = -1;
    for (const itf of cand) {
      const t = (typeof itf.rx === 'number' ? itf.rx : 0) + (typeof itf.tx === 'number' ? itf.tx : 0);
      if (t > bestT) { best = itf; bestT = t; }
    }
    if (best) {
      netIface = String(best.interface_name);
      pt.rx = n2((best.rx || 0) / 1024); // байт/с → КБ/с
      pt.tx = n2((best.tx || 0) / 1024);
    }
  }

  // ── SENSORS: все датчики (t°C, RPM) + температура Package ──
  let sensorsList = [];
  const sensors = data && data.sensors;
  if (Array.isArray(sensors)) {
    sensorsList = sensors
      .filter((s) => s && typeof s.value === 'number')
      .map((s) => ({ label: String(s.label || '?'), unit: String(s.unit || ''), value: n2(s.value) }));
    const pkg = sensors.find((s) => s && /package/i.test(String(s.label || '')) && s.unit === 'C')
      || sensors.find((s) => s && /package/i.test(String(s.label || '')));
    if (pkg && typeof pkg.value === 'number') pt.pkg = n2(pkg.value);
    else {
      const anyTemp = sensors.find((s) => s && s.unit === 'C' && typeof s.value === 'number');
      if (anyTemp) pt.pkg = n2(anyTemp.value); // нет package — берём первый температурный датчик
    }
  }

  // ── PER-CPU: загрузка каждого ядра ──
  let cores = [];
  const percpu = data && data.percpu;
  if (Array.isArray(percpu)) cores = percpu.map((c) => n2(c && c.total)).filter((v) => v != null);

  return { pt, disks, netIface, sensors: sensorsList, cores };
}

/** Возвращает { pt, source: 'api4'|'api3'|'html', via } или бросает ошибку с причиной. */
async function collectGlances(rawUrl, relayUrl) {
  const base = String(rawUrl || '').trim().replace(/\/+$/, '');
  if (!base) throw new Error('не задан адрес Glances');

  for (const ver of [4, 3]) {
    const apiUrl = `${base}/api/${ver}/all`;
    try {
      const txt = await fetchListing(apiUrl, relayUrl).then((r) => r.html);
      if (!txt || txt.trim().startsWith('<')) continue; // это HTML, а не JSON — пробуем другую версию
      const data = JSON.parse(txt);
      const { pt, disks, netIface, sensors, cores } = glancesFromApi(data);
      if (GLANCES_KEYS.some((k) => pt[k] != null)) {
        return { pt, disks, netIface, sensors, cores, source: ver === 4 ? 'api4' : 'api3', via: 'direct' };
      }
    } catch { /* версия API недоступна — пробуем следующую */ }
  }

  // запасной вариант: разбор HTML (старый Glances без REST API)
  const { html } = await fetchListing(base, relayUrl);
  const pt = parseGlances(html);
  if (GLANCES_KEYS.some((k) => pt[k] != null)) return { pt, disks: [], netIface: null, sensors: [], cores: [], source: 'html', via: 'direct' };

  throw new Error('Glances отвечает, но данные не получены: REST API (/api/4/all и /api/3/all) и HTML-разбор не дали показателей. Проверьте, что это именно Glances (glances -w)');
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
    const opts = { method: method || 'GET', signal: AbortSignal.timeout(timeoutMs) };
    if (body && method !== 'GET') opts.body = body;
    const res = await fetch(url, opts);
    return { ok: res.status < 500, latency: Math.max(1, Date.now() - t0) };
  } catch { return { ok: false, latency: 0 }; }
}

function checkRtsp(addr, port, timeoutMs) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const host = addr.replace(/^rtsp:\/\//i, '').split('/')[0].split(':')[0];
    const p = port || 554;
    const sock = net.connect(p, host, () => {
      sock.write(`OPTIONS rtsp://${host}:${p}/ RTSP/1.0\r\nCSeq: 1\r\n\r\n`);
    });
    const done = (ok) => { clearTimeout(to); sock.destroy(); resolve({ ok, latency: ok ? Math.max(1, Date.now() - t0) : 0 }); };
    const to = setTimeout(() => done(false), timeoutMs);
    sock.on('data', (d) => done(/RTSP\/1\.0\s+200/.test(String(d))));
    sock.on('error', () => done(false));
  });
}

function checkSip(addr, timeoutMs) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const m = /^sip:([^@]+)@([^:;]+)(?::(\d+))?/.exec(addr);
    if (!m) return resolve({ ok: false, latency: 0 });
    const host = m[2];
    const p = parseInt(m[3] || '5060', 10);
    const sock = dgram.createSocket('udp4');
    const req = `OPTIONS sip:${m[1]}@${host}:${p} SIP/2.0\r\nVia: SIP/2.0/UDP pluto.local\r\nFrom: <sip:pluto@pluto.local>\r\nTo: <sip:${m[1]}@${host}>\r\nCall-ID: ${uid()}@pluto\r\nCSeq: 1 OPTIONS\r\nContact: <sip:pluto@pluto.local>\r\nContent-Length: 0\r\n\r\n`;
    const done = (ok) => { clearTimeout(to); try { sock.close(); } catch { /* ignore */ } resolve({ ok, latency: ok ? Math.max(1, Date.now() - t0) : 0 }); };
    const to = setTimeout(() => done(false), timeoutMs);
    sock.on('message', (msg) => done(/SIP\/2\.0\s+200/.test(String(msg))));
    sock.on('error', () => done(false));
    sock.send(req, p, host, (e) => { if (e) done(false); });
  });
}

async function runDeviceCheck(d) {
  const tm = db.settings.timeoutMs || 3000;
  if (d.type === 'ping') return checkPing(d.address, tm);
  if (d.type === 'rtsp') return checkRtsp(d.address, d.port, tm);
  if (d.type === 'sip') return checkSip(d.address, tm);
  return checkHttp(d.address, d.port, d.path, d.method, d.body, tm);
}

function applyDeviceResult(d, r) {
  const cfg = db.settings;
  d.history = [...(d.history || []), r.ok ? r.latency : -1].slice(-48);
  d.lastCheck = Date.now();
  if (!r.ok) {
    d.fails = (d.fails || 0) + 1;
    if (d.fails >= cfg.failThreshold && d.status !== 'down') {
      d.status = 'down'; d.latency = null; d.lastChange = Date.now();
      pushEvent('crit', 'device', `${d.type.toUpperCase()} ${d.address} — потеря связи (${d.fails} сб. подряд)`);
    }
    return;
  }
  const base = d.baseline || r.latency;
  const degraded = r.latency > base * cfg.degradeFactor && r.latency > cfg.degradeMinMs;
  const st = degraded ? 'degraded' : 'up';
  if (d.status === 'down') pushEvent('ok', 'device', `${d.name} (${d.address}) — связь восстановлена`);
  else if (degraded && d.status !== 'degraded') pushEvent('warn', 'device', `${d.name}: деградация — ${r.latency} мс при базовых ${Math.round(base)} мс`);
  d.status = st; d.fails = 0; d.latency = r.latency;
  d.baseline = Math.round(base * 0.9 + r.latency * 0.1);
  if (st !== d.status) d.lastChange = Date.now();
  saveDb();
}

// ─── Relay: пинги внутри VLAN агента ────────────────────────────────────────

function expandIps(target) {
  const t = String(target).trim();
  if (!t) return [];
  const range = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.)(\d{1,3})\s*-\s*(\d{1,3})$/.exec(t);
  if (range) {
    const out = [];
    const a = parseInt(range[2], 10), b = parseInt(range[3], 10);
    for (let i = Math.min(a, b); i <= Math.max(a, b) && out.length < 256; i++) out.push(range[1] + i);
    return out;
  }
  const cidr = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.)\d{1,3}\/(\d{1,2})$/.exec(t);
  if (cidr) {
    if (parseInt(cidr[2], 10) < 24) return [];
    const out = [];
    for (let i = 1; i < 255; i++) out.push(cidr[1] + i);
    return out;
  }
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(t) ? [t] : [];
}

async function relayPing(agent, ips) {
  if (!agent.relayUrl || !ips.length) return [];
  const base = String(agent.relayUrl).replace(/\/+$/, '');
  try {
    const txt = await fetchText(base + '/ping?targets=' + encodeURIComponent(ips.join(',')), 15000);
    const arr = JSON.parse(txt);
    if (Array.isArray(arr)) {
      return arr.map((r) => ({ ip: r.ip, alive: !!r.alive, latency: r.latencyMs != null ? r.latencyMs : (r.latency != null ? r.latency : null) }));
    }
  } catch { /* relay недоступен */ }
  return [];
}

// ─── Опрос агента ───────────────────────────────────────────────────────────

async function pollAgent(agent, force) {
  const now = Date.now();

  // 1) пинг до IP — доступность / uptime
  const ping = await checkPing(agent.ip, db.settings.timeoutMs || 3000);
  const wasOnline = agent.online;
  agent.online = ping.ok;
  agent.latency = ping.ok ? ping.latency : null;
  agent.lastPoll = now;
  if (!Array.isArray(agent.latHist)) agent.latHist = [];
  agent.latHist.push({ t: now, ms: ping.ok ? ping.latency : null });
  if (agent.latHist.length > 480) agent.latHist.splice(0, agent.latHist.length - 480);
  if (ping.ok) {
    agent.lastSeen = now;
    if (!agent.onlineSince) agent.onlineSince = now;
  } else {
    agent.onlineSince = 0;
  }
  if (ping.ok && !wasOnline) pushEvent('ok', 'agent', `Агент «${agent.name}» (${agent.ip}) в сети`);
  if (!ping.ok && wasOnline) pushEvent('warn', 'agent', `Агент «${agent.name}» (${agent.ip}) недоступен`);

  // 2) Glances: REST API (порт 61208), свой интервал, хранение 30 дней
  const glIv = Math.max(15, (db.settings.intervals && db.settings.intervals.glances) || 60) * 1000;
  if (agent.glancesUrl && (force || now - (agent.lastGlances || 0) >= glIv)) {
    agent.lastGlances = now;
    try {
      const { pt, disks, netIface, sensors, cores, source } = await collectGlances(agent.glancesUrl, agent.relayUrl);
      pt.t = Date.now();
      agent.glancesLatest = pt;
      agent.glancesDisks = Array.isArray(disks) ? disks : [];
      agent.glancesNetIface = netIface || null;
      agent.glancesSensors = Array.isArray(sensors) ? sensors : [];
      agent.glancesCores = Array.isArray(cores) ? cores : [];
      seriesAppend(agent, 'glances', pt, GLANCES_RETENTION_MS);
      agent.lastError = null;
      console.log(`[pluto] Glances «${agent.name}» [${source}]: CPU ${pt.cpu ?? '—'}% · MEM ${pt.mem ?? '—'}% · FS ${pt.diskCount ?? '—'} шт (${pt.diskUsed ?? '—'}%) · net ${netIface ?? '—'}`);
    } catch (e) {
      agent.lastError = 'Glances: ' + (e.message || 'ошибка запроса');
      console.log(`[pluto] Glances «${agent.name}»: ${agent.lastError}`);
    }
  }

  // 3) пинги устройств через relay (внутри VLAN агента)
  if (agent.relayUrl && (agent.pingTargets || []).length) {
    const out = [];
    for (const tgt of agent.pingTargets) {
      const ips = expandIps(tgt);
      const results = await relayPing(agent, ips);
      out.push({ target: tgt, results, lastCheck: Date.now() });
    }
    agent.targets = out;
  }

  saveDb();
}

// ─── Glances-устройства (вкладка Bars) ──────────────────────────────────────

async function scrapeGlancesDev(dev, force) {
  const giv = Math.max(15, (db.settings.intervals && db.settings.intervals.glances) || 60) * 1000;
  if (!force && Date.now() - (dev.lastScrape || 0) < giv) return;
  const now = Date.now();
  try {
    const { pt, disks, netIface, source } = await collectGlances(dev.url, null);
    pt.t = Date.now();
    dev.lastScrape = now;
    dev.online = true;
    dev.latest = pt;
    dev.disks = Array.isArray(disks) ? disks : [];
    dev.netIface = netIface || null;
    dev.lastError = null;
    if (!Array.isArray(dev.history)) dev.history = [];
    dev.history.push(pt);
    if (dev.history.length > MAX_POINTS) dev.history = compactSeries(dev.history, pt.t);
    const cutoff = pt.t - GLANCES_RETENTION_MS;
    let i = 0;
    while (i < dev.history.length && dev.history[i].t < cutoff) i++;
    if (i > 0) dev.history.splice(0, i);
    saveDb();
    return { point: pt, error: null };
  } catch (e) {
    dev.lastScrape = now;
    dev.online = false;
    dev.lastError = e.message || 'ошибка запроса';
    saveDb();
    return { point: null, error: dev.lastError };
  }
}

// ─── Зеркало-ретранслятор (push-синхронизация) ──────────────────────────────
// Основной сервер периодически собирает снапшот состояния (без паролей, сессий
// и настроек) и отправляет его на публичный read-only экземпляр. Зеркало не
// опрашивает устройства — оно лишь показывает последнюю копию.

function buildSnapshot() {
  return {
    version: VERSION,
    syncedAt: Date.now(),
    devices: db.devices.map((d) => ({ ...d, profile: undefined, checking: undefined })),
    agents: db.agents.map((a) => ({ ...a, polling: undefined, pollStarted: undefined })),
    glances: (db.glances || []).map((g) => ({ ...g, scraping: undefined })),
    events: db.events.slice(0, 120),
    tags: db.tags,
  };
}

let mirrorBusy = false;
async function syncMirror(force) {
  const m = db.settings.mirror;
  if (IS_MIRROR || mirrorBusy || !m || !m.enabled || !m.url || !m.secret) return;
  const iv = Math.max(30, m.interval || 60) * 1000;
  if (!force && Date.now() - ((db.mirrorLast && db.mirrorLast.t) || 0) < iv) return;
  mirrorBusy = true;
  const endpoint = String(m.url).replace(/\/+$/, '') + '/api/mirror/ingest';
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(endpoint, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', 'X-Mirror-Secret': m.secret },
      body: JSON.stringify(buildSnapshot()),
    });
    clearTimeout(to);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || ('HTTP ' + res.status));
    db.mirrorLast = { t: Date.now(), ok: true, error: null };
    console.log(`[pluto] зеркало: снапшот отправлен (${db.devices.length} устр., ${db.agents.length} аг.)`);
  } catch (e) {
    db.mirrorLast = { t: Date.now(), ok: false, error: e.message || 'ошибка отправки' };
    console.log(`[pluto] зеркало: не удалось отправить — ${db.mirrorLast.error}`);
  } finally {
    mirrorBusy = false;
    saveDb();
  }
}

// Приём снапшота на зеркале. Вызывается до авторизации, защищён общим секретом.
function applySnapshot(snap) {
  if (!snap || typeof snap !== 'object') throw new Error('некорректный снапшот');
  db.devices = Array.isArray(snap.devices) ? snap.devices : [];
  db.agents = Array.isArray(snap.agents) ? snap.agents : [];
  db.glances = Array.isArray(snap.glances) ? snap.glances : [];
  db.events = Array.isArray(snap.events) ? snap.events : [];
  db.tags = Array.isArray(snap.tags) ? snap.tags : [];
  db.mirrorSyncedAt = Date.now();
  db.mirrorVersion = snap.version || null;
  saveDb();
}

// ─── Планировщик ────────────────────────────────────────────────────────────

let lastCleanup = 0;

setInterval(() => {
  const now = Date.now();

  // Основной сервер: push снапшота на зеркало-ретранслятор
  if (!IS_MIRROR) void syncMirror(false);

  // Зеркало ничего не опрашивает — только показывает последнюю копию
  if (IS_MIRROR) {
    if (now - lastCleanup > 3600000) { lastCleanup = now; /* зеркала чистит основной */ }
    return;
  }

  for (const d of db.devices) {
    const iv = Math.max(5, d.interval || (db.settings.intervals && db.settings.intervals[d.type]) || 60) * 1000;
    if (!d.checking && now - (d.lastCheck || 0) >= iv) {
      d.checking = true;
      runDeviceCheck(d).then((r) => applyDeviceResult(d, r)).finally(() => { d.checking = false; });
    }
  }

  const aiv = Math.max(10, (db.settings.intervals && db.settings.intervals.agent) || 30) * 1000;
  for (const a of db.agents) {
    if (a.polling && a.pollStarted && now - a.pollStarted > 180000) {
      console.log(`[pluto] опрос «${a.name}» завис — флаг сброшен`);
      a.polling = false;
    }
    if (!a.polling && now - (a.lastPoll || 0) >= aiv) {
      a.polling = true;
      a.pollStarted = now;
      pollAgent(a).finally(() => { a.polling = false; a.lastPoll = Date.now(); });
    }
  }

  for (const g of db.glances || []) {
    if (!g.scraping) {
      g.scraping = true;
      scrapeGlancesDev(g).finally(() => { g.scraping = false; });
    }
  }

  // автоочистка архивов по расписанию (раз в час): старше 60/30 дней
  if (now - lastCleanup > 3600000) {
    lastCleanup = now;
    let changed = false;
    for (const a of db.agents) {
      for (const [key, ret] of [['glances', GLANCES_RETENTION_MS]]) {
        const arr = a[key];
        if (Array.isArray(arr) && arr.length && arr[0].t < now - ret) {
          let i = 0;
          while (i < arr.length && arr[i].t < now - ret) i++;
          arr.splice(0, i);
          changed = true;
        }
      }
    }
    for (const g of db.glances || []) {
      const arr = g.history;
      if (Array.isArray(arr) && arr.length && arr[0].t < now - GLANCES_RETENTION_MS) {
        let i = 0;
        while (i < arr.length && arr[i].t < now - GLANCES_RETENTION_MS) i++;
        arr.splice(0, i);
        changed = true;
      }
    }
    if (changed) saveDb();
  }
}, 1000);

// ─── HTTP-сервер ────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;
  const method = req.method || 'GET';

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  try {
    // ── публичные маршруты ──
    if (p === '/api/health') return json(res, 200, { ok: true, name: 'pluto-core', version: VERSION, console: 'api', mirror: IS_MIRROR });
    if (p === '/api/version') return json(res, 200, { version: VERSION, mirror: IS_MIRROR });

    // Приём снапшота на зеркале. До авторизации, но с общим секретом.
    if (p === '/api/mirror/ingest' && method === 'POST') {
      if (!IS_MIRROR) return json(res, 404, { error: 'not found' });
      if (!MIRROR_SECRET) return json(res, 500, { error: 'зеркало не настроено: задайте MIRROR_SECRET' });
      const got = String(req.headers['x-mirror-secret'] || '');
      if (!got || got !== MIRROR_SECRET) return json(res, 403, { error: 'неверный секрет зеркала' });
      try {
        const snap = await readBody(req);
        applySnapshot(snap);
        return json(res, 200, { ok: true, syncedAt: db.mirrorSyncedAt });
      } catch (e) {
        return json(res, 400, { error: e.message || 'снапшот отклонён' });
      }
    }

    // ── статика веб-консоли (без авторизации) ──
    if (method === 'GET' && !p.startsWith('/api/')) {
      let file = path.normalize(path.join(WEB_DIR, p === '/' ? 'index.html' : p));
      if (!file.startsWith(WEB_DIR)) return json(res, 403, { error: 'forbidden' });
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(WEB_DIR, 'index.html');
      if (!fs.existsSync(file)) {
        return text(res, 200, 'PLUTO Core работает. Веб-консоль не найдена: пересоберите образ Docker.');
      }
      const ext = path.extname(file);
      if (ext === '.html' || !ext) {
        // вшиваем подпись ядра — консоль по ней понимает, что работает с настоящим сервером
        const html = fs.readFileSync(file, 'utf8').replace(
          '<head>',
          `<head><script>window.__PLUTO_CORE__={v:"${VERSION}"}</script>`,
        );
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
        return res.end(html);
      }
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'public, max-age=31536000, immutable' });
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

    // Зеркало — только чтение: любые изменения запрещены
    if (IS_MIRROR && method !== 'GET' && p !== '/api/auth/login' && p !== '/api/auth/me') {
      return json(res, 403, { error: 'зеркало: только чтение — изменения делайте на основном сервере' });
    }

    // ── состояние ──
    if (p === '/api/state' && method === 'GET') {
      const devices = isAdmin ? db.devices : db.devices.filter((d) => user.scope.includes(d.type));
      const agentsRaw = isAdmin || user.scope.includes('agent') ? db.agents : [];
      const agents = agentsRaw.map((a) => ({ ...a, glances: undefined, polling: undefined, pollStarted: undefined }));
      const glancesRaw = isAdmin || user.scope.includes('glances') ? db.glances : [];
      const glances = glancesRaw.map((g) => ({ ...g, history: undefined, scraping: undefined }));
      return json(res, 200, {
        devices, agents, glances,
        tags: db.tags, events: db.events, settings: db.settings,
        users: isAdmin ? db.users.map(publicUser) : undefined,
        mirror: IS_MIRROR,
        mirrorLast: db.mirrorLast || null,
        mirrorSyncedAt: db.mirrorSyncedAt || null,
        mirrorVersion: db.mirrorVersion || null,
      });
    }

    // ручная отправка снапшота на зеркало (только основной сервер, админ)
    if (p === '/api/mirror/sync-now' && method === 'POST' && isAdmin) {
      if (IS_MIRROR) return json(res, 400, { error: 'это зеркало — отправлять некуда' });
      await syncMirror(true);
      return json(res, 200, db.mirrorLast || { ok: false, error: 'не настроено' });
    }

    // ── устройства ──
    if (p === '/api/devices' && method === 'POST' && isAdmin) {
      const b = await readBody(req);
      if (!b.address) return json(res, 400, { error: 'укажите адрес устройства' });
      const d = {
        id: uid(), name: String(b.name || '').trim() || String(b.address), type: ['ping', 'http', 'api', 'rtsp', 'sip'].includes(b.type) ? b.type : 'ping',
        address: String(b.address).trim(), port: b.port != null ? parseInt(b.port, 10) : null,
        path: String(b.path || ''), method: b.method || null, body: b.body || null,
        interval: Math.max(5, parseInt(b.interval, 10) || (db.settings.intervals[b.type] || 60)),
        tags: Array.isArray(b.tags) ? b.tags : [], favorite: !!b.favorite,
        status: 'unknown', latency: null, baseline: null, history: [], fails: 0,
        lastCheck: 0, lastChange: Date.now(), checking: false, approx: false,
        profile: { base: 20, failP: 0.03, spikeP: 0.02 }, spikeUntil: 0, createdAt: Date.now(),
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
        for (const k of ['name', 'type', 'address', 'port', 'path', 'method', 'body', 'interval', 'tags', 'favorite']) {
          if (k in b) d[k] = b[k];
        }
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
      return json(res, 200, { result: r });
    }

    // ── агенты ──
    if (p === '/api/agents' && method === 'POST' && isAdmin) {
      const b = await readBody(req);
      const ip = String(b.ip || '').trim();
      if (!ip) return json(res, 400, { error: 'укажите IP-адрес ПК' });
      const a = {
        id: uid(),
        name: String(b.name || '').trim() || ('ПК ' + ip),
        ip,
        glancesUrl: String(b.glancesUrl || '').trim(),
        relayUrl: String(b.relayUrl || '').trim(),
        pingTargets: Array.isArray(b.pingTargets) ? b.pingTargets.map((x) => String(x).trim()).filter(Boolean) : [],
        online: false, latency: null, onlineSince: 0,
        lastSeen: 0, lastPoll: 0, lastGlances: 0, lastError: null,
        glancesLatest: null, glancesDisks: [], glancesNetIface: null,
        glancesSensors: [], glancesCores: [], glances: [], latHist: [], targets: [],
        favorite: false, createdAt: Date.now(),
      };
      db.agents.push(a);
      pushEvent('info', 'agent', `Добавлен агент «${a.name}» (${a.ip})`);
      saveDb();
      pollAgent(a, true);
      return json(res, 200, a);
    }
    m = p.match(/^\/api\/agents\/([^/]+)$/);
    if (m && isAdmin) {
      const a = db.agents.find((x) => x.id === m[1]);
      if (!a) return json(res, 404, { error: 'агент не найден' });
      if (method === 'PUT' || method === 'PATCH') {
        const b = await readBody(req);
        for (const k of ['name', 'ip', 'glancesUrl', 'relayUrl', 'favorite']) if (k in b) a[k] = b[k];
        if (Array.isArray(b.pingTargets)) a.pingTargets = b.pingTargets.map((x) => String(x).trim()).filter(Boolean);
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
      await pollAgent(a, true);
      return json(res, 200, a);
    }
    // диагностика источника (Glances)
    m = p.match(/^\/api\/agents\/([^/]+)\/test-glances$/);
    if (m && method === 'GET') {
      const a = db.agents.find((x) => x.id === m[1]);
      if (!a) return json(res, 404, { error: 'агент не найден' });
      if (!isAdmin && !user.scope.includes('agent')) return json(res, 403, { error: 'нет доступа к агентам' });
      const srcUrl = a.glancesUrl;
      // Glances: пробуем REST API (/api/4/all → /api/3/all), затем HTML
      try {
        const { pt, disks, netIface, source } = await collectGlances(srcUrl, a.relayUrl);
        const recognized = GLANCES_KEYS.filter((k) => pt[k] != null);
        const viaText = source === 'html'
          ? 'разбор HTML-страницы'
          : 'REST API Glances, ' + (source === 'api4' ? '/api/4' : '/api/3');
        return json(res, 200, {
          ok: recognized.length > 0, url: srcUrl, via: source,
          sample: viaText + (netIface ? ' · адаптер: ' + netIface : '') + (disks.length ? ' · ФС: ' + disks.length + ' шт' : ''),
          values: pt, recognized, disks, netIface,
          missing: GLANCES_KEYS.filter((k) => pt[k] == null),
        });
      } catch (e) {
        return json(res, 200, { ok: false, url: srcUrl || '', via: null, error: e.message || String(e) });
      }
    }
    // история Glances агента (30 дней)
    m = p.match(/^\/api\/agents\/([^/]+)\/glances$/);
    if (m && method === 'GET') {
      const a = db.agents.find((x) => x.id === m[1]);
      if (!a) return json(res, 404, { error: 'агент не найден' });
      if (!isAdmin && !user.scope.includes('agent')) return json(res, 403, { error: 'нет доступа к агентам' });
      const rq = url.searchParams.get('range');
      const range = GLANCES_RANGE_MS[rq] ? rq : '5m';
      const out = rangePoints(a.glances, GLANCES_RANGE_MS[range], range);
      out.retentionDays = 30;
      return json(res, 200, out);
    }

    // ── Glances-устройства (Bars) ──
    if (p === '/api/glances' && method === 'POST' && isAdmin) {
      const b = await readBody(req);
      if (!b.url) return json(res, 400, { error: 'укажите адрес мониторинга' });
      const g = {
        id: uid(), name: String(b.name || '').trim() || 'Glances-сервер', url: String(b.url).trim(),
        serverLink: String(b.serverLink || '').trim(), createdAt: Date.now(),
        lastScrape: 0, lastError: null, online: false, latest: null, history: [],
        disks: [], netIface: null,
      };
      db.glances.push(g);
      saveDb();
      scrapeGlancesDev(g, true);
      return json(res, 200, g);
    }
    m = p.match(/^\/api\/glances\/([^/]+)$/);
    if (m && isAdmin && method === 'DELETE') {
      db.glances = db.glances.filter((x) => x.id !== m[1]);
      saveDb();
      return json(res, 200, { ok: true });
    }
    m = p.match(/^\/api\/glances\/([^/]+)\/scrape$/);
    if (m && method === 'POST' && isAdmin) {
      const g = db.glances.find((x) => x.id === m[1]);
      if (!g) return json(res, 404, { error: 'устройство не найдено' });
      return json(res, 200, await scrapeGlancesDev(g, true));
    }
    m = p.match(/^\/api\/glances\/([^/]+)\/history$/);
    if (m && method === 'GET') {
      const g = db.glances.find((x) => x.id === m[1]);
      if (!g) return json(res, 404, { error: 'устройство не найдено' });
      if (!isAdmin && !user.scope.includes('glances')) return json(res, 403, { error: 'нет доступа' });
      const rq = url.searchParams.get('range');
      const range = GLANCES_RANGE_MS[rq] ? rq : '5m';
      const out = rangePoints(g.history, GLANCES_RANGE_MS[range], range);
      out.retentionDays = 30;
      return json(res, 200, out);
    }

    // ── теги ──
    if (p === '/api/tags' && method === 'POST' && isAdmin) {
      const b = await readBody(req);
      const label = String(b.label || '').trim();
      if (!label) return json(res, 400, { error: 'укажите название тега' });
      if (db.tags.some((t) => t.label.toLowerCase() === label.toLowerCase())) return json(res, 400, { error: 'такой тег уже есть' });
      const t = { id: uid(), label, color: String(b.color || '#9a8cfa') };
      db.tags.push(t);
      saveDb();
      return json(res, 200, t);
    }
    m = p.match(/^\/api\/tags\/([^/]+)$/);
    if (m && isAdmin && method === 'DELETE') {
      const t = db.tags.find((x) => x.id === m[1]);
      db.tags = db.tags.filter((x) => x.id !== m[1]);
      for (const d of db.devices) d.tags = (d.tags || []).filter((x) => x !== m[1]);
      if (t) pushEvent('info', 'system', `Тег «${t.label}» удалён`);
      saveDb();
      return json(res, 200, { ok: true });
    }

    // ── пользователи ──
    if (p === '/api/users' && method === 'POST' && isAdmin) {
      const b = await readBody(req);
      const login = String(b.login || '').trim();
      if (!login || !String(b.name || '').trim()) return json(res, 400, { error: 'заполните логин и имя' });
      if (db.users.some((x) => x.login === login)) return json(res, 400, { error: 'такой логин уже есть' });
      const u = {
        id: uid(), name: String(b.name).trim(), login, role: b.role === 'admin' ? 'admin' : 'viewer',
        scope: Array.isArray(b.scope) ? b.scope : [], builtIn: false,
        passHash: hashPass(String(b.password || 'pluto')), createdAt: Date.now(),
      };
      db.users.push(u);
      saveDb();
      return json(res, 200, publicUser(u));
    }
    m = p.match(/^\/api\/users\/([^/]+)$/);
    if (m && isAdmin) {
      const u = db.users.find((x) => x.id === m[1]);
      if (!u) return json(res, 404, { error: 'пользователь не найден' });
      if (method === 'PUT' || method === 'PATCH') {
        const b = await readBody(req);
        if (b.role) u.role = b.role;
        if (Array.isArray(b.scope)) u.scope = b.scope;
        if (b.password) u.passHash = hashPass(String(b.password));
        saveDb();
        return json(res, 200, publicUser(u));
      }
      if (method === 'DELETE') {
        if (u.builtIn) return json(res, 400, { error: 'нельзя удалить встроенного администратора' });
        db.users = db.users.filter((x) => x.id !== u.id);
        saveDb();
        return json(res, 200, { ok: true });
      }
    }

    // ── настройки ──
    if (p === '/api/settings' && method === 'PUT' && isAdmin) {
      const b = await readBody(req);
      db.settings = {
        ...db.settings, ...b,
        intervals: { ...db.settings.intervals, ...(b.intervals || {}) },
        notifications: { ...db.settings.notifications, ...(b.notifications || {}) },
      };
      pushEvent('info', 'system', 'Системные настройки сохранены');
      saveDb();
      return json(res, 200, db.settings);
    }

    return json(res, 404, { error: 'Маршрут не найден' });
  } catch (e) {
    console.error('[pluto] ошибка запроса:', e);
    return json(res, 500, { error: 'внутренняя ошибка' });
  }
});

// ─── Шлюз агентов (WebSocket, порт 8443) — зарезервирован под будущие расширения ──
const agentServer = http.createServer((req, res) => {
  text(res, 200, 'pluto agent gateway');
});
attachWs(agentServer, (conn, url, ip) => {
  console.log(`[pluto] шлюз: подключение от ${ip} (${url})`);
  conn.onClose(() => {});
});
agentServer.listen(AGENT_PORT, () => {
  console.log(`[pluto] шлюз агентов: :${AGENT_PORT}`);
});

server.listen(HTTP_PORT, () => {
  console.log(`[pluto] core v${VERSION} · консоль и API: http://0.0.0.0:${HTTP_PORT} · health: /api/health`);
});
