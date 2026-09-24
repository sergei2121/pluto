// ─── PLUTO: автоустановка relay-агента на целевой ПК (Linux) по SSH ──────────
// Идея: вместо ручного цикла «поставить Go → склонировать → go build → systemd»
// ядро само копирует исходники pluto-relay на машину, собирает их там и поднимает
// службу с автозапуском. Никаких third-party зависимостей — только ssh/scp из
// openssh-client и стандартные модули Node.
//
// Безопасность:
//  - логин/пароль запрашиваются у вызывающего каждый раз и НЕ пишутся ни в базу,
//    ни в логи (в журнал событий попадает только хост и текст команды);
//  - пароли передаются через переменные окружения (sshpass -e / SUDO_PASS), а не
//    через argv, поэтому они не видны в `ps`;
//  - удалённая команда собирается только из строго валидированных значений.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Исходники агента лежат в репозитории (в образе Docker — вместе с кодом ядра). */
export const RELAY_SRC_DIR = process.env.PLUTO_RELAY_SRC || path.join(__dirname, '..', '..', '..', 'pluto-relay');
export const AGENT_PORT_DEFAULT = 8091;

const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;
const HOSTNAME_RE = /^[A-Za-z0-9]([A-Za-z0-9.-]{0,253}[A-Za-z0-9])?$/;
const LOGIN_RE = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/;

/** Валидация адреса хоста (IPv4 или hostname). Возвращает ошибку или null. */
export function hostError(h) {
  const s = String(h || '').trim();
  if (!s) return 'Укажите IP-адрес или hostname целевой машины';
  if (/\s/.test(s)) return 'Адрес не может содержать пробелы';
  if (IPV4_RE.test(s)) {
    const bad = s.split('.').some((o) => +o > 255);
    if (bad) return 'Некорректный IPv4-адрес';
    return null;
  }
  if (HOSTNAME_RE.test(s) && !s.includes('/')) return null;
  return 'Некорректный адрес: ожидается IPv4 (192.168.1.10) или hostname';
}

export function loginError(l) {
  const s = String(l || '').trim();
  if (!s) return 'Укажите логин SSH';
  if (!LOGIN_RE.test(s)) return 'Логин SSH содержит недопустимые символы';
  return null;
}

export function portError(p) {
  const n = Number(p);
  if (!Number.isInteger(n) || n < 1 || n > 65535) return 'Порт должен быть числом 1…65535';
  return null;
}

/** Удалённая команда установки: сборка из валидированных констант и чисел. */
export function buildRemoteScript({ port, withSudo }) {
  const p = String(Number(port));
  if (!/^\d+$/.test(p)) throw new Error('некорректный порт');
  return [
    'set -e',
    'cd /tmp/pluto-relay',
    '# Go: нужен только на время сборки (рантайм агенту не требуется)',
    'if ! command -v go >/dev/null 2>&1; then',
    '  . /etc/os-release 2>/dev/null || true',
    '  case "${ID:-}" in',
    '    ubuntu|debian) export DEBIAN_FRONTEND=noninteractive; sudo -n apt-get update -qq; sudo -n apt-get install -y -qq golang-go curl ca-certificates ;;',
    '    fedora|rhel|centos|rocky|almalinux) sudo -n dnf install -y go curl ;;',
    '    alpine) sudo -n apk add --no-cache go curl ;;',
    '    *) curl -fsSL https://go.dev/dl/go1.22.5.linux-amd64.tar.gz -o /tmp/go.tgz && sudo -n tar -C /usr/local -xzf /tmp/go.tgz ;;',
    '  esac',
    'fi',
    'export PATH="$PATH:/usr/local/go/bin:$HOME/go/bin"',
    'command -v go >/dev/null 2>&1 || { echo "не удалось установить Go >= 1.21 на целевую машину"; exit 3; }',
    'go version',
    'go build -trimpath -o pluto-relay .',
    './pluto-relay -port ' + p + ' >/tmp/pluto-relay.out 2>&1 & PID=$!; sleep 1',
    'kill $PID 2>/dev/null || true; wait $PID 2>/dev/null || true',
    'curl -fsS "http://127.0.0.1:' + p + '/health" >/dev/null 2>&1 || true',
    withSudo ? [
      'sudo -n mkdir -p /opt/pluto-relay',
      'sudo -n cp -f pluto-relay /opt/pluto-relay/pluto-relay',
      'printf \'%s\\n\' \'[Unit]\' \'Description=PLUTO relay agent\' \'After=network-online.target\' \'[Service]\' \'ExecStart=/opt/pluto-relay/pluto-relay -port ' + p + '\' \'Restart=always\' \'RestartSec=3\' \'[Install]\' \'WantedBy=multi-user.target\' | sudo -n tee /etc/systemd/system/pluto-relay.service >/dev/null',
      'sudo -n systemctl daemon-reload',
      'sudo -n systemctl enable --now pluto-relay',
      'sleep 1',
      'systemctl is-active --quiet pluto-relay && echo "PLUTO_OK unit=pluto-relay port=' + p + '" || { echo "служба pluto-relay не поднялась"; exit 4; }',
    ].join('\n') : 'echo "PLUTO_OK binary=/tmp/pluto-relay/pluto-relay port=' + p + '"',
  ].join('\n');
}

function run(cmd, args, { timeoutMs = 180000, env } = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, env: env || process.env },
      (err, stdout, stderr) => resolve({
        code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
        out: String(stdout || ''), err: String(stderr || ''), error: err ? err.message : null,
      }));
  });
}

/** Есть ли в системе sshpass (нужен для авторизации паролем). */
export async function hasSshpass() {
  const r = await run('sh', ['-c', 'command -v sshpass']);
  return r.code === 0 && !!r.out.trim();
}

/** Ключевые параметры ssh/scp: строгий known_hosts отключён (первое подключение), пароль/ключ. */
function sshCommon(sshOpts) {
  return ['-o', 'BatchMode=no', '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null',
    '-o', 'LogLevel=ERROR', '-o', 'ConnectTimeout=10', ...sshOpts];
}

/**
 * Автоустановка relay-агента на Linux-машину.
 * @param {object} o { host, login, password?, privateKey?, port?, sshPort?, pingTargets?, withSudo? }
 * @returns {Promise<{ok:boolean, agentUrl:string, steps:string[], log:string, error?:string}>}
 */
export async function provisionAgent(o) {
  const steps = [];
  const say = (s) => { steps.push(s); return s; };
  const host = String(o.host || '').trim();
  const login = String(o.login || '').trim();
  const port = Number(o.port) || AGENT_PORT_DEFAULT;
  const sshPort = Number(o.sshPort) || 22;
  const password = o.password ? String(o.password) : '';
  const privateKey = o.privateKey ? String(o.privateKey) : '';

  const herr = hostError(host); if (herr) return fail(steps, say, herr);
  const lerr = loginError(login); if (lerr) return fail(steps, say, lerr);
  const perr = portError(port); if (perr) return fail(steps, say, perr);
  if (!password && !privateKey) return fail(steps, say, 'Нужен пароль SSH или закрытый ключ');
  if (password && !(await hasSshpass())) {
    return fail(steps, say, 'На сервере PLUTO нет sshpass: установите пакет sshpass либо используйте вход по ключу');
  }

  // исключаем дублирование целей (иначе агент пинговал бы один IP дважды)
  const targets = [...new Set((Array.isArray(o.pingTargets) ? o.pingTargets : [])
    .map((t) => String(typeof t === 'string' ? t : (t?.range || '')).trim())
    .filter((t) => t && t !== host))];

  if (!fs.existsSync(path.join(RELAY_SRC_DIR, 'main.go'))) {
    return fail(steps, say, `Не найдены исходники агента: ${RELAY_SRC_DIR}/main.go`);
  }

  const env = { ...process.env };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pluto-prov-'));
  const keyFile = path.join(tmp, 'id_pluto');
  let keyPath = '';
  try {
    if (privateKey) {
      fs.writeFileSync(keyFile, privateKey.endsWith('\n') ? privateKey : privateKey + '\n', { mode: 0o600 });
      keyPath = keyFile;
    }
    const sshOpts = keyPath ? ['-i', keyPath, '-o', 'IdentitiesOnly=yes'] : [];
    const passArg = password ? ['-e'] : [];
    if (password) env.SSHPASS = password;
    const target = `${login}@${host}`;
    const base = [...sshCommon(sshOpts), '-p', String(sshPort)];

    say(`Проверяю доступ по SSH к ${target}:${sshPort}…`);
    const probe = await run(password ? 'sshpass' : 'ssh', [...passArg, ...base, target, 'true'], { timeoutMs: 25000, env });
    if (probe.code !== 0) {
      const msg = /Permission denied/i.test(probe.err + probe.error) ? 'SSH отклонил учётные данные'
        : /Connection timed out|No route to host|Connection refused/i.test(probe.err + probe.error) ? 'Машина недоступна по SSH (порт ' + sshPort + ')'
        : 'SSH-подключение не установлено';
      return fail(steps, say, `${msg}: ${(probe.err || probe.error || '').trim().slice(0, 200)}`);
    }
    say('SSH доступен ✓');

    say('Копирую исходники pluto-relay в /tmp/pluto-relay…');
    await run(password ? 'sshpass' : 'ssh', [...passArg, ...base, target, 'rm -rf /tmp/pluto-relay && mkdir -p /tmp/pluto-relay'], { timeoutMs: 30000, env });
    const scpArgs = [...passArg, '-P', String(sshPort), ...sshCommon(sshOpts), '-r',
      path.join(RELAY_SRC_DIR, 'main.go'), path.join(RELAY_SRC_DIR, 'go.mod'), `${target}:/tmp/pluto-relay/`];
    const cp = await run(password ? 'sshpass' : 'scp', scpArgs, { timeoutMs: 90000, env });
    if (cp.code !== 0) return fail(steps, say, `Не удалось скопировать исходники: ${(cp.err || cp.error || '').trim().slice(0, 200)}`);
    say('Исходники на месте ✓');

    say('Собираю бинарник и регистрирую службу…');
    const script = buildRemoteScript({ port, withSudo: o.withSudo !== false });
    const rem = await run(password ? 'sshpass' : 'ssh', [...passArg, ...base, target, script], { timeoutMs: 300000, env });
    const log = `${rem.out}\n${rem.err}`.trim();
    if (rem.code !== 0 || !log.includes('PLUTO_OK')) {
      const hint = /sudo a password|a password is required|sudo:.*(password|not be required)/i.test(log)
        ? ' — пользователю нужен бессудольный sudo (visudo: "user ALL=(ALL) NOPASSWD: ALL") или снимите флаг «устанавливать службой»'
        : '';
      return fail(steps, say, `Сборка/запуск на машине завершились с ошибкой${hint}: ${log.slice(-500)}`);
    }
    say('Агент собран и запущен ✓');

    const agentUrl = `http://${host}:${port}`;
    say(`Проверяю API агента ${agentUrl}/health…`);
    let alive = false;
    for (let i = 0; i < 6 && !alive; i++) {
      if (i) await new Promise((r) => setTimeout(r, 1500));
      const h = await run('ssh', [...sshCommon([]), '-p', String(sshPort), target, `curl -fsS -m 3 http://127.0.0.1:${port}/health || true`], { timeoutMs: 20000, env });
      alive = /"ok"\s*:\s*true|"name"\s*:\s*"pluto-relay"/.test(h.out);
      if (h.code !== 0 && !alive) { say(`Ответ агента пока не получен (${(h.err || h.error || '').trim().slice(0, 120)})`); break; }
    }
    say(alive ? 'Агент отвечает ✓' : 'Агент запущен, но /health пока не отвечает — проверьте файрвол на машине');

    if (targets.length) {
      say(`Цели пинга будут назначены: ${targets.join(', ')}`);
      if (o.agentUrlField === 'relayUrl') say(`Ядро будет опрашивать его как relay: ${agentUrl}`);
      else say(`Ядро будет брать телеметрию по адресу: ${agentUrl}`);
    }
    return { ok: true, agentUrl, online: alive, steps, log: log.slice(-800) };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function fail(steps, say, error) {
  say(`ОШИБКА: ${error}`);
  return { ok: false, agentUrl: '', steps, log: '', error };
}

/** Токен доступа к API ядра (для bootstrap-режима, когда логина админа нет под рукой). */
export function provisionToken() {
  return process.env.PLUTO_PROVISION_TOKEN || '';
}

export function safeEqual(a, b) {
  const x = Buffer.from(String(a || '')); const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
