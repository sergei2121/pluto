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
import { loginRateLimiter } from './middleware/rateLimiter.js';
import telemetryCollectors from './telemetry/collectors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VERSION = '2.0.0';
const WEB_DIR = path.join(__dirname, '..', 'web');
const HTTP_PORT = parseInt(process.env.HTTP_PORT || '8080', 10);

const db = loadDb();

// ─── Health Check для зависимостей (пункт 20) ────────────────────────────────

const healthChecks = {
  database: async () => {
    try {
      const currentDb = loadDb();
      return { 
        status: currentDb ? 'ok' : 'error', 
        details: { devices: currentDb.devices?.length || 0, agents: currentDb.agents?.length || 0 }
      };
    } catch (e) {
      return { status: 'error', details: { error: e.message } };
    }
  },
  filesystem: async () => {
    try {
      await fs.promises.access(WEB_DIR, fs.constants.R_OK);
      return { status: 'ok', details: { webDir: WEB_DIR } };
    } catch (e) {
      return { status: 'error', details: { error: e.message } };
    }
  },
  ping: async () => {
    return new Promise((resolve) => {
      execFile('ping', ['-c', '1', '-W', '1', '127.0.0.1'], (err) => {
        resolve({ 
          status: err ? 'degraded' : 'ok', 
          details: { pingAvailable: !err } 
        });
      });
    });
  },
};

export async function getHealthStatus() {
  const results = await Promise.allSettled([
    healthChecks.database(),
    healthChecks.filesystem(),
    healthChecks.ping(),
  ]);
  
  const checks = {
    database: results[0].status === 'fulfilled' ? results[0].value : { status: 'error', details: { error: 'check failed' } },
    filesystem: results[1].status === 'fulfilled' ? results[1].value : { status: 'error', details: { error: 'check failed' } },
    ping: results[2].status === 'fulfilled' ? results[2].value : { status: 'error', details: { error: 'check failed' } },
  };
  
  const overallStatus = Object.values(checks).every(c => c.status === 'ok') 
    ? 'healthy' 
    : Object.values(checks).some(c => c.status === 'error') 
      ? 'unhealthy' 
      : 'degraded';
  
  return {
    status: overallStatus,
    timestamp: Date.now(),
    version: VERSION,
    checks,
  };
}

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
  await applyResult(d, res);
}

async function applyResult(d, res) {
  const now = Date.now();
  const cfg = db.settings;
  d.lastCheck = now;
  d.checking = false;

  if (!res.ok) {
    d.fails = (d.fails || 0) + 1;
    d.history = [...(d.history || []), -1].slice(-48);
    if (d.fails >= cfg.failThreshold && d.status !== 'down') {
      // Устройство ушло в офлайн — фиксируем время начала офлайна
      d.offlineSince = d.offlineSince || now;
      d.status = 'down'; d.latency = null; d.lastChange = now;
      await pushEvent('crit', 'device', `${d.name} (${d.address}) — потеря связи`);
      notify('down', `PLUTO: авария`, `${d.name} (${d.address}) — потеря связь`);
    }
    await saveDb();
    return;
  }

  // Успешный пинг — обновляем lastSuccess
  d.lastSuccess = now;
  
  // Вычисляем время в офлайне за последние 30 дня перед восстановлением
  let offlineDuration30d = d.offlineDuration30d || 0;
  if (d.status === 'down' && d.offlineSince) {
    const offlineTime = now - d.offlineSince;
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    // Добавляем к накопленной длительности, ограничивая 30 днями
    offlineDuration30d = Math.min(thirtyDaysMs, offlineDuration30d + offlineTime);
  }

  const baseline = d.baseline ?? res.latency;
  d.baseline = Math.round((baseline * 0.9 + res.latency * 0.1) * 10) / 10;
  const degraded = res.latency > d.baseline * cfg.degradeFactor && res.latency > cfg.degradeMinMs;
  const status = degraded ? 'degraded' : 'up';
  const prev = d.status;
  d.status = status; d.latency = res.latency; d.fails = 0;
  d.history = [...(d.history || []), res.latency].slice(-48);

  if (prev === 'down') { await pushEvent('ok', 'device', `${d.name} — связь восстановлена`); notify('recover', 'PLUTO: восстановление', `${d.name} снова в строю`); }
  else if (degraded && prev !== 'degraded') { await pushEvent('warn', 'device', `${d.name}: деградация ${res.latency} мс`); notify('degraded', 'PLUTO: деградация', `${d.name}: ${res.latency} мс`); }
  if (status !== prev) d.lastChange = now;
  
  // Сбрасываем таймер офлайна при восстановлении, сохраняем накопленную длительность
  d.offlineSince = null;
  d.offlineDuration30d = offlineDuration30d;
  await saveDb();
}

// ─── Relay-пинги (устройства внутри VLAN/NAT) ──────────────────────────────

async function relayPing(agent, targets) {
  if (!agent.relayUrl) return [];
  const base = String(agent.relayUrl).replace(/\/+$/, '');
  const url = base + '/ping?targets=' + encodeURIComponent(targets.join(','));
  const now = Date.now();
  try {
    const txt = await fetchText(url, 15000);
    const arr = JSON.parse(txt);
    if (Array.isArray(arr)) {
      return arr.map((r) => {
        const alive = !!r.alive;
        // При успешном пинге обновляем lastSuccess, при ошибке — ставим null (будет сохранено из предыдущих результатов в caller)
        const result = { 
          ip: r.ip, 
          alive, 
          latency: r.latencyMs != null ? r.latencyMs : (r.latency != null ? r.latency : null),
          offlineSince: !alive ? now : undefined,
          offlineDuration30d: 0,
          lastSuccess: null
        };
        if (alive) {
          result.lastSuccess = now;
        }
        return result;
      });
    }
  } catch { /* relay недоступен */ }
  // При ошибке relay возвращаем пустой массив — предыдущие результаты будут использованы в caller
  return [];
}

// ─── Netdata (телеметрия) ───────────────────────────────────────────────────

/**
 * Собирает метрики из Netdata API v2.
 * Использует функцию collectNetdata из telemetry/collectors.js
 */
async function collectNetdata(url) {
  return await telemetryCollectors.collectNetdata(url, fetchText);
}

function parseUptime(s) {
  const m = /(\\d+):(\\d+):(\\d+)/.exec(String(s));
  if (!m) return null;
  return parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseInt(m[3]);
}

/** Собирает телеметрию из Netdata API. */
async function collectTelemetry(agent) {
  if (agent.netdataUrl) {
    const g = await telemetryCollectors.collectNetdata(agent.netdataUrl, fetchText);
    return { ...g, via: 'netdata' };
  }
  throw new Error('Нет доступного источника телеметрии (укажите Netdata URL)');
}

function netdataPoint(g, t) {
  return { 
    t, 
    cpu: g.cpu, 
    ram: g.ram, 
    rx: g.netRx, 
    tx: g.netTx, 
    cput: g.cpuTemp, 
    swap: g.swap ?? null,
    diskRead: g.diskRead ?? null,
    diskWrite: g.diskWrite ?? null,
  };
}

// ─── Уведомления ────────────────────────────────────────────────────────────
// Пункт 23: улучшенная обработка ошибок с логированием по уровням

const notificationLogger = {
  error: (msg, ctx) => console.error(`[pluto][notifications][ERROR] ${msg}`, JSON.stringify(ctx)),
  warn: (msg, ctx) => console.warn(`[pluto][notifications][WARN] ${msg}`, JSON.stringify(ctx)),
  info: (msg, ctx) => console.info(`[pluto][notifications][INFO] ${msg}`, JSON.stringify(ctx)),
};

async function notify(kind, title, body) {
  const n = db.settings.notifications;
  
  // Проверка включённых типов уведомлений
  if (kind === 'down' && !n.on.down) return;
  if (kind === 'degraded' && !n.on.degraded) return;
  if (kind === 'recover' && !n.on.recover) return;
  if (kind === 'agentOff' && !n.on.agentOff) return;
  if (kind === 'agentOn' && !n.on.agentOn) return;
  if (kind === 'threshold' && !n.on.threshold) return;

  // Telegram уведомления
  if (n.telegram.enabled && n.telegram.botToken && n.telegram.chatId) {
    const text = `*${title}*\n\n${body}`;
    const url = `https://api.telegram.org/bot${n.telegram.botToken}/sendMessage`;
    
    try {
      const https = await import('node:https');
      const data = JSON.stringify({
        chat_id: n.telegram.chatId,
        text,
        parse_mode: 'Markdown',
      });
      
      await new Promise((resolve, reject) => {
        const req = https.request(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': data.length,
          },
          timeout: 5000,
        }, (res) => {
          let responseBody = '';
          res.on('data', (chunk) => (responseBody += chunk));
          res.on('end', () => {
            if (res.statusCode === 200) {
              notificationLogger.info('Telegram уведомление отправлено', { kind, title });
              resolve();
            } else {
              notificationLogger.error(`Telegram API вернул ошибку ${res.statusCode}`, { 
                kind, title, statusCode: res.statusCode, body: responseBody.slice(0, 200) 
              });
              resolve(); // Не прерываем выполнение при ошибке Telegram
            }
          });
        });
        
        req.on('error', (e) => {
          notificationLogger.error('Ошибка отправки Telegram уведомления', { 
            kind, title, error: e.message, code: e.code 
          });
          resolve();
        });
        
        req.on('timeout', () => {
          req.destroy();
          notificationLogger.error('Таймаут отправки Telegram уведомления', { kind, title });
          resolve();
        });
        
        req.write(data);
        req.end();
      });
    } catch (e) {
      notificationLogger.error('Критическая ошибка при отправке Telegram', { 
        kind, title, error: e.message 
      });
    }
  }
  
  // Email уведомления (заготовка для будущей реализации)
  if (n.email.enabled && n.email.smtp && n.email.from && n.email.to) {
    notificationLogger.info('Email уведомление (требуется реализация SMTP)', {
      kind, title, from: n.email.from, to: n.email.to
    });
  }
  
  // Push уведомления (заготовка для будущей реализации)
  if (n.push.enabled) {
    notificationLogger.info('Push уведомление (требуется реализация Web Push)', { kind, title });
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

async function scheduleDeviceCheck(d) {
  d.checking = true;
  await runDeviceCheck(d);
}

setInterval(() => {
  const now = Date.now();
  for (const d of db.devices) {
    if (d.checking) continue;
    const iv = Math.max(5, d.interval || 60) * 1000;
    if (now - (d.lastCheck || 0) >= iv) {
      queue.push(() => scheduleDeviceCheck(d));
    }
  }

  // Принудительный опрос агентов с тегом "Bars" каждые 20 секунд
  const barsInterval = 20 * 1000;
  for (const a of db.agents) {
    if (a.tags && a.tags.includes('Bars')) {
      if (now - (a.lastPoll || 0) >= barsInterval) {
        a.lastPoll = now;
        queue.push(() => pollAgent(a));
      }
    }
  }

  const aiv = Math.max(10, db.settings.intervals.agent || 30) * 1000;
  for (const a of db.agents) {
    if (a.tags && a.tags.includes('Bars')) continue; // уже добавлен выше
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
  if (ping.ok && !wasOnline) { await pushEvent('ok', 'agent', `Агент «${agent.name}» в сети`); notify('agentOn', 'PLUTO: агент в сети', agent.name); }
  if (!ping.ok && wasOnline) { await pushEvent('warn', 'agent', `Агент «${agent.name}» недоступен`); notify('agentOff', 'PLUTO: агент офлайн', agent.name); }

  // 2) relay-пинги локальных устройств. Стабильность: при сбое relay
  //    сохраняем последний успешный результат, чтобы не «мигало».
  if (agent.relayUrl && (agent.pingTargets || []).length) {
    const out = [];
    let anyOk = false;
    for (const tgt of agent.pingTargets) {
      const rangeStr = typeof tgt === 'string' ? tgt : (tgt.range || '');
      const targetName = typeof tgt === 'object' && tgt.name ? tgt.name : '';
      const ips = expandTargets(rangeStr);
      const results = await relayPing(agent, ips);
      if (results.length) anyOk = true;
      // Ищем предыдущие результаты по range или имени цели
      const prev = (agent.targets || []).find((t) => t.range === rangeStr || t.target === rangeStr || t.name === targetName);
      // Если нет новых результатов, используем предыдущие (сохраняем lastSuccess)
      const finalResults = results.length ? results : (Array.isArray(prev?.results) ? prev.results : []);
      
      // Для офлайн-устройств сохраняем lastSuccess и обновляем offlineSince/offlineDuration30d
      if (finalResults.length && Array.isArray(finalResults)) {
        finalResults.forEach((r, idx) => {
          // Сохраняем lastSuccess из предыдущих результатов если устройство офлайн и у него нет lastSuccess
          // Это нужно чтобы при отключении устройства не показывало 0 вместо даты последнего пинга
          if (!r.alive && r.lastSuccess === undefined && Array.isArray(prev?.results) && prev.results[idx] && prev.results[idx].lastSuccess > 0) {
            r.lastSuccess = prev.results[idx].lastSuccess;
          }
          
          // Обновляем offlineSince для устройств в офлайне
          if (!r.alive) {
            // Если устройство уже было в офлайне, сохраняем время начала
            if (prev?.results?.[idx] && !prev.results[idx].alive && prev.results[idx].offlineSince) {
              r.offlineSince = prev.results[idx].offlineSince;
            } else if (!r.offlineSince) {
              // Устройство только что ушло в офлайн
              r.offlineSince = now;
            }
            
            // Копируем накопленную длительность офлайна
            if (prev?.results?.[idx]?.offlineDuration30d) {
              r.offlineDuration30d = prev.results[idx].offlineDuration30d;
            }
          } else {
            // Устройство восстановилось — вычисляем длительность офлайна
            if (r.offlineSince) {
              const offlineTime = now - r.offlineSince;
              const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
              r.offlineDuration30d = Math.min(thirtyDaysMs, (r.offlineDuration30d || 0) + offlineTime);
              r.offlineSince = null;
            }
          }
        });
      }
      
      out.push({ target: targetName || rangeStr, name: targetName, range: rangeStr, lastCheck: now, results: finalResults });
    }
    agent.targets = out;
  }

  // 3) Телеметрия (Netdata, отдельный интервал, хранение 30 дней)
  const giv = Math.max(10, db.settings.intervals.netdata || 20) * 1000;
  const hasTelemetry = !!agent.netdataUrl;
  if (hasTelemetry && now - (agent.lastNetdata || 0) >= giv) {
    agent.lastNetdata = now;
    try {
      const g = await collectTelemetry(agent);
      // Сохраняем снимок телеметрии
      agent.netdataLatest = {
        t: now, cpu: g.cpu, cpuCores: g.cpuCores || [], gpu: g.gpu, gpuTemp: g.gpuTemp,
        ram: g.ram, ramUsedGB: g.ramUsedGB, ramTotalGB: g.ramTotalGB, swap: g.swap,
        load1: g.load1, load5: g.load5, load15: g.load15, cput: g.cput, ssdt: g.ssdt,
        hddTemp: g.hddTemp, disks: g.disks || [], adapters: g.adapters || [],
        mainAdapter: g.mainAdapter, rx: g.rx, tx: g.tx, sensors: g.sensors || [],
        uptimeSec: g.uptimeSec, mainFsUsed: g.mainFsUsed, diskRead: g.diskRead,
        diskWrite: g.diskWrite, fanSpeed: g.fanSpeed, battery: g.battery,
        batteryTimeLeft: g.batteryTimeLeft, batteryIsCharging: g.batteryIsCharging,
        wifiSSID: g.wifiSSID, wifiQuality: g.wifiQuality, wifiSignal: g.wifiSignal,
        wifiBitrate: g.wifiBitrate, processes: g.processes || [], containers: g.containers || [],
        cloudProvider: g.cloudProvider, via: g.via,
      };
      // Добавляем точку в историю (сокращённая версия)
      const pt = netdataPoint(g, now);
      agent.netdata = [...(agent.netdata || []), pt].slice(-4320); // 30 дней при 20 сек интервале
      agent.netdataError = null;
      
      // Статистика количества дисков большой емкости (>= 1TB) для агентов с тегом "Bars"
      const isBarsAgent = agent.tags && agent.tags.includes('Bars');
      let currentDiskCount = 0;
      
      if (g.disks && Array.isArray(g.disks)) {
        // Фильтруем диски: только >= 1TB, не системный и не SSD/NVMe
        const largeDisks = g.disks.filter((d) => {
          // Пропускаем системный диск (монтируется в "/" или корневой раздел Windows)
          const isSystemDisk = d.mnt === '/' || /^[A-Za-z]:\\?$/.test(d.mnt || '');
          // Проверяем размер >= 1000 GB (1TB)
          const isLargeCapacity = d.sizeGB != null && d.sizeGB >= 1000;
          // Проверяем, что это не SSD/NVMe (по названию точки монтирования или устройства)
          const isSSDorNVMe = /ssd|nvme/i.test(d.mnt || '') || /ssd|nvme/i.test(d.device || '');
          return !isSystemDisk && isLargeCapacity && !isSSDorNVMe;
        });
        
        currentDiskCount = largeDisks.length;
        
        // Для агентов с тегом "Bars" проверяем уменьшение количества дисков
        if (isBarsAgent) {
          const prevDiskCount = agent._lastDiskCount ?? null;
          
          if (prevDiskCount != null && currentDiskCount > 0 && currentDiskCount < prevDiskCount) {
            await pushEvent('crit', 'agent', `Агент «${agent.name}»: уменьшение количества дисков большой емкости (${prevDiskCount} → ${currentDiskCount})`);
            notify('threshold', 'PLUTO: Диски', `Агент «${agent.name}»: уменьшение количества дисков >= 1TB с ${prevDiskCount} до ${currentDiskCount}`);
          }
          
          agent._lastDiskCount = currentDiskCount;
        }
      }
    } catch (e) {
      agent.netdataError = 'Телеметрия: ' + (e.message || 'ошибка');
      console.log(`[Netdata] Ошибка сбора телеметрии для агента ${agent.name}: ${e.message}`);
    }
  }

  await saveDb();
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

// ─── Авто-отчет SLA (генерация и выгрузка по расписанию) ───────────────────

let lastSlaReportRun = 0;
setInterval(() => {
  const cfg = db.settings.slaReport;
  if (!cfg || !cfg.enabled || !cfg.outputPath) return;
  
  const now = new Date();
  const currentHour = now.getHours();
  const currentDayOfWeek = now.getDay(); // 0=воскресенье
  const currentDayOfMonth = now.getDate(); // 1-31
  
  // Проверяем расписание
  let shouldRun = false;
  if (cfg.schedule === 'daily') {
    shouldRun = currentHour === cfg.hour && now.getMinutes() === 0;
  } else if (cfg.schedule === 'weekly') {
    shouldRun = currentHour === cfg.hour && now.getMinutes() === 0 && currentDayOfWeek === (cfg.dayOfWeek ?? 0);
  } else if (cfg.schedule === 'monthly') {
    shouldRun = currentHour === cfg.hour && now.getMinutes() === 0 && currentDayOfMonth === (cfg.dayOfMonth ?? 1);
  }
  
  // Не запускать дважды в течение одного часа
  if (shouldRun && Date.now() - lastSlaReportRun < 3600000) shouldRun = false;
  
  if (shouldRun) {
    lastSlaReportRun = Date.now();
    generateAndSaveSlaReport(cfg.outputPath).catch(err => {
      console.error('[pluto] ошибка генерации SLA-отчета:', err.message);
    });
  }
}, 60000); // Проверка каждую минуту

async function generateAndSaveSlaReport(outputPath) {
  try {
    const fsMod = await import('node:fs');
    const pathMod = await import('node:path');
    
    // Создаём папку если не существует
    fsMod.mkdirSync(outputPath, { recursive: true });
    
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const fileName = `SLA-${dateStr}.json`;
    const filePath = pathMod.join(outputPath, fileName);
    
    // Генерируем SLA данные за последние 30 дней
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const slaData = db.devices.map(d => {
      const history = d.history || [];
      const totalChecks = history.length;
      const failedChecks = history.filter(h => h === -1).length;
      const uptimePct = totalChecks > 0 ? ((totalChecks - failedChecks) / totalChecks) * 100 : 100;
      const downCount = history.filter((h, i) => h === -1 && (i === 0 || history[i-1] !== -1)).length;
      const validLatencies = history.filter(h => h !== -1 && h != null);
      const avgLatency = validLatencies.length > 0 ? validLatencies.reduce((a, b) => a + b, 0) / validLatencies.length : null;
      
      return {
        id: d.id,
        name: d.name,
        type: d.type,
        uptimePct: Math.round(uptimePct * 100) / 100,
        downCount,
        avgLatency: avgLatency !== null ? Math.round(avgLatency * 100) / 100 : null,
        periodStart: thirtyDaysAgo,
        periodEnd: Date.now(),
      };
    });
    
    const report = {
      generatedAt: Date.now(),
      generatedAtISO: now.toISOString(),
      period: '30 days',
      devices: slaData,
      summary: {
        totalDevices: slaData.length,
        avgUptime: slaData.length > 0 
          ? Math.round((slaData.reduce((sum, d) => sum + d.uptimePct, 0) / slaData.length) * 100) / 100 
          : 0,
      },
    };
    
    fsMod.writeFileSync(filePath, JSON.stringify(report, null, 2), 'utf8');
    console.log(`[pluto] SLA-отчет сохранен: ${filePath}`);
    await pushEvent('info', 'system', `SLA-отчет сгенерирован: ${fileName}`);
  } catch (err) {
    console.error('[pluto] ошибка генерации SLA-отчета:', err.message);
    await pushEvent('crit', 'system', `Ошибка генерации SLA-отчета: ${err.message}`);
  }
}

// ─── HTTP-сервер и REST API ────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;
  const method = req.method;

  try {
    // ── публичные маршруты ──
    if (p === '/api/health') {
      const health = await getHealthStatus();
      return json(res, health.status === 'healthy' ? 200 : (health.status === 'degraded' ? 206 : 503), health);
    }
    if (p === '/api/version') return json(res, 200, { version: VERSION });

    if (p === '/api/auth/login' && method === 'POST') {
      // Применяем rate limiter для защиты от brute-force (пункт 1)
      loginRateLimiter(req, res, async () => {
        const b = await readBody(req);
        const u = db.users.find((x) => x.login.toLowerCase() === String(b.login || '').toLowerCase());
        if (!u || !verifyPass(String(b.pass || ''), u.passHash)) {
          await pushEvent('warn', 'auth', `Неудачная попытка входа: ${b.login || 'unknown'}`);
          return json(res, 401, { error: 'Неверный логин или пароль' });
        }
        await pushEvent('info', 'auth', `Успешный вход пользователя: ${u.login}`);
        const token = await issueSession(u.id);
        return json(res, 200, { token, user: publicUser(u) });
      });
      return;
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
        await pushEvent('info', 'system', `Пользователь «${name}» обновлён (админ: ${user.login})`);
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
        await pushEvent('info', 'system', `Создан пользователь «${name}» (${login}, роль: ${saved.role})`);
      }
      await saveDb();
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
      await pushEvent('warn', 'system', `Пользователь «${target.name}» удалён (админ: ${user.login})`);
      await saveDb();
      return json(res, 200, { ok: true });
    }

    if (p === '/api/state' && method === 'GET') {
      const deviceScope = Array.isArray(user.deviceScope) ? user.deviceScope : [];
      const menuScope = Array.isArray(user.menuScope) ? user.menuScope : [];
      const devices = isAdmin ? db.devices : db.devices.filter((d) => deviceScope.includes(d.type));
      const agentsRaw = isAdmin || menuScope.includes('agents') ? db.agents : [];
      const agents = agentsRaw.map((a) => ({
        id: a.id, name: a.name, ip: a.ip, relayUrl: a.relayUrl || '', netdataUrl: a.netdataUrl || '',
        pingTargets: a.pingTargets || [], targets: a.targets || [], tags: a.tags || [],
        favorite: !!a.favorite, pingsFavorite: !!a.pingsFavorite, pingsShowcase: !!a.pingsShowcase,
        statsView: a.statsView === 'bars' || a.statsView === 'ws' ? a.statsView : '',
        online: !!a.online, latency: a.latency ?? null,
        onlineSince: a.onlineSince || 0, lastSeen: a.lastSeen || 0, lastPoll: a.lastPoll || 0,
        lastNetdata: a.lastNetdata || 0, netdataError: a.netdataError || null,
        netdataLatest: a.netdataLatest || null, netdata: (a.netdata || []).slice(-120),
        latHist: (a.latHist || []).slice(-120), createdAt: a.createdAt,
      }));
      return json(res, 200, { devices, agents, tags: db.tags, events: (db.events || []).slice(0, 100), settings: db.settings, users: isAdmin ? db.users.map(publicUser) : undefined });
    }

    // ── устройства ──
    if (p === '/api/devices' && method === 'DELETE' && isAdmin) {
      const removed = db.devices.length;
      db.devices = [];
      await pushEvent('warn', 'system', `Очищен список устройств: удалено ${removed} шт.`);
      await saveDb();
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
      await pushEvent('info', 'device', `Добавлено устройство «${d.name}» (${d.address})`);
      await saveDb();
      queue.push(() => scheduleDeviceCheck(d)); runNext();
      return json(res, 200, d);
    }
    let m = p.match(/^\/api\/devices\/([^/]+)$/);
    if (m && isAdmin) {
      const d = db.devices.find((x) => x.id === m[1]);
      if (!d) return json(res, 404, { error: 'устройство не найдено' });
      if (method === 'PUT' || method === 'PATCH') {
        const b = await readBody(req);
        for (const k of ['name', 'type', 'address', 'port', 'path', 'method', 'body', 'interval', 'tags', 'favorite', 'showcase']) if (k in b) d[k] = b[k];
        await saveDb();
        return json(res, 200, d);
      }
      if (method === 'DELETE') {
        db.devices = db.devices.filter((x) => x.id !== d.id);
        await pushEvent('info', 'device', `Устройство «${d.name}» удалено`);
        await saveDb();
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
        relayUrl: String(b.relayUrl || '').trim(),
        netdataUrl: String(b.netdataUrl || '').trim() || undefined,
        pingTargets: Array.isArray(b.pingTargets) ? b.pingTargets.map(t => typeof t === 'string' ? { name: '', range: t } : t) : [],
        tags: Array.isArray(b.tags) ? b.tags : [],
        targets: [], favorite: !!b.favorite, pingsFavorite: !!b.pingsFavorite, pingsShowcase: !!b.pingsShowcase,
        statsView: b.statsView === 'bars' || b.statsView === 'ws' ? b.statsView : '',
        online: false, latency: null, onlineSince: 0, lastSeen: 0, lastPoll: 0, lastNetdata: 0,
        latHist: [], netdata: [], netdataLatest: null, netdataError: null, createdAt: Date.now(),
      };
      db.agents.push(a);
      await pushEvent('info', 'agent', `Добавлен агент «${a.name}» (${a.ip})`);
      await saveDb();
      queue.push(() => pollAgent(a)); runNext();
      return json(res, 200, a);
    }
    m = p.match(/^\/api\/agents\/([^/]+)$/);
    if (m && isAdmin) {
      const a = db.agents.find((x) => x.id === m[1]);
      if (!a) return json(res, 404, { error: 'агент не найден' });
      if (method === 'PUT' || method === 'PATCH') {
        const b = await readBody(req);
        for (const k of ['name', 'ip', 'relayUrl', 'favorite', 'pingsFavorite', 'pingsShowcase']) if (k in b) a[k] = b[k];
        if ('netdataUrl' in b) a.netdataUrl = String(b.netdataUrl || '').trim() || undefined;
        if ('statsView' in b) a.statsView = b.statsView === 'bars' || b.statsView === 'ws' ? b.statsView : '';
        if (Array.isArray(b.pingTargets)) {
          a.pingTargets = b.pingTargets.map(t => typeof t === 'string' ? { name: '', range: t } : t);
        }
        if (Array.isArray(b.tags)) a.tags = b.tags.map(String);
        await saveDb();
        return json(res, 200, a);
      }
      if (method === 'DELETE') {
        db.agents = db.agents.filter((x) => x.id !== a.id);
        await pushEvent('info', 'agent', `Агент «${a.name}» удалён`);
        await saveDb();
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
    m = p.match(/^\/api\/agents\/([^/]+)\/netdata$/);
    if (m && method === 'GET') {
      const a = db.agents.find((x) => x.id === m[1]);
      if (!a) return json(res, 404, { error: 'агент не найден' });
      if (!isAdmin && !user.scope.includes('agent')) return json(res, 403, { error: 'нет доступа' });
      const ranges = { '5m': 3e5, '30m': 18e5, '3h': 108e5, '24h': 864e5, '7d': 6048e5, '30d': 2592e6 };
      const rq = url.searchParams.get('range');
      const range = ranges[rq] ? rq : '3h';
      const cutoff = Date.now() - ranges[range];
      let pts = (a.netdata || []).filter((x) => x.t >= cutoff);
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
    m = p.match(/^\/api\/agents\/([^/]+)\/test-netdata$/);
    if (m && method === 'GET') {
      const a = db.agents.find((x) => x.id === m[1]);
      if (!a) return json(res, 404, { error: 'агент не найден' });
      try {
        const g = await collectTelemetry(a);
        return json(res, 200, { ok: true, url: a.netdataUrl || '', via: g.via, values: netdataPoint(g, Date.now()) });
      } catch (e) {
        return json(res, 200, { ok: false, url: a.netdataUrl || '', via: null, error: e.message || String(e) });
      }
    }

    // ── теги ──
    if (p === '/api/tags' && method === 'POST' && isAdmin) {
      const b = await readBody(req);
      const t = { id: uid(), label: String(b.label || '').trim(), color: b.color || '#9a8cfa' };
      if (!t.label) return json(res, 400, { error: 'укажите название' });
      if (db.tags.some((x) => x.label.toLowerCase() === t.label.toLowerCase())) return json(res, 400, { error: 'такой тег уже есть' });
      db.tags.push(t);
      await pushEvent('info', 'system', `Создан тег «${t.label}»`);
      await saveDb();
      return json(res, 200, t);
    }
    m = p.match(/^\/api\/tags\/([^/]+)$/);
    if (m && method === 'DELETE' && isAdmin) {
      db.tags = db.tags.filter((x) => x.id !== m[1]);
      await saveDb();
      return json(res, 200, { ok: true });
    }
    if (m && method === 'PATCH' && isAdmin) {
      const tag = db.tags.find((x) => x.id === m[1]);
      if (!tag) return json(res, 404, { error: 'тег не найден' });
      const b = await readBody(req);
      if ('label' in b) tag.label = String(b.label || '').trim();
      if ('color' in b) tag.color = String(b.color || '#9a8cfa');
      if ('visible' in b) tag.visible = !!b.visible;
      await saveDb();
      return json(res, 200, tag);
    }

    // ── настройки ──
    if (p === '/api/settings' && method === 'PUT' && isAdmin) {
      const b = await readBody(req);
      db.settings = { ...db.settings, ...b,
        intervals: { ...db.settings.intervals, ...(b.intervals || {}) },
        notifications: { ...db.settings.notifications, ...(b.notifications || {}) },
        mirror: { ...db.settings.mirror, ...(b.mirror || {}) },
        showcase: { ...db.settings.showcase, ...(b.showcase || {}) },
        slaReport: { ...db.settings.slaReport, ...(b.slaReport || {}) },
      };
      const prevPort = db.settings.showcase.port;
      await saveDb();
      if (db.settings.showcase.port !== prevPort) startShowcase();
      await pushEvent('info', 'system', 'Системные настройки сохранены');
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
