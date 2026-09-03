// ─── PLUTO Core: серверное ядро мониторинга ─────────────────────────────────
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import {
  loadDb, saveDb, uid, pushEvent, hashPass, verifyPass, issueSession, authUser, DEFAULT_SETTINGS,
} from './lib.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VERSION = '2.0.0';
const WEB_DIR = path.join(__dirname, '..', 'web');
const HTTP_PORT = parseInt(process.env.HTTP_PORT || '8080', 10);

const db = loadDb();

// ─── HTTP-хелперы ───────────────────────────────────────────────────────────

function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}
function text(res, code, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type });
  res.end(body);
}
async function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); } });
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8', '.map': 'application/json',
};

function fetchText(rawUrl, timeoutMs = 7000) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(rawUrl); } catch { return reject(new Error('некорректный адрес')); }
    const lib = u.protocol === 'https:' ? https : http;
    const r = lib.get(u, { timeout: timeoutMs, headers: { Connection: 'close' } }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return fetchText(new URL(res.headers.location, u).toString(), timeoutMs).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(data));
    });
    r.on('timeout', () => r.destroy(new Error('таймаут запроса')));
    r.on('error', (e) => reject(e));
  });
}

const publicUser = (u) => ({
  id: u.id, login: u.login, name: u.name, role: u.role,
  menuScope: Array.isArray(u.menuScope) ? u.menuScope : [],
  deviceScope: Array.isArray(u.deviceScope) ? u.deviceScope : [],
  builtIn: !!u.builtIn,
  twoFA: { enabled: !!(u.twoFA && u.twoFA.enabled), secret: null }, // секрет не отдаём
  createdAt: u.createdAt,
});

// ─── Проверки устройств ─────────────────────────────────────────────────────

function checkPing(address, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const to = setTimeout(() => resolve({ ok: false, latency: null }), timeoutMs + 500);
    const started = Date.now();
    execFile('ping', ['-c', '1', '-W', String(Math.max(1, Math.ceil(timeoutMs / 1000))), address], (err) => {
      clearTimeout(to);
      if (err) return resolve({ ok: false, latency: null });
      resolve({ ok: true, latency: Date.now() - started });
    });
  });
}

async function checkHttp(d, timeoutMs) {
  const base = /^https?:\/\//i.test(d.address) ? d.address : `http://${d.address}${d.port ? ':' + d.port : ''}`;
  const url = base + (d.path || '');
  const started = Date.now();
  try {
    const html = await fetchText(url, timeoutMs);
    return { ok: html != null, latency: Date.now() - started };
  } catch { return { ok: false, latency: null }; }
}

async function runDeviceCheck(d) {
  const timeoutMs = db.settings.timeoutMs || 3000;
  let res;
  if (d.type === 'ping') res = await checkPing(d.address, timeoutMs);
  else if (d.type === 'http' || d.type === 'api') res = await checkHttp(d, timeoutMs);
  else if (d.type === 'rtsp') res = await checkHttp({ ...d, path: '' }, timeoutMs);
  else if (d.type === 'sip') res = { ok: false, latency: null };
  else res = { ok: false, latency: null };
  applyResult(d, res);
}

function applyResult(d, res) {
  const now = Date.now();
  const cfg = db.settings;
  d.lastCheck = now;
  d.checking = false;

  if (!res.ok) {
    d.fails = (d.fails || 0) + 1;
    d.history = [...(d.history || []), -1].slice(-48);
    if (d.fails >= cfg.failThreshold && d.status !== 'down') {
      d.status = 'down'; d.latency = null; d.lastChange = now;
      pushEvent('crit', 'device', `${d.name} (${d.address}) — потеря связи`);
      notify('down', `PLUTO: авария`, `${d.name} (${d.address}) — потеря связи`);
    }
    saveDb();
    return;
  }

  const baseline = d.baseline ?? res.latency;
  d.baseline = Math.round((baseline * 0.9 + res.latency * 0.1) * 10) / 10;
  const degraded = res.latency > d.baseline * cfg.degradeFactor && res.latency > cfg.degradeMinMs;
  const status = degraded ? 'degraded' : 'up';
  const prev = d.status;
  d.status = status; d.latency = res.latency; d.fails = 0;
  d.history = [...(d.history || []), res.latency].slice(-48);

  if (prev === 'down') { pushEvent('ok', 'device', `${d.name} — связь восстановлена`); notify('recover', 'PLUTO: восстановление', `${d.name} снова в строю`); }
  else if (degraded && prev !== 'degraded') { pushEvent('warn', 'device', `${d.name}: деградация ${res.latency} мс`); notify('degraded', 'PLUTO: деградация', `${d.name}: ${res.latency} мс`); }
  if (status !== prev) d.lastChange = now;
  saveDb();
}

// ─── Relay-пинги (устройства внутри VLAN/NAT) ──────────────────────────────

async function relayPing(agent, targets) {
  if (!agent.relayUrl) return [];
  const base = String(agent.relayUrl).replace(/\/+$/, '');
  const url = base + '/ping?targets=' + encodeURIComponent(targets.join(','));
  try {
    const txt = await fetchText(url, 15000);
    const arr = JSON.parse(txt);
    if (Array.isArray(arr)) {
      return arr.map((r) => ({ ip: r.ip, alive: !!r.alive, latency: r.latencyMs != null ? r.latencyMs : (r.latency != null ? r.latency : null) }));
    }
  } catch { /* relay недоступен */ }
  return [];
}

// ─── Glances (телеметрия) ───────────────────────────────────────────────────

function glancesFromApi(data) {
  const cpu = data.cpu || {};
  const mem = data.mem || {};
  const gpuList = data.gpu || [];
  const gpu = gpuList.length ? gpuList[0] : null;
  const sensors = (data.sensors || []).filter((s) => s && s.value != null);
  const system = data.system || {};

  const toGB = (b) => (b != null ? Math.round((b / 1024 ** 3) * 10) / 10 : null);
  const toKBs = (b) => (b != null ? Math.round((b / 1024) * 10) / 10 : null);
  const isVirtual = (name) => /lo$|^lo\b|veth|docker|br-|virbr|vmnet|vboxnet|tap|tun|vir|virtual|wsl|hyper/i.test(name || '');

  const network = (data.network || []).filter((n) => n);
  const mainAdapterSel = network.filter((n) => !isVirtual(n.interface_name || n.key || ''))
    .sort((a, b) => ((b.rx || 0) + (b.tx || 0)) - ((a.rx || 0) + (a.tx || 0)))[0] || network[0] || null;

  const temp = (re) => {
    const s = sensors.find((x) => re.test(x.label || ''));
    return s ? Math.round(s.value * 10) / 10 : null;
  };

  // диск → температура из sensors: ищем сенсоры diskio/temperature, чья метка
  // содержит имя устройства (sda, nvme0, /dev/sda, C: …)
  const diskTemp = (f) => {
    const dev = String(f.device_name || f.mnt_point || '').replace(/^\/dev\//, '').replace(/[\\/:].*$/, '');
    if (!dev) return null;
    const s = sensors.find((x) => /disk|ssd|nvme|hdd|temp/i.test(x.kind || '') && new RegExp(`(^|[^a-z0-9])${dev}([^a-z0-9]|$)`, 'i').test(x.label || ''));
    return s ? Math.round(s.value * 10) / 10 : null;
  };

  // диск → скорости чтения/записи из плагина diskio (Glances отдаёт байты/с)
  const diskio = Array.isArray(data.diskio) ? data.diskio : [];
  const ioFor = (f) => {
    const dev = String(f.device_name || '').replace(/^\/dev\//, '');
    const byDev = diskio.find((d) => (d.disk_name || d.key || '') === dev);
    const byMnt = !byDev ? diskio.find((d) => (d.disk_name || d.key || '') === f.mnt_point) : null;
    const io = byDev || byMnt;
    if (!io) return { readKBs: null, writeKBs: null };
    const r = io.read_bytes != null ? io.read_bytes : io.read_count;
    const w = io.write_bytes != null ? io.write_bytes : io.write_count;
    return { readKBs: toKBs(r), writeKBs: toKBs(w) };
  };

  const fsArr = Array.isArray(data.fs) ? data.fs : [];
  const mainFs = fsArr.find((f) => f.mnt_point === '/' || /^[A-Za-z]:\\?$/.test(f.mnt_point || '')) || fsArr[0] || null;

  return {
    hostname: system.hostname || null,
    os: system.os_name ? `${system.os_name}${system.os_version ? ' ' + system.os_version : ''}` : null,
    cpu: cpu.total != null ? Math.round(cpu.total * 10) / 10 : null,
    cpuCores: (data.percpu || []).map((c) => Math.round((c.total || 0) * 10) / 10),
    gpu: gpu && gpu.gpu != null ? Math.round(gpu.gpu * 10) / 10 : null,
    gpuTemp: temp(/gpu/i),
    ram: mem.percent != null ? Math.round(mem.percent * 10) / 10 : null,
    ramUsedGB: toGB(mem.used), ramTotalGB: toGB(mem.total),
    swap: data.memswap && data.memswap.percent != null ? Math.round(data.memswap.percent * 10) / 10 : null,
    swapUsedGB: data.memswap ? toGB(data.memswap.used) : null,
    swapTotalGB: data.memswap ? toGB(data.memswap.total) : null,
    load1: data.load && data.load.min1 != null ? data.load.min1 : null,
    load5: data.load && data.load.min5 != null ? data.load.min5 : null,
    load15: data.load && data.load.min15 != null ? data.load.min15 : null,
    procCount: data.processcount && data.processcount.total != null ? data.processcount.total : null,
    cput: temp(/package|cpu/i),
    ssdt: temp(/ssd|nvme|disk/i),
    // ВСЕ диски: занятость + температура + скорости I/O (если Glances их видит)
    disks: fsArr.map((f) => ({
      mnt: f.mnt_point,
      percent: f.percent != null ? Math.round(f.percent * 10) / 10 : null,
      usedGB: toGB(f.used), sizeGB: toGB(f.size),
      temp: diskTemp(f),
      ...ioFor(f),
    })),
    // ВСЕ сетевые адаптеры, виртуальные помечены
    adapters: network.map((n) => {
      const name = n.interface_name || n.key || '?';
      return { name, rx: toKBs(n.rx), tx: toKBs(n.tx), virtual: isVirtual(name) };
    }),
    mainAdapter: mainAdapterSel ? (mainAdapterSel.interface_name || mainAdapterSel.key) : null,
    rx: mainAdapterSel && mainAdapterSel.rx != null ? Math.round((mainAdapterSel.rx / 1024) * 10) / 10 : null,
    tx: mainAdapterSel && mainAdapterSel.tx != null ? Math.round((mainAdapterSel.tx / 1024) * 10) / 10 : null,
    sensors: sensors.map((s) => ({ label: s.label, value: Math.round(s.value * 10) / 10, unit: s.unit || '', kind: s.type || '' })),
    uptimeSec: data.uptime ? parseUptime(data.uptime) : null,
    mainFsUsed: mainFs && mainFs.percent != null ? Math.round(mainFs.percent * 10) / 10 : null,
  };
}

function parseUptime(s) {
  const m = /(\d+):(\d+):(\d+)/.exec(String(s));
  if (!m) return null;
  return parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseInt(m[3]);
}

async function collectGlances(url) {
  const base = String(url).replace(/\/+$/, '');
  for (const ver of [4, 3]) {
    try {
      const txt = await fetchText(`${base}/api/${ver}/all`, 7000);
      const data = JSON.parse(txt);
      const g = glancesFromApi(data);
      return { ...g, via: `api${ver}` };
    } catch { /* пробуем другую версию API */ }
  }
  throw new Error('Glances недоступен: /api/4/all и /api/3/all не ответили');
}

function glancesPoint(g, t) {
  return { t, cpu: g.cpu, gpu: g.gpu, ram: g.ram, rx: g.rx, tx: g.tx, cput: g.cput, ssdt: g.ssdt, diskUsed: g.mainFsUsed ?? null };
}

// ─── Уведомления ────────────────────────────────────────────────────────────

function notify(kind, title, body) {
  const n = db.settings.notifications;
  if (kind === 'down' && !n.on.down) return;
  if (kind === 'degraded' && !n.on.degraded) return;
  if (kind === 'recover' && !n.on.recover) return;
  if (kind === 'agentOff' && !n.on.agentOff) return;
  if (kind === 'agentOn' && !n.on.agentOn) return;

  if (n.telegram.enabled && n.telegram.botToken && n.telegram.chatId) {
    fetch(`https://api.telegram.org/bot${n.telegram.botToken}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: n.telegram.chatId, text: `${title}\n${body}` }),
    }).catch(() => {});
  }
}

// ─── Витрина (публичная, без входа) ────────────────────────────────────────

function pingAgg(targets) {
  let total = 0, online = 0, sum = 0, cnt = 0, max = null;
  for (const t of targets || []) for (const r of t.results || []) {
    total++;
    if (r.alive) { online++; if (r.latency != null) { sum += r.latency; cnt++; if (max == null || r.latency > max) max = r.latency; } }
  }
  return { total, online, offline: total - online, avg: cnt ? Math.round(sum / cnt) : null, max };
}

function showcaseDevices() {
  return db.devices.filter((d) => d.showcase).map((d) => ({
    name: d.name, type: d.type, address: d.address, status: d.status, latency: d.latency ?? null, lastCheck: d.lastCheck || null,
  }));
}
function showcaseAgents() {
  return db.agents.filter((a) => a.pingsShowcase).map((a) => {
    const st = pingAgg(a.targets);
    return { name: a.name, ip: a.ip, online: !!a.online, latency: a.latency ?? null, ...st };
  });
}

const SHOWCASE_HTML = `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PLUTO — статус</title>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600;700&family=IBM+Plex+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box}
body{margin:0;background:#0b0e1a;color:#dfe3f5;font:15px/1.5 'IBM Plex Sans',system-ui,sans-serif;min-height:100vh;position:relative;overflow-x:hidden}
body::before{content:"";position:fixed;inset:0;pointer-events:none;background:radial-gradient(60% 50% at 15% 15%,rgba(143,125,240,.10),transparent 70%),radial-gradient(50% 45% at 85% 80%,rgba(123,164,230,.09),transparent 70%)}
body::after{content:"";position:fixed;inset:0;pointer-events:none;opacity:.55;background-image:radial-gradient(1px 1px at 25px 35px,rgba(223,227,245,.6),transparent),radial-gradient(1px 1px at 120px 90px,rgba(223,227,245,.4),transparent),radial-gradient(1.5px 1.5px at 200px 160px,rgba(143,125,240,.5),transparent);background-size:340px 340px;animation:drift 240s linear infinite}
@keyframes drift{from{transform:translate3d(0,0,0)}to{transform:translate3d(-340px,-170px,0)}}
.wrap{position:relative;max-width:760px;margin:0 auto;padding:40px 20px 56px}
.brand{display:flex;align-items:baseline;gap:14px;margin-bottom:2px}
h1{font-family:'Space Grotesk',sans-serif;font-size:26px;font-weight:700;letter-spacing:.24em;margin:0;color:#8f7df0}
.live{display:inline-flex;align-items:center;gap:7px;font:600 11px 'JetBrains Mono',monospace;color:#55c795;text-transform:uppercase;letter-spacing:.12em}
.live i{width:7px;height:7px;border-radius:50%;background:#55c795;animation:pulse 2s ease-in-out infinite}
@keyframes pulse{0%,100%{box-shadow:0 0 0 0 rgba(85,199,149,.5)}50%{box-shadow:0 0 0 6px rgba(85,199,149,0)}}
.sub{font-size:12.5px;color:#8b93b8;margin:0 0 30px}
.sec{display:flex;align-items:center;gap:10px;margin:26px 0 12px;font:700 12px 'JetBrains Mono',monospace;letter-spacing:.18em;text-transform:uppercase;color:#aeb6d8}
.sec::after{content:"";flex:1;height:1px;background:linear-gradient(90deg,#242b4a,transparent)}
.cnt{font:600 11px 'JetBrains Mono',monospace;color:#8f7df0;background:rgba(143,125,240,.12);border:1px solid rgba(143,125,240,.3);border-radius:999px;padding:1px 9px}
.row{display:flex;align-items:center;gap:12px;padding:13px 16px;border:1px solid #242b4a;border-radius:10px;background:rgba(18,22,42,.85);margin-bottom:9px;transition:transform .15s ease,border-color .15s ease}
.row:hover{transform:translateY(-2px);border-color:rgba(143,125,240,.45)}
.dot{width:10px;height:10px;border-radius:50%;flex:none}
.up{background:#55c795;box-shadow:0 0 9px #55c79588}
.down{background:#e07a80;box-shadow:0 0 9px #e07a8088}
.degraded{background:#dfa65e;box-shadow:0 0 9px #dfa65e88}
.unknown{background:#8b93b8}
.name{font-weight:600;font-size:14.5px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.type{font:600 10px 'JetBrains Mono',monospace;color:#8b93b8;text-transform:uppercase}
.addr{font:12px 'JetBrains Mono',monospace;color:#aeb6d8}
.lat{font:600 13px 'JetBrains Mono',monospace;color:#5fc6d8;width:76px;text-align:right}
.stats{display:flex;gap:8px;flex-wrap:wrap}
.chip{font:600 11px 'JetBrains Mono',monospace;padding:3px 9px;border-radius:7px;border:1px solid #242b4a;background:rgba(11,14,26,.6);color:#aeb6d8}
.chip .ok{color:#55c795}.chip .warn{color:#dfa65e}.chip .bad{color:#e07a80}.chip .info{color:#5fc6d8}
.empty{color:#8b93b8;text-align:center;padding:48px 0;font-size:13.5px}
.upd{font:11px 'JetBrains Mono',monospace;color:#8b93b8;text-align:right;margin-top:20px}
@media(max-width:560px){.addr{display:none}}
</style></head><body><div class="wrap">
<div class="brand"><h1>PLUTO</h1><span class="live"><i></i>online</span></div>
<p class="sub">Публичный статус инфраструктуры · обновление каждые 10 с</p>
<div id="list"><div class="empty">Загрузка…</div></div>
<div class="upd" id="upd"></div></div>
<script>
const STATUS={up:['В сети','up'],down:['Авария','down'],degraded:['Деградация','degraded'],unknown:['Ожидание','unknown']};
const esc=(s)=>String(s==null?'':s).replace(/</g,'&lt;');
async function tick(){
  try{
    const r=await fetch('/api/showcase');const d=await r.json();
    const el=document.getElementById('list');
    const devs=d.devices||[],ags=d.agents||[];
    if(!devs.length&&!ags.length){el.innerHTML='<div class="empty">Нет устройств на витрине</div>';}
    else{
      let html='';
      if(devs.length){
        html+='<div class="sec">Устройства <span class="cnt">'+devs.length+'</span></div>';
        html+=devs.map(x=>{const cls=(STATUS[x.status]||STATUS.unknown)[1];
          return '<div class="row"><span class="dot '+cls+'"></span><span class="name">'+esc(x.name)+'</span>'+
          '<span class="type">'+esc(x.type)+'</span><span class="addr">'+esc(x.address)+'</span>'+
          '<span class="lat">'+(x.latency==null?'—':x.latency+' мс')+'</span></div>';}).join('');
      }
      if(ags.length){
        html+='<div class="sec">Пинги агентов <span class="cnt">'+ags.length+'</span></div>';
        html+=ags.map(x=>{const cls=x.online?'up':'down';
          return '<div class="row"><span class="dot '+cls+'"></span><span class="name">'+esc(x.name)+'</span>'+
          '<span class="addr">'+esc(x.ip)+'</span><span class="stats">'+
          '<span class="chip">всего <b>'+x.total+'</b></span>'+
          '<span class="chip"><b class="'+(x.onlineCount?'ok':'bad')+'">'+x.onlineCount+'</b> онлайн</span>'+
          (x.offline?'<span class="chip"><b class="bad">'+x.offline+'</b> офлайн</span>':'')+
          '<span class="chip">ср <b class="info">'+(x.avg==null?'—':x.avg+' мс')+'</b></span>'+
          '<span class="chip">макс <b class="warn">'+(x.max==null?'—':x.max+' мс')+'</b></span>'+
          '</span></div>';}).join('');
      }
      el.innerHTML=html;
    }
    document.getElementById('upd').textContent='обновлено '+new Date().toLocaleTimeString('ru-RU');
  }catch(e){}
}
tick();setInterval(tick,10000);
</script></body></html>`;

let showcaseServer = null;
function startShowcase() {
  stopShowcase();
  const port = parseInt(process.env.SHOWCASE_PORT, 10) || db.settings.showcase.port || 8081;
  showcaseServer = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname === '/api/showcase') return json(res, 200, { devices: showcaseDevices(), agents: showcaseAgents() });
    if (url.pathname === '/' || url.pathname === '/index.html') return text(res, 200, SHOWCASE_HTML, 'text/html; charset=utf-8');
    return text(res, 404, 'not found');
  });
  showcaseServer.on('error', (e) => console.error(`[pluto] витрина: порт ${port} —`, e.message));
  showcaseServer.listen(port, () => console.log(`[pluto] витрина (публичная, без входа): http://0.0.0.0:${port}`));
}
function stopShowcase() {
  if (showcaseServer) { try { showcaseServer.close(); } catch { /* уже закрыт */ } showcaseServer = null; }
}

// ─── Планировщик (с ограничением параллелизма) ─────────────────────────────

const MAX_CONCURRENT = 8;
let running = 0;
const queue = [];

function runNext() {
  while (running < MAX_CONCURRENT && queue.length) {
    const task = queue.shift();
    running++;
    task().finally(() => { running--; runNext(); });
  }
}

setInterval(() => {
  const now = Date.now();
  for (const d of db.devices) {
    if (d.checking) continue;
    const iv = Math.max(5, d.interval || 60) * 1000;
    if (now - (d.lastCheck || 0) >= iv) {
      d.checking = true;
      queue.push(() => runDeviceCheck(d));
    }
  }

  const aiv = Math.max(10, db.settings.intervals.agent || 30) * 1000;
  for (const a of db.agents) {
    if (now - (a.lastPoll || 0) >= aiv) {
      a.lastPoll = now;
      queue.push(() => pollAgent(a));
    }
  }
  runNext();
}, 1000);

async function pollAgent(agent) {
  const now = Date.now();
  const wasOnline = agent.online;

  // 1) пинг до ПК (uptime / доступность)
  const ping = await checkPing(agent.ip, db.settings.timeoutMs || 3000);
  agent.online = ping.ok;
  agent.latency = ping.ok ? ping.latency : null;
  if (ping.ok) { agent.lastSeen = now; if (!agent.onlineSince) agent.onlineSince = now; }
  else agent.onlineSince = 0;
  agent.latHist = [...(agent.latHist || []), { t: now, ms: ping.ok ? ping.latency : null }].slice(-480);
  if (ping.ok && !wasOnline) { pushEvent('ok', 'agent', `Агент «${agent.name}» в сети`); notify('agentOn', 'PLUTO: агент в сети', agent.name); }
  if (!ping.ok && wasOnline) { pushEvent('warn', 'agent', `Агент «${agent.name}» недоступен`); notify('agentOff', 'PLUTO: агент офлайн', agent.name); }

  // 2) relay-пинги локальных устройств. Стабильность: при сбое relay
  //    сохраняем последний успешный результат, чтобы не «мигало».
  if (agent.relayUrl && (agent.pingTargets || []).length) {
    const out = [];
    let anyOk = false;
    for (const tgt of agent.pingTargets) {
      const ips = expandTargets(tgt);
      const results = await relayPing(agent, ips);
      if (results.length) anyOk = true;
      const prev = (agent.targets || []).find((t) => t.target === tgt);
      out.push({ target: tgt, lastCheck: now, results: results.length ? results : (prev ? prev.results : []) });
    }
    if (anyOk) agent.targets = out;
  }

  // 3) Glances (отдельный интервал, хранение 30 дней)
  const giv = Math.max(10, db.settings.intervals.glances || 20) * 1000;
  if (agent.glancesUrl && now - (agent.lastGlances || 0) >= giv) {
    agent.lastGlances = now;
    try {
      const g = await collectGlances(agent.glancesUrl);
      agent.glancesLatest = g;
      agent.glancesError = null;
      agent.glances = [...(agent.glances || []), glancesPoint(g, now)].slice(-6000);
    } catch (e) {
      agent.glancesError = 'Glances: ' + (e.message || 'ошибка');
    }
  }

  saveDb();
}

function expandTargets(target) {
  const t = String(target).trim();
  if (/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(t)) return [t];
  const range = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.)(\d{1,3})-(\d{1,3})$/.exec(t);
  if (range) {
    const out = [];
    const a = +range[2], b = +range[3];
    for (let i = Math.min(a, b); i <= Math.max(a, b) && out.length < 256; i++) out.push(range[1] + i);
    return out;
  }
  const cidr = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.)\d{1,3}\/(\d{1,2})$/.exec(t);
  if (cidr && +cidr[2] >= 24) {
    const out = [];
    for (let i = 1; i < 255; i++) out.push(cidr[1] + i);
    return out;
  }
  return [];
}

// ─── Зеркало (push снапшота на read-only копию) ────────────────────────────

setInterval(() => {
  const m = db.settings.mirror;
  if (!m || !m.enabled || !m.url || !m.secret) return;
  const snap = {
    ts: Date.now(), version: VERSION,
    devices: showcaseDevices(), agents: showcaseAgents(),
  };
  fetch(String(m.url).replace(/\/+$/, '') + '/api/mirror/ingest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Mirror-Secret': m.secret },
    body: JSON.stringify(snap),
  }).catch(() => {});
}, Math.max(30, db.settings.mirror?.interval || 60) * 1000);

// ─── HTTP-сервер и REST API ────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;
  const method = req.method;

  try {
    // ── публичные маршруты ──
    if (p === '/api/health') return json(res, 200, { ok: true, name: 'pluto-core', version: VERSION, console: 'api' });
    if (p === '/api/version') return json(res, 200, { version: VERSION });

    if (p === '/api/auth/login' && method === 'POST') {
      const b = await readBody(req);
      const u = db.users.find((x) => x.login.toLowerCase() === String(b.login || '').toLowerCase());
      if (!u || !verifyPass(String(b.pass || ''), u.passHash)) return json(res, 401, { error: 'Неверный логин или пароль' });
      return json(res, 200, { token: issueSession(u.id), user: publicUser(u) });
    }

    // ── статика веб-консоли (без авторизации) ──
    if (method === 'GET' && !p.startsWith('/api/')) {
      let file = path.normalize(path.join(WEB_DIR, p === '/' ? 'index.html' : p));
      if (!file.startsWith(WEB_DIR)) return json(res, 403, { error: 'forbidden' });
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(WEB_DIR, 'index.html');
      if (!fs.existsSync(file)) return text(res, 200, 'PLUTO Core работает. Веб-консоль не найдена.', 'text/plain; charset=utf-8');
      const ext = path.extname(file);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable' });
      return fs.createReadStream(file).pipe(res);
    }

    // ── авторизация ──
    const user = authUser(req);
    if (!user) return json(res, 401, { error: 'Требуется авторизация' });
    const isAdmin = user.role === 'admin';

    if (p === '/api/auth/me') return json(res, 200, publicUser(user));

    // ── пользователи (только админ) ──
    if (p === '/api/users' && method === 'POST' && isAdmin) {
      const b = await readBody(req);
      const login = String(b.login || '').trim().toLowerCase();
      const name = String(b.name || '').trim();
      if (!login) return json(res, 400, { error: 'Укажите логин' });
      if (!name) return json(res, 400, { error: 'Укажите имя' });
      const dup = db.users.find((x) => x.login.toLowerCase() === login && x.id !== b.id);
      if (dup) return json(res, 400, { error: 'Такой логин уже занят' });

      const menuScope = Array.isArray(b.menuScope) ? b.menuScope.map(String) : [];
      const deviceScope = Array.isArray(b.deviceScope) ? b.deviceScope.map(String) : [];
      const twoFA = b.twoFA && typeof b.twoFA === 'object'
        ? { enabled: !!b.twoFA.enabled, secret: b.twoFA.secret || null }
        : { enabled: false, secret: null };

      const existing = b.id ? db.users.find((x) => x.id === b.id) : null;
      let saved;
      if (existing) {
        // Обновление: пароль меняем только если прислан непустой
        existing.name = name;
        existing.role = b.role === 'admin' ? 'admin' : 'viewer';
        existing.menuScope = menuScope;
        existing.deviceScope = deviceScope;
        existing.twoFA = twoFA;
        if (b.password && String(b.password).length > 0) existing.passHash = hashPass(String(b.password));
        saved = existing;
        pushEvent('info', 'system', `Пользователь «${name}» обновлён (админ: ${user.login})`);
      } else {
        if (!b.password || String(b.password).length < 4) return json(res, 400, { error: 'Пароль от 4 символов' });
        saved = {
          id: uid('u'), login, name,
          role: b.role === 'admin' ? 'admin' : 'viewer',
          menuScope, deviceScope,
          builtIn: false, twoFA,
          passHash: hashPass(String(b.password)),
          createdAt: Date.now(),
        };
        db.users.push(saved);
        pushEvent('info', 'system', `Создан пользователь «${name}» (${login}, роль: ${saved.role})`);
      }
      saveDb();
      return json(res, 200, publicUser(saved));
    }

    const um = p.match(/^\/api\/users\/([^/]+)$/);
    if (um && method === 'DELETE' && isAdmin) {
      const target = db.users.find((x) => x.id === um[1]);
      if (!target) return json(res, 404, { error: 'Пользователь не найден' });
      if (target.builtIn) return json(res, 400, { error: 'Системного администратора удалить нельзя' });
      if (target.id === user.id) return json(res, 400, { error: 'Нельзя удалить самого себя' });
      db.users = db.users.filter((x) => x.id !== um[1]);
      db.sessions = (db.sessions || []).filter((s) => s.userId !== um[1]);
      pushEvent('warn', 'system', `Пользователь «${target.name}» удалён (админ: ${user.login})`);
      saveDb();
      return json(res, 200, { ok: true });
    }

    if (p === '/api/state' && method === 'GET') {
      const deviceScope = Array.isArray(user.deviceScope) ? user.deviceScope : [];
      const menuScope = Array.isArray(user.menuScope) ? user.menuScope : [];
      const devices = isAdmin ? db.devices : db.devices.filter((d) => deviceScope.includes(d.type));
      const agentsRaw = isAdmin || menuScope.includes('agents') ? db.agents : [];
      const agents = agentsRaw.map((a) => ({
        id: a.id, name: a.name, ip: a.ip, relayUrl: a.relayUrl || '', glancesUrl: a.glancesUrl || '',
        pingTargets: a.pingTargets || [], targets: a.targets || [], tags: a.tags || [],
        favorite: !!a.favorite, pingsFavorite: !!a.pingsFavorite, pingsShowcase: !!a.pingsShowcase,
        statsView: a.statsView === 'bars' || a.statsView === 'ws' ? a.statsView : '',
        online: !!a.online, latency: a.latency ?? null,
        onlineSince: a.onlineSince || 0, lastSeen: a.lastSeen || 0, lastPoll: a.lastPoll || 0,
        lastGlances: a.lastGlances || 0, glancesError: a.glancesError || null,
        glancesLatest: a.glancesLatest || null, glances: (a.glances || []).slice(-120),
        latHist: (a.latHist || []).slice(-120), createdAt: a.createdAt,
      }));
      return json(res, 200, { devices, agents, tags: db.tags, events: (db.events || []).slice(0, 100), settings: db.settings, users: isAdmin ? db.users.map(publicUser) : undefined });
    }

    // ── устройства ──
    if (p === '/api/devices' && method === 'DELETE' && isAdmin) {
      const removed = db.devices.length;
      db.devices = [];
      pushEvent('warn', 'system', `Очищен список устройств: удалено ${removed} шт.`);
      saveDb();
      return json(res, 200, { ok: true, removed });
    }
    if (p === '/api/devices' && method === 'POST' && isAdmin) {
      const b = await readBody(req);
      const d = {
        id: uid(), name: String(b.name || '').trim() || b.address, type: b.type || 'ping', address: String(b.address || '').trim(),
        port: b.port ?? null, path: b.path || '', method: b.method ?? null, body: b.body ?? null,
        interval: Math.max(5, parseInt(b.interval, 10) || 60),
        tags: Array.isArray(b.tags) ? b.tags : [], favorite: !!b.favorite, showcase: !!b.showcase,
        status: 'unknown', latency: null, baseline: null, history: [], fails: 0,
        lastCheck: 0, lastChange: Date.now(), checking: false, approx: false, createdAt: Date.now(),
      };
      db.devices.push(d);
      pushEvent('info', 'device', `Добавлено устройство «${d.name}» (${d.address})`);
      saveDb();
      queue.push(() => runDeviceCheck(d)); runNext();
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
    if (m && method === 'POST') {
      const d = db.devices.find((x) => x.id === m[1]);
      if (!d) return json(res, 404, { error: 'устройство не найдено' });
      await runDeviceCheck(d);
      return json(res, 200, { ok: d.status !== 'down', latency: d.latency });
    }

    // ── агенты ──
    if (p === '/api/agents' && method === 'POST' && isAdmin) {
      const b = await readBody(req);
      const ip = String(b.ip || '').trim();
      const a = {
        id: uid(), name: String(b.name || '').trim() || ('ПК ' + ip), ip,
        relayUrl: String(b.relayUrl || '').trim(), glancesUrl: String(b.glancesUrl || '').trim(),
        pingTargets: Array.isArray(b.pingTargets) ? b.pingTargets.map(String) : [],
        tags: Array.isArray(b.tags) ? b.tags : [],
        targets: [], favorite: !!b.favorite, pingsFavorite: !!b.pingsFavorite, pingsShowcase: !!b.pingsShowcase,
        statsView: b.statsView === 'bars' || b.statsView === 'ws' ? b.statsView : '',
        online: false, latency: null, onlineSince: 0, lastSeen: 0, lastPoll: 0, lastGlances: 0,
        latHist: [], glances: [], glancesLatest: null, glancesError: null, createdAt: Date.now(),
      };
      db.agents.push(a);
      pushEvent('info', 'agent', `Добавлен агент «${a.name}» (${a.ip})`);
      saveDb();
      queue.push(() => pollAgent(a)); runNext();
      return json(res, 200, a);
    }
    m = p.match(/^\/api\/agents\/([^/]+)$/);
    if (m && isAdmin) {
      const a = db.agents.find((x) => x.id === m[1]);
      if (!a) return json(res, 404, { error: 'агент не найден' });
      if (method === 'PUT' || method === 'PATCH') {
        const b = await readBody(req);
        for (const k of ['name', 'ip', 'relayUrl', 'glancesUrl', 'favorite', 'pingsFavorite', 'pingsShowcase']) if (k in b) a[k] = b[k];
        if ('statsView' in b) a.statsView = b.statsView === 'bars' || b.statsView === 'ws' ? b.statsView : '';
        if (Array.isArray(b.pingTargets)) a.pingTargets = b.pingTargets.map(String);
        if (Array.isArray(b.tags)) a.tags = b.tags.map(String);
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
    if (m && method === 'POST') {
      const a = db.agents.find((x) => x.id === m[1]);
      if (!a) return json(res, 404, { error: 'агент не найден' });
      await pollAgent(a);
      return json(res, 200, a);
    }
    m = p.match(/^\/api\/agents\/([^/]+)\/glances$/);
    if (m && method === 'GET') {
      const a = db.agents.find((x) => x.id === m[1]);
      if (!a) return json(res, 404, { error: 'агент не найден' });
      if (!isAdmin && !user.scope.includes('agent')) return json(res, 403, { error: 'нет доступа' });
      const ranges = { '5m': 3e5, '30m': 18e5, '3h': 108e5, '24h': 864e5, '7d': 6048e5, '30d': 2592e6 };
      const rq = url.searchParams.get('range');
      const range = ranges[rq] ? rq : '3h';
      const cutoff = Date.now() - ranges[range];
      let pts = (a.glances || []).filter((x) => x.t >= cutoff);
      if (pts.length > 1200) {
        const bw = ranges[range] / 1200;
        const out = []; let cur = null, bi = -1;
        for (const pt of pts) {
          const idx = Math.floor((pt.t - cutoff) / bw);
          if (idx !== bi) { if (cur) out.push(cur); cur = { ...pt }; bi = idx; }
          else { for (const k of ['cpu', 'gpu', 'ram', 'rx', 'tx', 'cput', 'ssdt', 'diskUsed']) { if (pt[k] == null) continue; cur[k] = cur[k] == null ? pt[k] : Math.round(((cur[k] + pt[k]) / 2) * 10) / 10; } cur.t = pt.t; }
        }
        if (cur) out.push(cur);
        pts = out;
      }
      return json(res, 200, { range, retentionDays: 30, points: pts });
    }
    m = p.match(/^\/api\/agents\/([^/]+)\/test-glances$/);
    if (m && method === 'GET') {
      const a = db.agents.find((x) => x.id === m[1]);
      if (!a) return json(res, 404, { error: 'агент не найден' });
      try {
        const g = await collectGlances(a.glancesUrl);
        return json(res, 200, { ok: true, url: a.glancesUrl, via: g.via, values: glancesPoint(g, Date.now()) });
      } catch (e) {
        return json(res, 200, { ok: false, url: a.glancesUrl || '', via: null, error: e.message || String(e) });
      }
    }

    // ── теги ──
    if (p === '/api/tags' && method === 'POST' && isAdmin) {
      const b = await readBody(req);
      const t = { id: uid(), label: String(b.label || '').trim(), color: b.color || '#9a8cfa' };
      if (!t.label) return json(res, 400, { error: 'укажите название' });
      if (db.tags.some((x) => x.label.toLowerCase() === t.label.toLowerCase())) return json(res, 400, { error: 'такой тег уже есть' });
      db.tags.push(t);
      pushEvent('info', 'system', `Создан тег «${t.label}»`);
      saveDb();
      return json(res, 200, t);
    }
    m = p.match(/^\/api\/tags\/([^/]+)$/);
    if (m && method === 'DELETE' && isAdmin) {
      db.tags = db.tags.filter((x) => x.id !== m[1]);
      saveDb();
      return json(res, 200, { ok: true });
    }

    // ── настройки ──
    if (p === '/api/settings' && method === 'PUT' && isAdmin) {
      const b = await readBody(req);
      db.settings = { ...db.settings, ...b,
        intervals: { ...db.settings.intervals, ...(b.intervals || {}) },
        notifications: { ...db.settings.notifications, ...(b.notifications || {}) },
        mirror: { ...db.settings.mirror, ...(b.mirror || {}) },
        showcase: { ...db.settings.showcase, ...(b.showcase || {}) },
      };
      const prevPort = db.settings.showcase.port;
      saveDb();
      if (db.settings.showcase.port !== prevPort) startShowcase();
      pushEvent('info', 'system', 'Системные настройки сохранены');
      return json(res, 200, db.settings);
    }
    if (p === '/api/showcase/restart' && method === 'POST' && isAdmin) {
      startShowcase();
      return json(res, 200, { ok: true, port: db.settings.showcase.port });
    }
    if (p === '/api/mirror/sync-now' && method === 'POST' && isAdmin) {
      const mm = db.settings.mirror;
      if (!mm.enabled || !mm.url || !mm.secret) return json(res, 200, { ok: false, error: 'зеркало не настроено' });
      try {
        await fetch(String(mm.url).replace(/\/+$/, '') + '/api/mirror/ingest', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Mirror-Secret': mm.secret },
          body: JSON.stringify({ ts: Date.now(), version: VERSION, devices: showcaseDevices(), agents: showcaseAgents() }),
        });
        return json(res, 200, { ok: true });
      } catch (e) { return json(res, 200, { ok: false, error: e.message || 'не удалось отправить' }); }
    }

    return json(res, 404, { error: 'Маршрут не найден' });
  } catch (e) {
    console.error('[pluto] ошибка запроса:', e);
    return json(res, 500, { error: 'внутренняя ошибка' });
  }
});

server.listen(HTTP_PORT, () => {
  console.log(`[pluto] core v${VERSION} · консоль и API: http://0.0.0.0:${HTTP_PORT}`);
});
startShowcase();
