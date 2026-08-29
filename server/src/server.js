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

const VERSION = '1.9.3';
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
  // Агенты: сервер сам пингует IP (uptime), читает листинг AIDA64 и через relay
  // пингует устройства внутри VLAN. Интервал — из настроек (по умолчанию 30 с).
  const aiv = Math.max(10, (db.settings.intervals && db.settings.intervals.agent) || 30) * 1000;
  for (const a of db.agents) {
    // страховка: если опрос завис (флаг висит дольше 3 минут) — отпускаем его,
    // иначе агент замёрз бы навсегда
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

// ─── Агенты: модель без токенов ─────────────────────────────────────────────
// WebSocket-шлюз удалён. Агент больше не устанавливается и не подключается сам:
// сервер опрашивает его по HTTP (см. pollAgent выше) — пинг до IP, чтение
// листинга AIDA64 и relay-пинги устройств внутри VLAN через aida-monitor.

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

// ─── Агенты: сервер опрашивает сам (без токенов и установленной программы) ──
// Агент = IP + ссылка на листинг AIDA64. Сервер:
//   1) пингует IP — доступность и статистика uptime;
//   2) читает листинг AIDA64 и разбирает строку «CPUu 3%, CPU 42°C, RAM 25%, …»;
//   3) через relay-сервис aida-monitor (внутри VLAN агента) пингует локальные
//      устройства — обход разграничения VLAN.

const AGENT_AIDA_KEYS = ['cpuUsage', 'cpuTemp', 'ram', 'ssdTemp', 'diskC', 'usedSpaceC', 'tx', 'rx', 'uptimeSec'];

/** Очистка фрагмента RemoteSensor-страницы: сущности, теги, пробелы. */
function cleanAidaText(t) {
  return String(t)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&deg;C?;/gi, '°')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(+c))
    .replace(/\s+/g, ' ')
    .trim();
}

const AIDA_LABEL_MAP = {
  cpuu: 'cpuUsage', cpu: 'cpuTemp', ram: 'ram', ssd: 'ssdTemp',
  usec: 'diskC', usedspacec: 'usedSpaceC', tx: 'tx', rx: 'rx',
};

/** «01:01:48» / «2 д. 03:42:11» / «2d 03:42:11» → секунды. */
function uptimeToSec(v) {
  const s = String(v).trim();
  const hms = /(\d{1,3}):(\d{1,2}):(\d{1,2})/.exec(s);
  if (!hms) return null;
  const dm = /(\d+)\s*(?:д|d)\.?/i.exec(s);
  return (dm ? parseInt(dm[1], 10) : 0) * 86400 +
    parseInt(hms[1], 10) * 3600 + parseInt(hms[2], 10) * 60 + parseInt(hms[3], 10);
}

/**
 * Разбор страницы AIDA64 RemoteSensor.
 * Штатная структура — спаны Simple1…SimpleN, внутри каждого «Метка Значение»:
 *   <span id="Simple1">CPUu 5%</span>
 *   <span id="Simple6">UsedSpaceC 101&nbsp;GB</span>
 *   <span id="Simple9">Uptime 01:01:48</span>
 * Сначала значения вынимаются из спанов (детерминированно); если спанов нет —
 * запасной поиск меток по всему тексту страницы.
 */
function parseAidaLine(html) {
  const out = { cpuUsage: null, cpuTemp: null, ram: null, ssdTemp: null, diskC: null, usedSpaceC: null, tx: null, rx: null, uptimeSec: null };

  const spanRe = /<span[^>]*id="Simple\d+"[^>]*>([\s\S]*?)<\/span>/gi;
  const items = [];
  let m;
  while ((m = spanRe.exec(html))) {
    const t = cleanAidaText(m[1]);
    if (t) items.push(t);
  }

  const setVal = (label, numStr) => {
    const key = AIDA_LABEL_MAP[label.toLowerCase()];
    if (!key) return;
    const v = parseFloat(numStr.replace(',', '.'));
    if (isFinite(v)) out[key] = v;
  };

  if (items.length) {
    for (const it of items) {
      const um = /^uptime\s+(.+)$/i.exec(it);
      if (um) { out.uptimeSec = uptimeToSec(um[1]); continue; }
      const pm = /^([A-Za-z]+)\s*[:=]?\s*(-?\d+(?:[.,]\d+)?)/.exec(it);
      if (pm) setVal(pm[1], pm[2]);
    }
    return out;
  }

  // запасной вариант: поиск «Метка Значение» по очищенному тексту всей страницы
  const s = cleanAidaText(html);
  const num = (label) => {
    const re = new RegExp('\\b' + label + '\\b\\s*[:=]?\\s*(-?\\d+(?:[.,]\\d+)?)', 'i');
    const mm = s.match(re);
    return mm ? parseFloat(mm[1].replace(',', '.')) : null;
  };
  const um = s.match(/Uptime\s+((?:\d+\s*(?:д|d)\.?\s*)?\d{1,3}:\d{1,2}:\d{1,2})/i);
  out.cpuUsage = num('CPUu'); out.cpuTemp = num('CPU'); out.ram = num('RAM'); out.ssdTemp = num('SSD');
  out.diskC = num('UseC'); out.usedSpaceC = num('UsedSpaceC'); out.tx = num('TX'); out.rx = num('RX');
  out.uptimeSec = um ? uptimeToSec(um[1]) : null;
  return out;
}

/** Разворачивает цель в список IP: «1.2.3.4», «1.2.3.10-20», «1.2.3.0/24». */
function expandIps(target) {
  const t = String(target).trim();
  if (!t) return [];
  const range = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.)(\d{1,3})\s*-\s*(\d{1,3})$/.exec(t);
  if (range) {
    const out = [];
    const a = parseInt(range[2]), b = parseInt(range[3]);
    for (let i = Math.min(a, b); i <= Math.max(a, b) && out.length < 256; i++) out.push(range[1] + i);
    return out;
  }
  const cidr = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.)\d{1,3}\/(\d{1,2})$/.exec(t);
  if (cidr) {
    if (parseInt(cidr[2]) < 24) return []; // слишком большая сеть — не раскрываем
    const out = [];
    for (let i = 1; i < 255; i++) out.push(cidr[1] + i);
    return out;
  }
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(t) ? [t] : [];
}

/** Пинг списка IP через relay-сервис внутри VLAN агента. */
async function relayPing(agent, ips) {
  if (!agent.relayUrl || !ips.length) return [];
  const base = String(agent.relayUrl).replace(/\/+$/, '');
  const url = base + '/ping?targets=' + encodeURIComponent(ips.join(','));
  try {
    const txt = await fetchText(url, 15000);
    const arr = JSON.parse(txt);
    if (Array.isArray(arr)) {
      return arr.map((r) => ({
        ip: r.ip, alive: !!r.alive,
        latency: r.latencyMs != null ? r.latencyMs : (r.latency != null ? r.latency : null),
      }));
    }
  } catch { /* relay недоступен — вернём пустой результат */ }
  return [];
}

const isLoopbackUrl = (u) => /^https?:\/\/(127\.|localhost|0\.0\.0\.0|\[::1?\])/i.test(String(u || '').trim());

/**
 * Чтение листинга AIDA64 с выбором маршрута:
 *  - если адрес локальный (127.0.0.1/localhost) и у агента настроен relay —
 *    страницу открывает relay-сервис, стоящий на той же Windows-машине
 *    (из контейнера сервера 127.0.0.1 недостижим — это самая частая причина
 *    «данные не собираются»);
 *  - иначе сервер открывает страницу напрямую.
 * Возвращает { html, via, url } или бросает ошибку с человекочитаемой причиной.
 */
async function fetchAidaListing(agent) {
  const url = String(agent.aidaUrl || '').trim();
  if (!url) throw new Error('не задан адрес листинга AIDA64');

  if (isLoopbackUrl(url) && agent.relayUrl) {
    const base = String(agent.relayUrl).replace(/\/+$/, '');
    try {
      const html = await fetchText(base + '/fetch?url=' + encodeURIComponent(url), 15000);
      return { html, via: 'relay', url };
    } catch (e) {
      throw new Error('loopback-адрес, relay не ответил: ' + (e.message || e));
    }
  }
  if (isLoopbackUrl(url)) {
    throw new Error('адрес ' + url + ' локальный — сервер не может его открыть из контейнера. Укажите IP Windows-машины (http://<IP>:8090/) или настройте relay');
  }
  const html = await fetchText(url, 7000);
  return { html, via: 'direct', url };
}

/** Диагностика источника AIDA64 — то же, что делает опрос, но с подробным отчётом. */
async function testAidaSource(agent) {
  try {
    const { html, via, url } = await fetchAidaListing(agent);
    const parsed = parseAidaLine(html);
    parsed.t = Date.now();
    const recognized = AGENT_AIDA_KEYS.filter((k) => parsed[k] != null);
    const plain = String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return {
      ok: recognized.length > 0,
      url, via,
      bytes: html.length,
      sample: plain.slice(0, 300),
      parsed,
      recognized,
      missing: AGENT_AIDA_KEYS.filter((k) => parsed[k] == null),
    };
  } catch (e) {
    return { ok: false, url: agent.aidaUrl || '', via: null, error: e.message || String(e) };
  }
}

/** Полный опрос агента: uptime-пинг + листинг AIDA64 + relay-пинги устройств. */
async function pollAgent(agent, forceAida) {
  const now = Date.now();

  // 1) пинг до IP агента — доступность / uptime
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

  // 2) листинг AIDA64 — отдельный интервал (по умолчанию раз в минуту),
  //    чтобы частый пинг (uptime) не нагружал сенсорную страницу
  const aidaIv = Math.max(15, (db.settings.intervals && db.settings.intervals.aida) || 60) * 1000;
  if (agent.aidaUrl && (forceAida || now - (agent.lastAida || 0) >= aidaIv)) {
    agent.lastAida = now;
    try {
      const { html, via } = await fetchAidaListing(agent);
      const pt = parseAidaLine(html);
      pt.t = Date.now();
      if (AGENT_AIDA_KEYS.some((k) => pt[k] != null)) {
        agent.latest = pt;
        aidaAppend(agent, pt);
        agent.lastError = null;
        console.log(`[pluto] AIDA «${agent.name}» [${via}]: CPU ${pt.cpuUsage ?? '—'}% · ${pt.cpuTemp ?? '—'}°C · RAM ${pt.ram ?? '—'}% · SSD ${pt.ssdTemp ?? '—'}°C`);
      } else {
        agent.lastError = 'листинг AIDA64 загружен, но значения не распознаны — нажмите «Проверить листинг» в карточке агента';
        console.log(`[pluto] AIDA «${agent.name}» [${via}]: страница получена (${html.length} байт), значения не распознаны`);
      }
    } catch (e) {
      agent.lastError = 'AIDA64: ' + (e.message || 'ошибка запроса');
      console.log(`[pluto] AIDA «${agent.name}»: ${agent.lastError}`);
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
    let done = false;
    // Абсолютный таймер: сокетный timeout Node срабатывает только при отсутствии
    // активности, а «тихое» открытое соединение (AIDA64 держит keep-alive) без
    // него висело бы вечно и блокировало все дальнейшие опросы агента.
    const kill = setTimeout(() => {
      if (!done) r.destroy(new Error('таймаут запроса страницы (' + timeoutMs + ' мс)'));
    }, timeoutMs);
    const finish = (fn) => (v) => { if (done) return; done = true; clearTimeout(kill); fn(v); };
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
    r.on('timeout', () => r.destroy(new Error('таймаут ожидания ответа')));
    r.on('error', (e) => finish(reject)(e));
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

    // ── агенты: IP + листинг AIDA64 + relay (без токенов) ──
    if (p === '/api/agents' && method === 'POST' && isAdmin) {
      const b = await readBody(req);
      const ip = String(b.ip || '').trim();
      if (!ip) return json(res, 400, { error: 'укажите IP-адрес ПК' });
      const a = {
        id: uid(),
        name: String(b.name || '').trim() || ('ПК ' + ip),
        ip,
        aidaUrl: String(b.aidaUrl || '').trim(),
        relayUrl: String(b.relayUrl || '').trim(),
        pingTargets: Array.isArray(b.pingTargets) ? b.pingTargets.map((x) => String(x).trim()).filter(Boolean) : [],
        online: false, latency: null, onlineSince: 0,
        lastSeen: 0, lastPoll: 0, lastError: null,
        latest: null, aida: [], targets: [],
        favorite: false, createdAt: Date.now(),
      };
      db.agents.push(a);
      pushEvent('info', 'agent', `Добавлен агент «${a.name}» (${a.ip})`);
      saveDb();
      pollAgent(a); // первый опрос сразу
      return json(res, 200, a);
    }
    m = p.match(/^\/api\/agents\/([^/]+)$/);
    if (m && isAdmin) {
      const a = db.agents.find((x) => x.id === m[1]);
      if (!a) return json(res, 404, { error: 'агент не найден' });
      if (method === 'PUT' || method === 'PATCH') {
        const b = await readBody(req);
        for (const k of ['name', 'ip', 'aidaUrl', 'relayUrl', 'favorite']) if (k in b) a[k] = b[k];
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
    // принудительный опрос агента (forceAida — датчик обновляется сразу, вне интервала)
    m = p.match(/^\/api\/agents\/([^/]+)\/poll$/);
    if (m && method === 'POST' && isAdmin) {
      const a = db.agents.find((x) => x.id === m[1]);
      if (!a) return json(res, 404, { error: 'агент не найден' });
      await pollAgent(a, true);
      return json(res, 200, a);
    }
    // диагностика источника AIDA64: что реально приходит со страницы
    m = p.match(/^\/api\/agents\/([^/]+)\/test-aida$/);
    if (m && method === 'GET') {
      const a = db.agents.find((x) => x.id === m[1]);
      if (!a) return json(res, 404, { error: 'агент не найден' });
      if (!isAdmin && !user.scope.includes('agent')) return json(res, 403, { error: 'нет доступа к агентам' });
      return json(res, 200, await testAidaSource(a));
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
