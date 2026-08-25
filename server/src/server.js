// ─── PLUTO Core: REST API + движок опроса + шлюз агентов + веб-консоль ──────
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import dgram from 'node:dgram';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  loadDb, saveDb, pushEvent, uid, authUser, hashPass, verifyPass,
  issueSession, attachWs, DEFAULT_SETTINGS,
} from './lib.js';

const VERSION = '1.7.3';
const db = loadDb();
const HTTP_PORT = Number(process.env.HTTP_PORT || 8080);
const AGENT_PORT = Number(process.env.AGENT_PORT || 8443);
const WEB_DIR = process.env.WEB_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const AGENT_DIR = process.env.AGENT_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'agent');

function text(res, code, body, type) {
  res.writeHead(code, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}

// IP/хост, по которому клиент обратился к ядру (для подстановки в установщик агента)
function hostIp(req) {
  const h = (req.headers['x-forwarded-host'] || req.headers.host || '').split(':')[0];
  return h || '127.0.0.1';
}

// PowerShell-установщик агента: скачивает исходник, компилирует встроенным csc.exe,
// ставит службой Windows и запускает. Плейсхолдеры подставляются при отдаче.
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

if (-not $Token) { $Token = Read-Host "Введите токен агента (консоль: Агенты -> Создать токен)" }
if (-not $Token) { Write-Host "Токен обязателен." -ForegroundColor Red; exit 1 }

Write-Host "[pluto] каталог: $dir"
New-Item -ItemType Directory -Force -Path $dir | Out-Null

Write-Host "[pluto] скачиваю исходник агента с ядра..."
Invoke-WebRequest -UseBasicParsing -Uri "$base/agent/PlutoAgent.cs" -OutFile $src

# Самопроверка: устаревший образ ядра отдаёт HTML вместо исходника — прерваться понятно
$head = (Get-Content $src -TotalCount 1 -Encoding UTF8 -ErrorAction SilentlyContinue)
if ($head -match '<!doctype|<html') {
  Write-Host "[pluto] ОШИБКА: ядро отдало HTML, а не исходник агента — образ устарел." -ForegroundColor Red
  Write-Host "        На сервере выполните: git pull && docker compose up -d --build" -ForegroundColor Yellow
  exit 1
}
if (-not (Select-String -Path $src -Pattern 'class Program' -Quiet)) {
  Write-Host "[pluto] ОШИБКА: скачанный файл не похож на исходник агента." -ForegroundColor Red
  exit 1
}

$csc = Get-ChildItem "$env:WINDIR\\Microsoft.NET\\Framework64\\*\\csc.exe" -ErrorAction SilentlyContinue |
       Sort-Object FullName -Descending | Select-Object -First 1
if (-not $csc) { throw "csc.exe не найден. Нужен .NET Framework 4.x (обычно уже установлен в Windows)." }

# ВАЖНО: сначала остановить и удалить старую службу — она держит pluto-agent.exe
# открытым, и компилятор не сможет перезаписать файл.
Write-Host "[pluto] останавливаю и удаляю старую службу (если была)..."
sc.exe stop $Name 2>$null | Out-Null
sc.exe delete $Name 2>$null | Out-Null
$w = 0
while ((Get-Service $Name -ErrorAction SilentlyContinue) -and $w -lt 15) { Start-Sleep -Seconds 1; $w++ }
if (Get-Service $Name -ErrorAction SilentlyContinue) { throw "старая служба не удалилась. Закройте оснастку «Службы»/Process Explorer и повторите, либо перезагрузите ПК." }

Write-Host "[pluto] компилирую агент под вашу Windows ($($csc.FullName))..."
& $csc.FullName /nologo /target:exe /out:$exe \`
    /reference:System.Management.dll /reference:System.ServiceProcess.dll /reference:System.Net.Http.dll $src
if ($LASTEXITCODE -ne 0) { throw "компиляция не удалась (код $LASTEXITCODE). Полный вывод выше." }
Write-Host "[pluto] скомпилировано: $exe"

# Путь установки (C:\\ProgramData\\pluto) не содержит пробелов, поэтому кавычки
# в binPath НЕ НУЖНЫ: sc.exe через PowerShell ломает экранирование кавычек, и
# служба создаётся без аргументов (агент стучится на 127.0.0.1 без токена).
$binPath = "$exe -server $Server -token $Token"

Write-Host "[pluto] создаю службу Windows '$Name'..."
try { New-Service -Name $Name -BinaryPathName $binPath -DisplayName "PLUTO Agent" -StartupType Automatic -ErrorAction Stop | Out-Null }
catch { throw "не удалось создать службу: $($_.Exception.Message). Запустите PowerShell от имени администратора." }

# Контроль: аргументы действительно записаны в службу
$svc = Get-WmiObject Win32_Service -Filter "Name='$Name'"
Write-Host "[pluto] путь службы: $($svc.PathName)"
if ($svc.PathName -notlike "*-token*") { throw "служба создана БЕЗ аргументов — установка некорректна, повторите от имени администратора." }

Write-Host "[pluto] запускаю службу..."
Start-Service $Name

Write-Host ""
Write-Host "[pluto] ГОТОВО. Агент появится в консоли PLUTO в течение нескольких секунд." -ForegroundColor Green
Write-Host "[pluto] сервер : $Server"
Write-Host "[pluto] лог    : $dir\\agent.log"
`;

// ─── Проверки устройств (настоящие) ─────────────────────────────────────────

function checkPing(addr, timeoutMs) {
  return new Promise((resolve) => {
    const secs = Math.max(1, Math.round(timeoutMs / 1000));
    const t0 = Date.now();
    execFile('ping', ['-c', '1', '-W', String(secs), addr], { timeout: timeoutMs + 2000 }, (err, stdout) => {
      if (err) return resolve({ ok: false, latency: 0, error: 'unreachable' });
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
      const host = /^https?:\/\//.test(addr) ? addr : `http://${addr}${port ? ':' + port : ''}${pth ? (pth.startsWith('/') ? pth : '/' + pth) : '/'}`;
      url = new URL(host);
    } catch {
      return resolve({ ok: false, latency: 0, error: 'invalid address' });
    }
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request(
      url,
      { method: method || 'GET', timeout: timeoutMs, headers: body ? { 'Content-Type': 'application/json' } : {} },
      (res) => {
        res.resume();
        resolve({ ok: res.statusCode < 400, latency: Date.now() - t0, status: res.statusCode });
      },
    );
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, latency: 0, error: 'timeout' }); });
    req.on('error', (e) => resolve({ ok: false, latency: 0, error: e.message }));
    if (body) req.write(body);
    req.end();
  });
}

function checkRtsp(addr, port, pth, timeoutMs) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const sock = net.connect({ host: addr, port: port || 554, timeout: timeoutMs });
    const done = (r) => { sock.destroy(); resolve(r); };
    sock.on('timeout', () => done({ ok: false, latency: 0, error: 'timeout' }));
    sock.on('error', (e) => done({ ok: false, latency: 0, error: e.message }));
    sock.on('connect', () => {
      sock.write(`OPTIONS rtsp://${addr}:${port || 554}${pth || '/'} RTSP/1.0\r\nCSeq: 1\r\nUser-Agent: pluto-core\r\n\r\n`);
    });
    let buf = '';
    sock.on('data', (d) => {
      buf += d.toString('latin1');
      const m = /^RTSP\/1\.0\s+(\d{3})/.exec(buf);
      if (m) done({ ok: m[1] === '200', latency: Date.now() - t0, status: Number(m[1]) });
      else if (buf.length > 4096) done({ ok: false, latency: 0, error: 'bad response' });
    });
  });
}

function checkSip(addr, port, timeoutMs) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const p = port || 5060;
    const sock = dgram.createSocket('udp4');
    const branch = 'z9hG4bK' + Math.random().toString(36).slice(2, 12);
    const callId = uid() + '@pluto';
    const msg = [
      `OPTIONS sip:monitor@${addr}:${p} SIP/2.0`,
      `Via: SIP/2.0/UDP ${addr}:${p};branch=${branch}`,
      'Max-Forwards: 5',
      `From: <sip:pluto@monitor>;tag=${uid()}`,
      `To: <sip:monitor@${addr}>`,
      `Call-ID: ${callId}`,
      'CSeq: 1 OPTIONS',
      'Contact: <sip:pluto@monitor>',
      'Content-Length: 0',
      '', '',
    ].join('\r\n');
    const timer = setTimeout(() => { sock.close(); resolve({ ok: false, latency: 0, error: 'timeout' }); }, timeoutMs);
    sock.on('message', (data) => {
      clearTimeout(timer);
      sock.close();
      const head = data.toString('latin1').slice(0, 32);
      resolve({ ok: /^SIP\/2\.0\s+200/.test(head), latency: Date.now() - t0 });
    });
    sock.on('error', (e) => { clearTimeout(timer); sock.close(); resolve({ ok: false, latency: 0, error: e.message }); });
    sock.send(msg, p, addr);
  });
}

async function runCheck(device) {
  const t = db.settings.timeoutMs;
  let r;
  switch (device.type) {
    case 'ping': r = await checkPing(device.address, t); break;
    case 'http': r = await checkHttp(device.address, device.port, device.path, 'GET', null, t); break;
    case 'api': r = await checkHttp(device.address, device.port, device.path, device.method || 'POST', device.body || null, t); break;
    case 'rtsp': r = await checkRtsp(device.address, device.port, device.path, Math.max(t, 4000)); break;
    case 'sip': r = await checkSip(device.address, device.port, t); break;
    default: r = { ok: false, latency: 0, error: 'unknown type' };
  }
  console.log(`[pluto] ${device.type.toUpperCase()} ${device.address} → ${r.ok ? 'ok ' + r.latency + ' мс' : 'недоступен'}`);
  return r;
}

function applyResult(device, res) {
  const s = db.settings;
  const now = Date.now();
  device.history = [...(device.history || []), res.ok ? res.latency : -1].slice(-96);
  device.lastCheck = now;

  if (!res.ok) {
    device.fails = (device.fails || 0) + 1;
    device.latency = null;
    if (device.fails >= s.failThreshold && device.status !== 'down') {
      device.status = 'down';
      device.lastChange = now;
      pushEvent('crit', 'device', `${device.type.toUpperCase()} ${device.address} — потеря связи (${device.fails} сб. подряд)`);
      notify('down', 'PLUTO: авария', `${device.name} (${device.address}) — потеря связи после ${device.fails} проверок`);
    }
  } else {
    device.baseline = device.baseline ? device.baseline * 0.9 + res.latency * 0.1 : res.latency;
    const degraded = res.latency > device.baseline * s.degradeFactor && res.latency > s.degradeMinMs;
    const next = degraded ? 'degraded' : 'up';
    device.fails = 0;
    device.latency = res.latency;
    if (device.status === 'down') {
      const downFor = Math.max(1, Math.round((now - (device.lastChange || now)) / 1000));
      pushEvent('ok', 'device', `${device.name} (${device.address}) — связь восстановлена, простой ${downFor} с`);
      if (s.notifications.on.recover) notify('recover', 'PLUTO: восстановление', `${device.name} (${device.address}) снова в строю, простой ${downFor} с`);
    } else if (next === 'degraded' && device.status !== 'degraded') {
      pushEvent('warn', 'device', `${device.name}: деградация связи — ${res.latency} мс при базовых ${Math.round(device.baseline)} мс`);
      if (s.notifications.on.degraded) notify('degraded', 'PLUTO: деградация', `${device.name} (${device.address}): задержка ${res.latency} мс`);
    } else if (next === 'up' && device.status === 'degraded') {
      pushEvent('ok', 'device', `${device.name}: задержка вернулась к норме`);
    }
    if (device.status !== next) { device.status = next; device.lastChange = now; }
  }
  saveDb();
}

// ─── Планировщик (тик 1 с) ───────────────────────────────────────────────────

function tick() {
  const now = Date.now();
  const s = db.settings;
  for (const d of db.devices) {
    if (d.checking) continue;
    const interval = Math.max(5, d.interval || s[d.type] || 60) * 1000;
    if (now - (d.lastCheck || 0) >= interval) {
      d.checking = true;
      runCheck(d).then((res) => { d.checking = false; applyResult(d, res); }).catch(() => { d.checking = false; });
    }
  }
  for (const a of db.agents) {
    if (a.online && now - (a.lastSeen || 0) > Math.max(15000, s.metrics * 3000)) {
      a.online = false;
      pushEvent('crit', 'agent', `Агент ${a.hostname || a.name} — соединение потеряно`);
      if (s.notifications.on.agentOff) notify('agentOff', 'PLUTO: агент офлайн', `Агент ${a.hostname || a.name} перестал присылать телеметрию`);
      saveDb();
    }
  }
}
setInterval(tick, 1000);

// ─── Уведомления (Telegram + минимальный SMTP, без зависимостей) ────────────

function notify(kind, title, body) {
  const n = db.settings.notifications;
  if (n.telegram?.enabled && n.telegram.botToken && n.telegram.chatId) {
    const payload = JSON.stringify({ chat_id: n.telegram.chatId, text: `${title}\n${body}` });
    const req = https.request(
      { host: 'api.telegram.org', path: `/bot${n.telegram.botToken}/sendMessage`, method: 'POST', headers: { 'Content-Type': 'application/json' } },
      (res) => { if (res.statusCode !== 200) console.error('[pluto] telegram:', res.statusCode); res.resume(); },
    );
    req.on('error', (e) => console.error('[pluto] telegram:', e.message));
    req.end(payload);
  }
  if (n.email?.enabled && n.email.smtpHost && n.email.to) {
    sendSmtp(n.email, title, body).catch((e) => console.error('[pluto] smtp:', e.message));
  }
}

function sendSmtp(cfg, subject, body) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: cfg.smtpHost, port: cfg.smtpPort || 587, timeout: 8000 });
    const from = cfg.from || 'pluto@monitor';
    const steps = [
      `EHLO pluto`,
      `MAIL FROM:<${from}>`,
      `RCPT TO:<${cfg.to}>`,
      `DATA`,
      `From: ${from}\r\nTo: ${cfg.to}\r\nSubject: ${subject}\r\n\r\n${body}\r\n.`,
      `QUIT`,
    ];
    let i = 0;
    sock.on('connect', () => {});
    sock.on('data', (d) => {
      const code = parseInt(d.toString().slice(0, 3), 10);
      if (code >= 400) { sock.destroy(); return reject(new Error('SMTP ' + code)); }
      if (i < steps.length) sock.write(steps[i++] + '\r\n');
      else { sock.end(); resolve(); }
    });
    sock.on('timeout', () => { sock.destroy(); reject(new Error('timeout')); });
    sock.on('error', reject);
  });
}

// ─── Шлюз агентов (WebSocket на :8443) ───────────────────────────────────────

const agentServer = http.createServer();
// TCP-уровень: видно, доходят ли пакеты агентов до контейнера вообще
agentServer.on('connection', (sock) => {
  console.log(`[pluto] шлюз: TCP-соединение от ${sock.remoteAddress}`);
});
attachWs(agentServer, (conn, url, remoteIp) => {
  const token = url.searchParams.get('token');
  const agent = db.agents.find((a) => a.token === token);
  if (!agent) {
    console.log(`[pluto] шлюз: НЕВЕРНЫЙ ТОКЕН от ${remoteIp} (токен: ${String(token).slice(0, 6)}…)`);
    conn.send(JSON.stringify({ type: 'error', text: 'invalid token' }));
    conn.close();
    return;
  }
  console.log(`[pluto] шлюз: агент «${agent.name}» подключился с ${remoteIp}`);
  agent.online = true;
  agent.lastSeen = Date.now();
  agent.ip = remoteIp || agent.ip;
  pushEvent('info', 'agent', `Агент ${agent.hostname || agent.name} подключился (${agent.ip})`);
  conn.send(JSON.stringify({ type: 'config', metrics: db.settings.metrics, lanScan: db.settings.lanScan }));

  conn.onMessage((raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    agent.lastSeen = Date.now();
    if (msg.type === 'hello') {
      Object.assign(agent, { hostname: msg.hostname, os: msg.os, version: msg.version });
      pushEvent('ok', 'agent', `Агент ${agent.hostname} (${agent.ip}) в сети`);
    } else if (msg.type === 'metrics') {
      Object.assign(agent, msg.data);
      agent.history = [...(agent.history || []), {
        t: Date.now(), cpu: msg.data.cpuLoad || 0, ram: msg.data.ramTotal ? ((msg.data.ramUsed || 0) / msg.data.ramTotal) * 100 : 0,
      }].slice(-120);
    } else if (msg.type === 'lan') {
      agent.networks = msg.networks || [];
      agent.lastScan = Date.now();
    }
    saveDb();
  });
  conn.onClose(() => {
    agent.online = false;
    pushEvent('warn', 'agent', `Агент ${agent.hostname || agent.name} отключился`);
    saveDb();
  });
});
agentServer.listen(AGENT_PORT, () => console.log(`[pluto] шлюз агентов: ws://0.0.0.0:${AGENT_PORT}/ws`));

// ─── REST API + статика ──────────────────────────────────────────────────────

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json', '.webp': 'image/webp', '.txt': 'text/plain' };

function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } });
  });
}

function publicUser(u) {
  return { id: u.id, name: u.name, role: u.role, scope: u.scope || [] };
}

function visibleDevices(user) {
  if (user.role === 'admin') return db.devices;
  return db.devices.filter((d) => (user.scope || []).includes(d.type));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  const method = req.method;

  try {
    // ── публичные (до авторизации) ──
    if (p === '/api/health') return json(res, 200, { ok: true, name: 'pluto-core', version: VERSION, console: 'api' });
    if (p === '/api/version') return json(res, 200, { version: VERSION });

    // ── раздача Windows-агента (публично: качает «голая» PowerShell) ──
    // Агент компилируется НА МАШИНЕ встроенным csc.exe → всегда под нужную архитектуру.
    // BOM обязателен: PowerShell 5.1 и csc.exe на Windows без него читают файл
    // в системной кодовой странице (Windows-1251 на русской ОС) и ломают кириллицу.
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
      return json(res, 200, { token: issueSession(user.id), user: publicUser(user) });
    }

    // маршруты агента выше; сюда доходят только неизвестные /agent/* — не отдаём HTML
    if (method === 'GET' && p.startsWith('/agent/')) return text(res, 404, 'not found', 'text/plain');

    // ── статика веб-консоли (без авторизации) ──
    if (method === 'GET' && !p.startsWith('/api/')) {
      let file = path.normalize(path.join(WEB_DIR, p === '/' ? 'index.html' : p));
      if (!file.startsWith(WEB_DIR)) return json(res, 403, { error: 'forbidden' });
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(WEB_DIR, 'index.html');
      if (!fs.existsSync(file)) {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('PLUTO Core работает. Веб-консоль не найдена: пересоберите образ (docker compose up -d --build).');
      }
      const ext = path.extname(file);
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
      });
      if (ext === '.html') {
        // Подпись ядра: консоль видит её ДО любого fetch и не может ошибочно
        // уйти в режим эмуляции, когда страница отдана настоящим сервером.
        const html = fs
          .readFileSync(file, 'utf8')
          .replace('<head>', `<head><script>window.__PLUTO_CORE__={v:"${VERSION}"}</script>`);
        return res.end(html);
      }
      return fs.createReadStream(file).pipe(res);
    }

    const user = authUser(req);
    if (!user) return json(res, 401, { error: 'Требуется авторизация' });

    // ── авторизация ──
    if (p === '/api/auth/me') return json(res, 200, { user: publicUser(user) });
    if (p === '/api/auth/logout' && method === 'POST') {
      const token = (req.headers.authorization || '').slice(7);
      db.sessions = db.sessions.filter((s) => s.token !== token);
      saveDb();
      return json(res, 200, { ok: true });
    }

    // ── пользователи (только админ) ──
    if (p.startsWith('/api/users')) {
      if (user.role !== 'admin') return json(res, 403, { error: 'Недостаточно прав' });
      if (p === '/api/users' && method === 'GET') return json(res, 200, { users: db.users.map(publicUser) });
      if (p === '/api/users' && method === 'POST') {
        const b = await readBody(req);
        if (!b.name || !b.password) return json(res, 400, { error: 'Укажите имя и пароль' });
        if (db.users.some((u) => u.name === b.name)) return json(res, 409, { error: 'Имя занято' });
        const nu = { id: uid(), name: b.name, role: b.role || 'viewer', scope: b.scope || [], passHash: hashPass(b.password), createdAt: Date.now() };
        db.users.push(nu);
        pushEvent('info', 'system', `Создан пользователь ${nu.name} (${nu.role})`);
        saveDb();
        return json(res, 200, { user: publicUser(nu) });
      }
      const id = p.split('/')[3];
      const target = db.users.find((u) => u.id === id);
      if (!target) return json(res, 404, { error: 'Пользователь не найден' });
      if (method === 'PUT') {
        const b = await readBody(req);
        if (b.name) target.name = b.name;
        if (b.role) target.role = b.role;
        if (b.scope) target.scope = b.scope;
        if (b.password) target.passHash = hashPass(b.password);
        saveDb();
        return json(res, 200, { user: publicUser(target) });
      }
      if (method === 'DELETE') {
        if (target.name === 'admin') return json(res, 400, { error: 'Нельзя удалить администратора' });
        db.users = db.users.filter((u) => u.id !== id);
        db.sessions = db.sessions.filter((s) => s.userId !== id);
        saveDb();
        return json(res, 200, { ok: true });
      }
    }

    // ── устройства ──
    if (p.startsWith('/api/devices')) {
      const id = p.split('/')[3];
      if (method === 'GET' && !id) return json(res, 200, { devices: visibleDevices(user) });
      const own = visibleDevices(user);
      const dev = own.find((d) => d.id === id);
      if (user.role !== 'admin' && method !== 'GET') return json(res, 403, { error: 'Только чтение' });
      if (p === '/api/devices' && method === 'POST') {
        const b = await readBody(req);
        if (!b.address || !b.type) return json(res, 400, { error: 'Укажите тип и адрес' });
        const nd = {
          id: uid(), name: b.name || b.address, type: b.type, address: b.address, port: b.port || null,
          path: b.path || '', method: b.method || null, body: b.body || null,
          interval: b.interval || db.settings[b.type] || 60, tags: b.tags || [], favorite: false,
          status: 'unknown', latency: null, fails: 0, baseline: null, history: [], lastCheck: 0, lastChange: Date.now(), checking: false,
        };
        db.devices.push(nd);
        pushEvent('info', 'device', `Добавлено устройство ${nd.name} (${nd.type.toUpperCase()} ${nd.address})`);
        saveDb();
        return json(res, 200, { device: nd });
      }
      if (!dev) return json(res, 404, { error: 'Устройство не найдено' });
      if (method === 'PUT') {
        Object.assign(dev, await readBody(req), { id: dev.id });
        saveDb();
        return json(res, 200, { device: dev });
      }
      if (method === 'DELETE') {
        db.devices = db.devices.filter((d) => d.id !== id);
        saveDb();
        return json(res, 200, { ok: true });
      }
      if (method === 'POST' && p.endsWith('/check')) {
        if (user.role !== 'admin') return json(res, 403, { error: 'Только чтение' });
        const r = await runCheck(dev);
        applyResult(dev, r);
        return json(res, 200, { result: r, device: dev });
      }
    }

    // ── теги ──
    if (p.startsWith('/api/tags')) {
      if (method === 'GET') return json(res, 200, { tags: db.tags });
      if (user.role !== 'admin') return json(res, 403, { error: 'Только чтение' });
      if (p === '/api/tags' && method === 'POST') {
        const b = await readBody(req);
        const tag = { id: uid(), label: b.label || 'тег', color: b.color || '#9a8cfa' };
        db.tags.push(tag);
        saveDb();
        return json(res, 200, { tag });
      }
      const tag = db.tags.find((t) => t.id === p.split('/')[3]);
      if (!tag) return json(res, 404, { error: 'Тег не найден' });
      if (method === 'DELETE') {
        db.tags = db.tags.filter((t) => t.id !== tag.id);
        db.devices.forEach((d) => (d.tags = (d.tags || []).filter((x) => x !== tag.id)));
        saveDb();
        return json(res, 200, { ok: true });
      }
    }

    // ── агенты ──
    if (p.startsWith('/api/agents')) {
      const canSee = user.role === 'admin' || (user.scope || []).includes('agent');
      if (!canSee) return json(res, 403, { error: 'Нет доступа к агентам' });
      if (p === '/api/agents' && method === 'GET') return json(res, 200, { agents: db.agents });
      if (user.role !== 'admin') return json(res, 403, { error: 'Только чтение' });
      if (p === '/api/agents/token' && method === 'POST') {
        const b = await readBody(req);
        const agent = {
          id: uid(), name: b.name || 'agent-' + uid().slice(0, 4), token: uid() + uid(),
          online: false, hostname: '', ip: '', os: '', version: '', lastSeen: 0, history: [], networks: [], favorite: false,
        };
        db.agents.push(agent);
        pushEvent('info', 'agent', `Создан токен подключения для агента «${agent.name}»`);
        saveDb();
        return json(res, 200, { agent, token: agent.token });
      }
      if (method === 'POST' && p.endsWith('/retoken')) {
        const a = db.agents.find((x) => x.id === p.split('/')[3]);
        if (!a) return json(res, 404, { error: 'Агент не найден' });
        a.token = uid() + uid();
        pushEvent('warn', 'agent', `Токен агента «${a.name}» перевыпущен — старый недействителен`);
        saveDb();
        return json(res, 200, { token: a.token });
      }
      const id = p.split('/')[3];
      if (method === 'DELETE') {
        db.agents = db.agents.filter((a) => a.id !== id);
        saveDb();
        return json(res, 200, { ok: true });
      }
      if (method === 'PUT') {
        const a = db.agents.find((x) => x.id === id);
        if (!a) return json(res, 404, { error: 'Агент не найден' });
        Object.assign(a, await readBody(req), { id: a.id, token: a.token });
        saveDb();
        return json(res, 200, { agent: a });
      }
    }

    // ── события и настройки ──
    if (p === '/api/events' && method === 'GET') return json(res, 200, { events: db.events.slice(0, 200) });
    if (p === '/api/settings') {
      if (method === 'GET') return json(res, 200, { settings: db.settings });
      if (user.role !== 'admin') return json(res, 403, { error: 'Только чтение' });
      const b = await readBody(req);
      db.settings = { ...DEFAULT_SETTINGS, ...b, notifications: { ...DEFAULT_SETTINGS.notifications, ...(b.notifications || {}) } };
      pushEvent('info', 'system', 'Системные настройки сохранены');
      saveDb();
      return json(res, 200, { settings: db.settings });
    }

    json(res, 404, { error: 'Маршрут не найден' });
  } catch (e) {
    console.error('[pluto]', e);
    json(res, 500, { error: 'internal error' });
  }
});

server.listen(HTTP_PORT, () => {
  console.log(`[pluto] core v${VERSION} · консоль и API: http://0.0.0.0:${HTTP_PORT} · health: /api/health`);
  console.log(`[pluto] база: ${path.resolve(process.env.DATA_DIR || './data')}/db.json · пользователь admin`);
});
