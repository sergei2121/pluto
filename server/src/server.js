// ─── PLUTO Core: HTTP API, движок опроса, шлюз агентов, статика ─────────────
import http from 'node:http';
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

const VERSION = '1.8.1';
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
& $csc.FullName /nologo /target:exe /out:$exe `
    /reference:System.Management.dll /reference:System.ServiceProcess.dll /reference:System.Net.Http.dll $src
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
  conn.send(JSON.stringify({ type: 'config', metrics: db.settings.metrics, lanScan: db.settings.lanScan }));

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

    // восстановление сессии по токену (консоль при загрузке страницы)
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
      const agents = isAdmin || user.scope.includes('agent') ? db.agents : [];
      return json(res, 200, {
        devices: visible,
        agents,
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
        ip: '', os: '', version: '', online: false, cpuLoad: 0, cpuCores: 0, cpuTemp: 0,
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
        for (const k of ['name', 'favorite']) if (k in b) a[k] = b[k];
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
    m = p.match(/^\/api\/agents\/([^/]+)\/retoken$/);
    if (m && method === 'POST' && isAdmin) {
      const a = db.agents.find((x) => x.id === m[1]);
      if (!a) return json(res, 404, { error: 'агент не найден' });
      a.token = uid() + uid();
      pushEvent('info', 'agent', `Токен агента «${a.name}» перевыпущен`);
      saveDb();
      return json(res, 200, { token: a.token });
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
