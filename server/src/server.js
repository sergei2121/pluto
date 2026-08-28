// ─── PLUTO Core: HTTP API, движок опроса, шлюз агентов, статика ─────────────
import http from 'node:http';
import https from 'node:https';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import dgram from 'node:dgram';
import { fileURLToPath } from 'node:url';
import {
  loadDb, saveDb, pushEvent, uid, authUser, hashPass, verifyPass,
  issueSession, attachWs, DEFAULT_SETTINGS,
} from './lib.js';

const VERSION = '1.8.4';
const db = loadDb();
const HTTP_PORT = Number(process.env.HTTP_PORT || 8080);
const AGENT_PORT = Number(process.env.AGENT_PORT || 8443);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = process.env.WEB_DIR || path.join(HERE, '..', 'web');
// В образе исходник агента лежит в /app/agent, при локальном запуске — в корне репозитория
const AGENT_DIR =
  process.env.AGENT_DIR ||
  (fs.existsSync(path.resolve(HERE, '..', 'agent', 'PlutoAgent.cs'))
    ? path.resolve(HERE, '..', 'agent')
    : path.resolve(HERE, '..', '..', 'agent'));

function text(res, code, body, type) {
  res.writeHead(code, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}

function hostIp(req) {
  const h = (req.headers['x-forwarded-host'] || req.headers.host || '').split(':')[0];
  return h || '127.0.0.1';
}

// ─── PowerShell-установщик агента (генерируется при отдаче) ─────────────────
// Механизм 1.8.0: сервер и токен записываются в agent.conf, служба запускает exe
// БЕЗ аргументов. Установщик сам ждёт подключения и печатает вердикт.
const INSTALL_PS = `# PLUTO Agent — установщик для Windows (запускать от имени администратора)
param(
  [string]$Token = "",
  [string]$Server = "__WS_URL__",
  [string]$Name = "pluto-agent"
)
$ErrorActionPreference = 'Stop'
$base = "__HTTP_BASE__"
$dir  = "$env:ProgramData\\pluto"
$src  = "$dir\\PlutoAgent.cs"
$exe  = "$dir\\pluto-agent.exe"
$conf = "$dir\\agent.conf"

if (-not $Token) { $Token = Read-Host "Введите токен агента (консоль: Агенты -> Создать токен)" }
if (-not $Token) { Write-Host "Токен обязателен." -ForegroundColor Red; exit 1 }

Write-Host "[pluto] каталог: $dir"
New-Item -ItemType Directory -Force -Path $dir | Out-Null

# Конфигурация: сервер и токен. Служба читает их отсюда, exe стартует без аргументов.
@"
server=$Server
token=$Token
metrics=15
lan=300
aida64=http://127.0.0.1:8090/
"@ | Set-Content -Path $conf -Encoding ASCII
Write-Host "[pluto] конфигурация записана: $conf"

Write-Host "[pluto] скачиваю исходник агента с ядра..."
Invoke-WebRequest -UseBasicParsing -Uri "$base/agent/PlutoAgent.cs" -OutFile $src

# Самопроверка: устаревший образ ядра отдаёт HTML вместо исходника
$head = (Get-Content $src -TotalCount 1 -Encoding UTF8 -ErrorAction SilentlyContinue)
if ($head -match '<!doctype|<html') {
  Write-Host "[pluto] ОШИБКА: ядро отдало HTML, а не исходник — образ устарел." -ForegroundColor Red
  Write-Host "        На сервере: git pull && docker compose up -d --build" -ForegroundColor Yellow
  exit 1
}
if (-not (Select-String -Path $src -Pattern 'class Program' -Quiet)) {
  Write-Host "[pluto] ОШИБКА: скачанный файл не похож на исходник агента." -ForegroundColor Red
  exit 1
}

$csc = Get-ChildItem "$env:WINDIR\\Microsoft.NET\\Framework64\\*\\csc.exe" -ErrorAction SilentlyContinue |
       Sort-Object FullName -Descending | Select-Object -First 1
if (-not $csc) { throw "csc.exe не найден. Нужен .NET Framework 4.x." }

# Сначала остановить и удалить старую службу — она держит exe открытым
Write-Host "[pluto] останавливаю и удаляю старую службу (если была)..."
sc.exe stop $Name 2>$null | Out-Null
sc.exe delete $Name 2>$null | Out-Null
$w = 0
while ((Get-Service $Name -ErrorAction SilentlyContinue) -and $w -lt 15) { Start-Sleep -Seconds 1; $w++ }

Write-Host "[pluto] компилирую агент под вашу Windows ($($csc.FullName))..."
& $csc.FullName /nologo /target:exe /out:$exe /reference:System.Management.dll /reference:System.ServiceProcess.dll /reference:System.Net.Http.dll $src
if ($LASTEXITCODE -ne 0) { throw "компиляция не удалась (код $LASTEXITCODE). Полный вывод выше." }
Write-Host "[pluto] скомпилировано: $exe"

$binPath = $exe
Write-Host "[pluto] создаю службу Windows '$Name'..."
try { New-Service -Name $Name -BinaryPathName $binPath -DisplayName "PLUTO Agent" -StartupType Automatic -ErrorAction Stop | Out-Null }
catch { throw "не удалось создать службу: $($_.Exception.Message). Запустите PowerShell от имени администратора." }

# Самовосстановление: если процесс агента упадёт, Windows перезапустит его
# автоматически (через 5 с, затем 15 с, затем 60 с; счётчик сбрасывается раз в сутки)
sc.exe failure $Name reset= 86400 actions= restart/5000/restart/15000/restart/60000 | Out-Null

$svc = Get-CimInstance Win32_Service -Filter "Name='$Name'"
Write-Host "[pluto] путь службы: $($svc.PathName)"
if (-not (Select-String -Path $conf -Pattern '^token=' -Quiet)) { throw "конфигурация не записана — повторите установку." }

Write-Host "[pluto] запускаю службу..."
if (Test-Path "$dir\\agent.log") { Move-Item "$dir\\agent.log" "$dir\\agent.old.log" -Force -ErrorAction SilentlyContinue }
Start-Service $Name

Write-Host "[pluto] жду подключения агента к ядру (до 15 с)..."
$ok = $false
for ($i = 0; $i -lt 15; $i++) {
  Start-Sleep -Seconds 1
  if (Test-Path "$dir\\agent.log") {
    $tail = Get-Content "$dir\\agent.log" -Tail 25 -Encoding UTF8 -ErrorAction SilentlyContinue
    if ($tail -match "подключено к") { $ok = $true; break }
  }
}
Write-Host ""
if ($ok) {
  Write-Host "[pluto] АГЕНТ В СЕТИ — метрики уже поступают в консоль PLUTO." -ForegroundColor Green
} else {
  Write-Host "[pluto] Агент пока не подключился. Последние строки лога:" -ForegroundColor Yellow
  if (Test-Path "$dir\\agent.log") { Get-Content "$dir\\agent.log" -Tail 8 -Encoding UTF8 -ErrorAction SilentlyContinue }
  Write-Host "[pluto] Проверьте: Test-NetConnection <IP-сервера> -Port 8443" -ForegroundColor Yellow
}
Write-Host "[pluto] сервер : $Server"
Write-Host "[pluto] конфиг : $conf"
Write-Host "[pluto] лог    : $dir\\agent.log"
`;

// ─── Проверки устройств (настоящие) ─────────────────────────────────────────

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

function checkHttp(addr, port, pth, method, body, timeoutMs) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let url;
    try {
      url = /^https?:\/\//.test(addr) ? addr : `http://${addr}${port ? ':' + port : ''}${pth ? (pth.startsWith('/') ? pth : '/' + pth) : '/'}`;
    } catch { return resolve({ ok: false, latency: 0 }); }
    const opts = { method: method || 'GET', signal: AbortSignal.timeout(timeoutMs) };
    if (body && method !== 'GET') opts.body = body;
    fetch(url, opts)
      .then(() => resolve({ ok: true, latency: Date.now() - t0 }))
      .catch(() => resolve({ ok: false, latency: 0 }));
  });
}

function checkRtsp(url, timeoutMs) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const m = /^rtsp:\/\/([^:/]+)(?::(\d+))?/.exec(url || '');
    if (!m) return resolve({ ok: false, latency: 0 });
    const host = m[1], port = Number(m[2] || 554);
    const sock = net.connect({ host, port, timeout: timeoutMs });
    const done = (ok) => { try { sock.destroy(); } catch {} resolve({ ok, latency: ok ? Date.now() - t0 : 0 }); };
    sock.on('connect', () => sock.write(`OPTIONS ${url} RTSP/1.0\r\nCSeq: 1\r\n\r\n`));
    sock.on('data', (d) => done(/RTSP\/1\.0 200/.test(d.toString())));
    sock.on('timeout', () => done(false));
    sock.on('error', () => done(false));
  });
}

function checkSip(uri, timeoutMs) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const m = /^sip:([^@]+@)?([^:/]+)(?::(\d+))?/.exec(uri || '');
    if (!m) return resolve({ ok: false, latency: 0 });
    const host = m[2], port = Number(m[3] || 5060);
    const sock = dgram.createSocket('udp4');
    const timer = setTimeout(() => { try { sock.close(); } catch {} resolve({ ok: false, latency: 0 }); }, timeoutMs);
    const req = `OPTIONS ${uri} SIP/2.0\r\nVia: SIP/2.0/UDP pluto;branch=z9hG4bK${uid()}\r\nFrom: <sip:pluto@monitor>;tag=${uid()}\r\nTo: <${uri}>\r\nCall-ID: ${uid()}@pluto\r\nCSeq: 1 OPTIONS\r\nMax-Forwards: 5\r\nContent-Length: 0\r\n\r\n`;
    sock.on('message', (msg) => { clearTimeout(timer); try { sock.close(); } catch {} resolve({ ok: /SIP\/2\.0 200/.test(msg.toString()), latency: Date.now() - t0 }); });
    sock.on('error', () => { clearTimeout(timer); resolve({ ok: false, latency: 0 }); });
    sock.send(req, port, host);
  });
}

async function runDeviceCheck(d) {
  const s = db.settings;
  let res;
  switch (d.type) {
    case 'ping': res = await checkPing(d.address, s.timeoutMs); break;
    case 'http': res = await checkHttp(d.address, d.port, d.path, 'GET', null, s.timeoutMs); break;
    case 'api': res = await checkHttp(d.address, d.port, d.path, d.method || 'POST', d.body || '', s.timeoutMs); break;
    case 'rtsp': res = await checkRtsp(d.address, s.timeoutMs); break;
    case 'sip': res = await checkSip(d.address, s.timeoutMs); break;
    default: res = { ok: false, latency: 0 };
  }
  const now = Date.now();
  d.history = [...(d.history || []), res.ok ? res.latency : -1].slice(-48);
  if (!res.ok) {
    d.fails = (d.fails || 0) + 1;
    if (d.fails >= s.failThreshold && d.status !== 'down') {
      d.status = 'down'; d.latency = null; d.lastChange = now;
      pushEvent('crit', 'device', `${d.name} (${d.address}) — потеря связи (${d.fails} сб. подряд)`);
    }
  } else {
    const degraded = d.baseline && res.latency > d.baseline * s.degradeFactor && res.latency > s.degradeMinMs;
    const prev = d.status;
    d.status = degraded ? 'degraded' : 'up';
    d.latency = res.latency;
    d.fails = 0;
    d.baseline = d.baseline ? Math.round(d.baseline * 0.8 + res.latency * 0.2) : res.latency;
    if (prev === 'down') pushEvent('ok', 'device', `${d.name} (${d.address}) — связь восстановлена`);
    else if (degraded && prev !== 'degraded') pushEvent('warn', 'device', `${d.name}: деградация ${res.latency} мс (база ~${d.baseline} мс)`);
    if (d.status !== prev) d.lastChange = now;
  }
  d.lastCheck = now;
  saveDb();
  console.log(`[pluto] ${d.type.toUpperCase()} ${d.address} → ${res.ok ? 'ok ' + res.latency + ' мс' : 'недоступен'}`);
  return res;
}

// Планировщик: интервалы устройств + оффлайн-детектор агентов
setInterval(() => {
  const now = Date.now();
  for (const d of db.devices) {
    const iv = Math.max(5, d.interval || db.settings.intervals[d.type] || 60) * 1000;
    if (!d.checking && now - (d.lastCheck || 0) >= iv) {
      d.checking = true;
      runDeviceCheck(d).finally(() => { d.checking = false; });
    }
  }
  const hb = Math.max(5, db.settings.heartbeat) * 1000;
  for (const a of db.agents) {
    if (a.online && now - (a.lastSeen || 0) > hb * 3) {
      a.online = false;
      pushEvent('warn', 'agent', `Агент ${a.name || a.hostname} не выходит на связь`);
      saveDb();
    }
  }
  // Glances: периодический опрос веб-страниц (интервал из настроек, по умолчанию 60 с)
  const giv = Math.max(15, (db.settings.intervals && db.settings.intervals.glances) || 60) * 1000;
  for (const g of db.glances || []) {
    if (!g.scraping && now - (g.lastScrape || 0) >= giv) {
      g.scraping = true;
      scrapeGlances(g).finally(() => { g.scraping = false; });
    }
  }
  // автоочистка архива Glances (старше 30 дней) — раз в час по расписанию
  if (now - lastGlancesCleanup > 3600000) {
    lastGlancesCleanup = now;
    glancesCleanup(now);
  }
}, 1000);

// ─── Шлюз агентов (WebSocket на :8443) ───────────────────────────────────────

const agentServer = http.createServer();
agentServer.on('connection', (sock) => {
  console.log(`[pluto] шлюз: TCP-соединение от ${sock.remoteAddress}`);
});
attachWs(agentServer, (conn, url, remoteIp) => {
  const token = url.searchParams.get('token');
  const agent = db.agents.find((a) => a.token === token);
  if (!agent) {
    console.log(`[pluto] шлюз: НЕВЕРНЫЙ ТОКЕН от ${remoteIp}`);
    conn.send(JSON.stringify({ type: 'error', text: 'invalid token' }));
    conn.close();
    return;
  }
  const wasOffline = !agent.online;
  agent.online = true;
  agent.lastSeen = Date.now();
  agent.ip = remoteIp || agent.ip;
  if (wasOffline) pushEvent('ok', 'agent', `Агент ${agent.name || agent.hostname} подключился (${agent.ip})`);
  conn.send(JSON.stringify({
    type: 'config', metrics: db.settings.metrics, lanScan: db.settings.lanScan,
    aida64: agent.aida64Url || null,
  }));

  conn.onMessage((raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    agent.lastSeen = Date.now();
    if (!agent.online) { agent.online = true; pushEvent('ok', 'agent', `Агент ${agent.name || agent.hostname} снова в сети`); }
    if (msg.type === 'hello') {
      Object.assign(agent, { hostname: msg.hostname, os: msg.os, version: msg.version });
    } else if (msg.type === 'metrics' && msg.data) {
      Object.assign(agent, msg.data);
      agent.history = [...(agent.history || []), {
        t: Date.now(),
        cpu: msg.data.cpuLoad || 0,
        ram: msg.data.ramTotal ? ((msg.data.ramUsed || 0) / msg.data.ramTotal) * 100 : 0,
      }].slice(-120);
      // данные с сенсорной веб-страницы AIDA64 (хранение — 60 дней)
      if (msg.aida && typeof msg.aida === 'object') {
        const now = Date.now();
        const pt = {
          t: now,
          cpuUsage: numOrNull(msg.aida.cpuUsage), cpuTemp: numOrNull(msg.aida.cpuTemp),
          ram: numOrNull(msg.aida.ram), ssdTemp: numOrNull(msg.aida.ssdTemp),
          diskC: numOrNull(msg.aida.diskC), tx: numOrNull(msg.aida.tx),
          rx: numOrNull(msg.aida.rx), uptimeSec: numOrNull(msg.aida.uptimeSec),
        };
        if (AIDA_KEYS.some((k) => pt[k] != null)) {
          agent.aidaLatest = pt;
          aidaAppend(agent, pt);
        }
      }
    } else if (msg.type === 'lan') {
      agent.networks = msg.networks || [];
      agent.lastScan = Date.now();
    }
    saveDb();
  });
  conn.onClose(() => {
    agent.online = false;
    pushEvent('warn', 'agent', `Агент ${agent.name || agent.hostname} отключился`);
    saveDb();
  });
});
agentServer.listen(AGENT_PORT, () => console.log(`[pluto] шлюз агентов: ws://0.0.0.0:${AGENT_PORT}/ws`));

// ─── REST API + статика ──────────────────────────────────────────────────────

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json', '.webp': 'image/webp', '.txt': 'text/plain' };

function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
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

const publicUser = (u) => ({ id: u.id, name: u.name, role: u.role, scope: u.scope, builtIn: u.builtIn, createdAt: u.createdAt });

// ─── Телеметрия AIDA64: хранение 60 дней с ярусным сжатием ──────────────────
// < 24 ч — каждая точка; 24 ч–7 дн — укрупнение до минут; > 7 дн — до часов.
// Бюджет ≈ 15 тыс. точек на агента при полном 60-дневном окне.

const AIDA_RETENTION_MS = 60 * 86400000;
const AIDA_MAX_POINTS = 20000;
const AIDA_KEYS = ['cpuUsage', 'cpuTemp', 'ram', 'ssdTemp', 'diskC', 'tx', 'rx', 'uptimeSec'];
const AIDA_RANGE_MS = {
  '5m': 5 * 60000, '30m': 30 * 60000, '3h': 3 * 3600000, '24h': 24 * 3600000,
  '7d': 7 * 86400000, '30d': 30 * 86400000, '60d': 60 * 86400000,
};

const numOrNull = (v) => (typeof v === 'number' && isFinite(v) ? v : null);

function mergeAidaPoints(dst, src) {
  for (const k of AIDA_KEYS) {
    if (src[k] == null) continue;
    dst[k] = dst[k] == null ? src[k] : Math.round(((dst[k] + src[k]) / 2) * 10) / 10;
  }
  dst.t = src.t;
}

function aidaAppend(agent, pt) {
  if (!Array.isArray(agent.aida)) agent.aida = [];
  const arr = agent.aida;
  const last = arr[arr.length - 1];
  if (last) {
    const age = pt.t - last.t;
    const sameMinute = Math.floor(last.t / 60000) === Math.floor(pt.t / 60000);
    const sameHour = Math.floor(last.t / 3600000) === Math.floor(pt.t / 3600000);
    if ((age > 7 * 86400000 && sameHour) || (age > 86400000 && sameMinute)) {
      mergeAidaPoints(last, pt); // данные старше суток/недели уплотняем в бакеты
    } else {
      arr.push(pt);
    }
  } else {
    arr.push(pt);
  }
  if (arr.length > AIDA_MAX_POINTS) arr.splice(0, arr.length - AIDA_MAX_POINTS);
  const cutoff = pt.t - AIDA_RETENTION_MS; // хранение — 60 дней
  let i = 0;
  while (i < arr.length && arr[i].t < cutoff) i++;
  if (i > 0) arr.splice(0, i);
}

// ─── Glances (Bars): удалённый опрос веб-страниц, хранение 30 дней ──────────
// Ядро само ходит по HTTP на страницу Glances (агент не нужен — удобно для
// Rocky Linux и любых машин, где Glances запущен в веб-режиме, порт 61208).
// Разбираются столбцы: CPU (+user/system/iowait/idle/irq/nice/steal),
// MEM (%, total/used/free), Rx/s, Tx/s и строка Package (температура ЦП).

const GLANCES_KEYS = ['cpu', 'user', 'system', 'iowait', 'idle', 'irq', 'nice', 'steal', 'mem', 'memTotal', 'memUsed', 'memFree', 'rx', 'tx', 'pkg'];
const GLANCES_RETENTION_MS = 30 * 86400000; // 30 дней
const GLANCES_MAX_POINTS = 20000;
const GLANCES_RANGE_MS = {
  '5m': 5 * 60000, '30m': 30 * 60000, '3h': 3 * 3600000, '24h': 24 * 3600000,
  '7d': 7 * 86400000, '30d': 30 * 86400000,
};
let lastGlancesCleanup = 0;

function fetchText(rawUrl, timeoutMs = 7000) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(rawUrl); } catch { return reject(new Error('некорректный адрес мониторинга')); }
    const lib = u.protocol === 'https:' ? https : http;
    const r = lib.get(u, { timeout: timeoutMs }, (res) => {
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
    r.on('timeout', () => r.destroy(new Error('таймаут запроса страницы')));
    r.on('error', (e) => reject(e));
  });
}

/** HTML → плоский текст (теги, &nbsp;, сущности убираются) */
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

/** total/used/free: "15.5G" → ГБ */
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

/** Rx/s и Tx/s: сумма по всем интерфейсам; Glances отдаёт b/s с суффиксами K/M/G (SI) → КБ/с */
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
  const pt = {
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
  };
  const found = GLANCES_KEYS.filter((k) => pt[k] != null);
  return { pt, found };
}

function mergeGlancesPoints(dst, src) {
  for (const k of GLANCES_KEYS) {
    if (src[k] == null) continue;
    dst[k] = dst[k] == null ? src[k] : Math.round(((dst[k] + src[k]) / 2) * 10) / 10;
  }
  dst.t = src.t;
}

function glancesAppend(dev, pt) {
  if (!Array.isArray(dev.history)) dev.history = [];
  const arr = dev.history;
  const last = arr[arr.length - 1];
  if (last) {
    const age = pt.t - last.t;
    const sameMin = Math.floor(last.t / 60000) === Math.floor(pt.t / 60000);
    const sameHour = Math.floor(last.t / 3600000) === Math.floor(pt.t / 3600000);
    // ярусное сжатие: > 7 дней — почасовые бакеты, > 1 суток — поминутные
    if ((age > 7 * 86400000 && sameHour) || (age > 86400000 && sameMin)) mergeGlancesPoints(last, pt);
    else arr.push(pt);
  } else {
    arr.push(pt);
  }
  if (arr.length > GLANCES_MAX_POINTS) arr.splice(0, arr.length - GLANCES_MAX_POINTS);
}

async function scrapeGlances(dev) {
  const now = Date.now();
  try {
    const html = await fetchText(dev.url);
    const { pt, found } = parseGlances(html);
    pt.t = Date.now();
    if (found.length === 0) {
      dev.lastError = 'страница загружена, но показатели Glances не найдены — проверьте адрес мониторинга';
      dev.online = false;
      dev.lastScrape = now;
      saveDb();
      return { point: null, error: dev.lastError };
    }
    const missing = GLANCES_KEYS.filter((k) => pt[k] == null);
    dev.lastError = missing.length ? `распознано ${found.length}/${GLANCES_KEYS.length} показателей (нет: ${missing.join(', ')})` : null;
    dev.online = true;
    dev.latest = pt;
    dev.lastScrape = now;
    glancesAppend(dev, pt);
    saveDb();
    return { point: pt, error: dev.lastError };
  } catch (e) {
    dev.lastError = e.message || 'ошибка запроса';
    dev.online = false;
    dev.lastScrape = now;
    saveDb();
    return { point: null, error: dev.lastError };
  }
}

/** Плановая автоочистка: удаляет точки старше 30 дней (вызывается каждый час) */
function glancesCleanup(now) {
  const cutoff = now - GLANCES_RETENTION_MS;
  let changed = false;
  for (const g of db.glances || []) {
    if (Array.isArray(g.history) && g.history.length && g.history[0].t < cutoff) {
      let i = 0;
      while (i < g.history.length && g.history[i].t < cutoff) i++;
      g.history.splice(0, i);
      changed = true;
    }
  }
  if (changed) saveDb();
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  const method = req.method;

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    });
    return res.end();
  }

  try {
    // ── публичные (до авторизации) ──
    if (p === '/api/health') return json(res, 200, { ok: true, name: 'pluto-core', version: VERSION, console: 'api' });
    if (p === '/api/version') return json(res, 200, { version: VERSION });

    // ── раздача Windows-агента (публично: качает «голая» PowerShell) ──
    if (p === '/agent/PlutoAgent.cs' && method === 'GET') {
      const f = path.join(AGENT_DIR, 'PlutoAgent.cs');
      if (!fs.existsSync(f)) return text(res, 404, 'PlutoAgent.cs не найден', 'text/plain; charset=utf-8');
      return text(res, 200, '\uFEFF' + fs.readFileSync(f, 'utf8'), 'text/plain; charset=utf-8');
    }
    if (p === '/agent/install.ps1' && method === 'GET') {
      const ip = hostIp(req);
      const body = INSTALL_PS
        .replace(/__HTTP_BASE__/g, `http://${ip}:${HTTP_PORT}`)
        .replace(/__WS_URL__/g, `ws://${ip}:${AGENT_PORT}/ws`);
      return text(res, 200, '\uFEFF' + body, 'text/plain; charset=utf-8');
    }

    if (p === '/api/auth/login' && method === 'POST') {
      const { name, password } = await readBody(req);
      const user = db.users.find((u) => u.name === name);
      if (!user || !verifyPass(password || '', user.passHash)) return json(res, 401, { error: 'Неверный логин или пароль' });
      pushEvent('info', 'system', `Вход в систему: ${user.name}`);
      return json(res, 200, { token: issueSession(user.id), user: publicUser(user) });
    }

    // восстановление сессии по токену (консоль вызывает при каждой загрузке страницы)
    if (p === '/api/auth/me' && method === 'GET') {
      const u = authUser(req);
      if (!u) return json(res, 401, { error: 'Сессия истекла' });
      return json(res, 200, publicUser(u));
    }

    // неизвестные /agent/* — не отдаём HTML консоли
    if (method === 'GET' && p.startsWith('/agent/')) return text(res, 404, 'not found', 'text/plain');

    // ── статика веб-консоли (без авторизации) + подпись ядра ──
    if (method === 'GET' && !p.startsWith('/api/')) {
      let file = path.normalize(path.join(WEB_DIR, p === '/' ? 'index.html' : p));
      if (!file.startsWith(WEB_DIR)) return json(res, 403, { error: 'forbidden' });
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(WEB_DIR, 'index.html');
      if (!fs.existsSync(file)) {
        return text(res, 200, 'PLUTO Core работает. Веб-консоль не найдена: пересоберите образ (docker compose up -d --build).', 'text/plain; charset=utf-8');
      }
      const ext = path.extname(file);
      let body = fs.readFileSync(file);
      if (ext === '.html') {
        body = Buffer.from(String(body).replace('<head>', `<head><script>window.__PLUTO_CORE__={v:"${VERSION}"}</script>`));
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      } else {
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'public, max-age=31536000, immutable' });
      }
      return res.end(body);
    }

    // ── всё остальное требует авторизации ──
    const user = authUser(req);
    if (!user) return json(res, 401, { error: 'Требуется авторизация' });
    const isAdmin = user.role === 'admin';

    // ── состояние (полное для админа, фильтрованное для наблюдателя) ──
    if (p === '/api/state' && method === 'GET') {
      const visible = isAdmin ? db.devices : db.devices.filter((d) => user.scope.includes(d.type));
      const agentsRaw = isAdmin || user.scope.includes('agent') ? db.agents : [];
      // 60-дневная история AIDA64 отдаётся только отдельным эндпоинтом — не грузим её в каждый поллинг
      const agents = agentsRaw.map((a) => ({ ...a, aida: undefined }));
      // Glances: список отдаём без тяжёлой истории (она — в /api/glances/:id/history)
      const glancesVisible = isAdmin || user.scope.includes('glances') ? db.glances : [];
      const glances = glancesVisible.map((g) => ({ ...g, history: undefined, scraping: undefined }));
      return json(res, 200, {
        devices: visible,
        agents,
        glances,
        tags: db.tags,
        events: db.events,
        settings: db.settings,
        users: isAdmin ? db.users.map(publicUser) : undefined,
      });
    }

    // ── устройства ──
    if (p === '/api/devices' && method === 'POST' && isAdmin) {
      const b = await readBody(req);
      const d = {
        id: uid(), name: b.name || b.address, type: b.type || 'ping', address: b.address || '',
        port: b.port ?? null, path: b.path || '', method: b.method || null, body: b.body || null,
        interval: Math.max(5, Number(b.interval) || db.settings.intervals[b.type] || 60),
        tags: b.tags || [], favorite: false, status: 'unknown', latency: null, baseline: null,
        history: [], fails: 0, lastCheck: 0, lastChange: Date.now(), checking: false, approx: false, createdAt: Date.now(),
      };
      db.devices.push(d);
      pushEvent('info', 'device', `Добавлено устройство ${d.name} (${d.type.toUpperCase()})`);
      saveDb();
      return json(res, 200, d);
    }
    let m = p.match(/^\/api\/devices\/([^/]+)$/);
    if (m && isAdmin) {
      const d = db.devices.find((x) => x.id === m[1]);
      if (!d) return json(res, 404, { error: 'устройство не найдено' });
      if (method === 'PUT' || method === 'PATCH') {
        const b = await readBody(req);
        for (const k of ['name', 'type', 'address', 'port', 'path', 'method', 'body', 'interval', 'tags', 'favorite'])
          if (k in b) d[k] = b[k];
        pushEvent('info', 'device', `Настройки «${d.name}» обновлены`);
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
      return json(res, 200, { result: r });
    }

    // ── агенты (токены, правка, удаление) ──
    if (p === '/api/agents/token' && method === 'POST' && isAdmin) {
      const b = await readBody(req);
      const a = {
        id: uid(), name: b.name || 'agent-' + uid().slice(0, 4), hostname: '', token: uid() + uid(),
        ip: '', os: '', version: '', online: false,
        aida64Url: 'http://127.0.0.1:8090/', aida: [], aidaLatest: null,
        cpuLoad: 0, cpuCores: 0, cpuTemp: 0,
        ramUsed: 0, ramTotal: 0, ramTemp: 0, disks: [], rxBytes: 0, txBytes: 0, rxRate: 0, txRate: 0,
        networks: [], lastSeen: 0, lastMetrics: 0, lastScan: 0, history: [], favorite: false, createdAt: Date.now(),
      };
      db.agents.push(a);
      pushEvent('info', 'agent', `Создан токен для агента «${a.name}»`);
      saveDb();
      return json(res, 200, { agent: a, token: a.token });
    }
    m = p.match(/^\/api\/agents\/([^/]+)$/);
    if (m && isAdmin) {
      const a = db.agents.find((x) => x.id === m[1]);
      if (!a) return json(res, 404, { error: 'агент не найден' });
      if (method === 'PUT' || method === 'PATCH') {
        const b = await readBody(req);
        for (const k of ['name', 'favorite', 'aida64Url']) if (k in b) a[k] = b[k];
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
    // ── история AIDA64 за выбранный период (5м…60д), прореженная до ≤1500 точек ──
    m = p.match(/^\/api\/agents\/([^/]+)\/aida$/);
    if (m && method === 'GET') {
      const a = db.agents.find((x) => x.id === m[1]);
      if (!a) return json(res, 404, { error: 'агент не найден' });
      if (!isAdmin && !user.scope.includes('agent')) return json(res, 403, { error: 'нет доступа к агентам' });
      const rq = url.searchParams.get('range');
      const range = AIDA_RANGE_MS[rq] ? rq : '5m';
      const cutoff = Date.now() - AIDA_RANGE_MS[range];
      let pts = (a.aida || []).filter((x) => x.t >= cutoff);
      if (pts.length > 1500) {
        const bw = AIDA_RANGE_MS[range] / 1500;
        const out = [];
        let cur = null, bi = -1;
        for (const pt of pts) {
          const idx = Math.floor((pt.t - cutoff) / bw);
          if (idx !== bi) { if (cur) out.push(cur); cur = { ...pt }; bi = idx; }
          else mergeAidaPoints(cur, pt);
        }
        if (cur) out.push(cur);
        pts = out;
      }
      return json(res, 200, { range, retentionDays: 60, points: pts });
    }
    m = p.match(/^\/api\/agents\/([^/]+)\/retoken$/);
    if (m && method === 'POST' && isAdmin) {
      const a = db.agents.find((x) => x.id === m[1]);
      if (!a) return json(res, 404, { error: 'агент не найден' });
      a.token = uid() + uid();
      pushEvent('info', 'agent', `Токен агента «${a.name}» перевыпущен`);
      saveDb();
      return json(res, 200, { token: a.token });
    }

    // ── Glances (Bars): веб-страницы серверов, агент не нужен ──
    const canGlances = isAdmin || user.scope.includes('glances');
    if (p === '/api/glances' && method === 'GET' && canGlances) {
      return json(res, 200, { devices: db.glances.map((g) => ({ ...g, history: undefined, scraping: undefined })) });
    }
    if (p === '/api/glances' && method === 'POST' && isAdmin) {
      const b = await readBody(req);
      const name = String(b.name || '').trim();
      const url = String(b.url || '').trim();
      if (!name) return json(res, 400, { error: 'укажите имя сервера' });
      if (!/^https?:\/\//i.test(url)) return json(res, 400, { error: 'адрес мониторинга должен начинаться с http:// или https://' });
      const g = {
        id: uid(), name, url, serverLink: String(b.serverLink || '').trim(),
        createdAt: Date.now(), lastScrape: 0, lastError: null, online: false, latest: null, history: [],
      };
      db.glances.push(g);
      pushEvent('info', 'system', `Добавлен сервер Glances «${name}» (${url})`);
      saveDb();
      scrapeGlances(g); // первый опрос — сразу, чтобы данные появились без ожидания интервала
      return json(res, 200, g);
    }
    m = p.match(/^\/api\/glances\/([^/]+)$/);
    if (m && isAdmin) {
      const g = db.glances.find((x) => x.id === m[1]);
      if (!g) return json(res, 404, { error: 'сервер Glances не найден' });
      if (method === 'PUT' || method === 'PATCH') {
        const b = await readBody(req);
        for (const k of ['name', 'url', 'serverLink']) if (k in b) g[k] = String(b[k] ?? '').trim();
        pushEvent('info', 'system', `Настройки Glances «${g.name}» обновлены`);
        saveDb();
        return json(res, 200, g);
      }
      if (method === 'DELETE') {
        db.glances = db.glances.filter((x) => x.id !== g.id);
        pushEvent('info', 'system', `Сервер Glances «${g.name}» удалён (архив очищен)`);
        saveDb();
        return json(res, 200, { ok: true });
      }
    }
    m = p.match(/^\/api\/glances\/([^/]+)\/scrape$/);
    if (m && method === 'POST' && isAdmin) {
      const g = db.glances.find((x) => x.id === m[1]);
      if (!g) return json(res, 404, { error: 'сервер Glances не найден' });
      const r = await scrapeGlances(g);
      return json(res, 200, r);
    }
    m = p.match(/^\/api\/glances\/([^/]+)\/history$/);
    if (m && method === 'GET' && canGlances) {
      const g = db.glances.find((x) => x.id === m[1]);
      if (!g) return json(res, 404, { error: 'сервер Glances не найден' });
      const rq = url.searchParams.get('range');
      const range = GLANCES_RANGE_MS[rq] ? rq : '5m';
      const cutoff = Date.now() - GLANCES_RANGE_MS[range];
      let pts = (g.history || []).filter((x) => x.t >= cutoff);
      if (pts.length > 1500) { // прореживание для графика
        const bw = GLANCES_RANGE_MS[range] / 1500;
        const out = [];
        let cur = null, bi = -1;
        for (const pt of pts) {
          const idx = Math.floor((pt.t - cutoff) / bw);
          if (idx !== bi) { if (cur) out.push(cur); cur = { ...pt }; bi = idx; }
          else mergeGlancesPoints(cur, pt);
        }
        if (cur) out.push(cur);
        pts = out;
      }
      return json(res, 200, { range, retentionDays: 30, points: pts });
    }

    // ── теги ──
    if (p === '/api/tags' && method === 'POST' && isAdmin) {
      const b = await readBody(req);
      const t = { id: uid(), label: b.label || 'тег', color: b.color || '#9a8cfa' };
      db.tags.push(t);
      saveDb();
      return json(res, 200, t);
    }
    m = p.match(/^\/api\/tags\/([^/]+)$/);
    if (m && method === 'DELETE' && isAdmin) {
      db.tags = db.tags.filter((x) => x.id !== m[1]);
      db.devices.forEach((d) => (d.tags = (d.tags || []).filter((t) => t !== m[1])));
      saveDb();
      return json(res, 200, { ok: true });
    }

    // ── настройки ──
    if (p === '/api/settings' && method === 'PUT' && isAdmin) {
      const b = await readBody(req);
      db.settings = { ...db.settings, ...b, intervals: { ...db.settings.intervals, ...(b.intervals || {}) }, notifications: { ...db.settings.notifications, ...(b.notifications || {}) } };
      pushEvent('info', 'system', 'Системные настройки сохранены');
      saveDb();
      return json(res, 200, db.settings);
    }

    // ── пользователи ──
    if (p === '/api/users' && method === 'POST' && isAdmin) {
      const b = await readBody(req);
      if (!b.name || !b.password) return json(res, 400, { error: 'нужны name и password' });
      if (db.users.some((u) => u.name === b.name)) return json(res, 400, { error: 'такой логин уже есть' });
      const u = { id: uid(), name: b.name, role: b.role || 'viewer', scope: b.scope || [], passHash: hashPass(b.password), builtIn: false, createdAt: Date.now() };
      db.users.push(u);
      pushEvent('info', 'system', `Создан пользователь ${u.name} (${u.role})`);
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
        if (b.scope) u.scope = b.scope;
        if (b.password) u.passHash = hashPass(b.password);
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

    return json(res, 404, { error: 'Маршрут не найден' });
  } catch (e) {
    console.error('[pluto] ошибка запроса:', e);
    return json(res, 500, { error: 'внутренняя ошибка' });
  }
});

server.listen(HTTP_PORT, () => {
  console.log(`[pluto] core v${VERSION} · консоль и API: http://0.0.0.0:${HTTP_PORT} · health: /api/health`);
});
