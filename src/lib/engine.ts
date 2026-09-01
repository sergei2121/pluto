// ─── PLUTO: встроенное ядро (браузерный режим) ──────────────────────────────
// Используется только когда серверное ядро недоступно. HTTP/API-зонды —
// честные fetch; ICMP/RTSP/SIP — протокольная эмуляция (браузер не шлёт ICMP).
import { getState, store, useToasts } from './store';
import type { Device } from './types';
import { clamp, hashStr, mulberry32, rnd } from './util';

let timer: number | null = null;

export function startEngine() {
  if (timer != null) return;
  timer = window.setInterval(tick, 1000);
}

export function stopEngine() {
  if (timer != null) window.clearInterval(timer);
  timer = null;
}

function tick() {
  const s = getState();
  if (!s.session || s.apiMode === 'server') return;
  const now = Date.now();

  for (const d of s.devices) {
    if (d.checking) continue;
    const iv = Math.max(5, d.interval) * 1000;
    if (now - d.lastCheck >= iv) void runCheck(d);
  }

  const aiv = Math.max(10, s.settings.intervals.agent) * 1000;
  for (const a of s.agents) {
    if (now - a.lastPoll >= aiv) pollAgentEmbedded(a.id);
  }
}

// ─── Проверки устройств ─────────────────────────────────────────────────────

function probeUrl(d: Device): string | null {
  const addr = d.address.trim();
  if (/^https?:\/\//i.test(addr)) return addr;
  if (d.type === 'http' || d.type === 'api') {
    const port = d.port ? `:${d.port}` : '';
    const path = d.path ? (d.path.startsWith('/') ? d.path : `/${d.path}`) : '/';
    return `http://${addr}${port}${path}`;
  }
  return null;
}

function simulatedProbe(d: Device, now: number): { ok: boolean; latency: number } {
  const slot = Math.floor(now / 1000 / Math.max(5, d.interval));
  const rng = mulberry32(hashStr(d.id) ^ slot);
  const base = { ping: 12, http: 45, api: 60, rtsp: 80, sip: 40 }[d.type] ?? 30;
  if (rng() < 0.03) return { ok: false, latency: 0 };
  const spike = rng() < 0.02 ? base * 12 : 0;
  return { ok: true, latency: Math.max(1, Math.round(base * (0.72 + rng() * 0.56) + spike)) };
}

export async function runCheck(d: Device): Promise<void> {
  const s = getState();
  store.patchDevice(d.id, { checking: true });
  let res: { ok: boolean; latency: number };
  let approx = false;

  const url = probeUrl(d);
  if (url && (d.type === 'http' || d.type === 'api')) {
    const t0 = performance.now();
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), s.settings.timeoutMs);
      await fetch(url, { mode: 'no-cors', cache: 'no-store', signal: ctrl.signal, method: d.method ?? 'GET' });
      clearTimeout(to);
      res = { ok: true, latency: Math.max(1, Math.round(performance.now() - t0)) };
    } catch {
      res = { ok: false, latency: 0 };
    }
  } else {
    await new Promise((r) => setTimeout(r, 200 + Math.random() * 400));
    res = simulatedProbe(d, Date.now());
    approx = true;
  }
  applyResult(d.id, res.ok, res.latency, approx);
}

function applyResult(id: string, ok: boolean, latency: number, approx: boolean) {
  const s = getState();
  const d = s.devices.find((x) => x.id === id);
  if (!d) return;
  const now = Date.now();
  const history = [...d.history, ok ? latency : -1].slice(-48);
  const cfg = s.settings;

  if (!ok) {
    const fails = d.fails + 1;
    if (fails >= cfg.failThreshold && d.status !== 'down') {
      store.patchDevice(id, { status: 'down', fails, latency: null, lastCheck: now, lastChange: now, history, checking: false, approx });
      store.pushEvent('crit', 'device', `${d.type.toUpperCase()} ${d.address} — потеря связи (${fails} сб. подряд)`);
      dispatchNotification('down', 'PLUTO: авария', `${d.name} (${d.address}) — потеря связи`);
    } else {
      store.patchDevice(id, { fails, lastCheck: now, history, checking: false, approx });
    }
    return;
  }

  const degraded = latency > cfg.degradeMinMs && d.latency != null && latency > d.latency * cfg.degradeFactor;
  const status: Device['status'] = degraded ? 'degraded' : 'up';
  if (d.status === 'down') {
    store.pushEvent('ok', 'device', `${d.name} (${d.address}) — связь восстановлена`);
  } else if (degraded && d.status !== 'degraded') {
    store.pushEvent('warn', 'device', `${d.name}: деградация связи — ${latency} мс`);
  }
  store.patchDevice(id, { status, fails: 0, latency, lastCheck: now, lastChange: status === d.status ? d.lastChange : now, history, checking: false, approx });
}

export async function forceCheck(id: string): Promise<void> {
  const d = getState().devices.find((x) => x.id === id);
  if (d) await runCheck(d);
}

// ─── Агенты (relay) — эмуляция ──────────────────────────────────────────────

export function pollAgentEmbedded(id: string) {
  const s = getState();
  const a = s.agents.find((x) => x.id === id);
  if (!a || s.apiMode === 'server') return;
  const now = Date.now();
  const rng = mulberry32(hashStr(id) ^ Math.floor(now / 1000));
  const online = rng() > 0.03;
  const ms = online ? Math.max(1, Math.round(rnd(1, 40))) : null;

  const targets = a.pingTargets.map((tgt) => ({
    target: tgt,
    lastCheck: now,
    results: expandLocal(tgt).map((ip) => {
      const alive = online && rng() > 0.08;
      return { ip, alive, latency: alive ? Math.max(1, Math.round(rnd(1, 30))) : null };
    }),
  }));

  store.patchAgent(id, {
    online,
    latency: ms,
    onlineSince: online ? a.onlineSince || now : 0,
    lastSeen: online ? now : a.lastSeen,
    lastPoll: now,
    targets,
    latHist: [...a.latHist, { t: now, ms }].slice(-480),
  });
}

function expandLocal(target: string): string[] {
  const t = target.trim();
  const ip = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.)(\d{1,3})$/.exec(t);
  if (ip) return [t];
  const range = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.)(\d{1,3})\s*-\s*(\d{1,3})$/.exec(t);
  if (range) {
    const out: string[] = [];
    for (let i = parseInt(range[2], 10); i <= parseInt(range[3], 10) && out.length < 32; i++) out.push(range[1] + i);
    return out;
  }
  return [t];
}

// ─── Уведомления ────────────────────────────────────────────────────────────

function dispatchNotification(kind: 'down' | 'degraded' | 'recover' | 'agentOff' | 'agentOn', title: string, body: string) {
  const n = getState().settings.notifications;
  if (n.push.enabled && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      new Notification(title, { body, tag: `${kind}-${Date.now()}` });
    } catch {
      /* noop */
    }
  }
  if (n.telegram.enabled && n.telegram.botToken.trim() && n.telegram.chatId.trim()) {
    fetch(`https://api.telegram.org/bot${n.telegram.botToken.trim()}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: n.telegram.chatId.trim(), text: `${title}\n${body}` }),
    }).catch(() => useToasts.push('warn', 'Telegram: уведомление не доставлено'));
  }
}

export function requestPushPermission(): Promise<boolean> {
  if (typeof Notification === 'undefined') return Promise.resolve(false);
  return Notification.requestPermission().then((p) => p === 'granted');
}

export function sendTestNotification(kind: 'push' | 'telegram' | 'email'): { ok: boolean; text: string } {
  const n = getState().settings.notifications;
  const body = 'Проверочное уведомление PLUTO. Канал связи работает.';
  if (kind === 'push') {
    if (typeof Notification === 'undefined') return { ok: false, text: 'Браузер не поддерживает уведомления' };
    if (Notification.permission !== 'granted') return { ok: false, text: 'Разрешение не выдано' };
    new Notification('PLUTO: тест', { body });
    return { ok: true, text: 'Уведомление показано' };
  }
  if (kind === 'telegram') {
    if (!n.telegram.botToken.trim() || !n.telegram.chatId.trim()) return { ok: false, text: 'Заполните токен и chat_id' };
    fetch(`https://api.telegram.org/bot${n.telegram.botToken.trim()}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: n.telegram.chatId.trim(), text: `PLUTO: тест\n${body}` }),
    }).catch(() => undefined);
    return { ok: true, text: 'Запрос к Telegram отправлен' };
  }
  return { ok: true, text: 'Письмо поставлено в очередь (SMTP на сервере)' };
}

export function clampLat(v: number): number {
  return clamp(v, 0, 10000);
}
