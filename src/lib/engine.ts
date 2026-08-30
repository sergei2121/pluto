// ─── PLUTO: встроенное ядро (браузерный режим) ──────────────────────────────
// Работает, когда серверное ядро недоступно: честные fetch-зонды для HTTP/API
// и синтез для ICMP/RTSP/SIP (браузер не умеет слать ICMP). В серверном режиме
// движок выключен — все проверки выполняет ядро.

import { getState, store, useToasts } from './store';
import type { AidaPoint, Device, GlancesPoint } from './types';
import { clamp, mulberry32, hashStr, rnd, rndInt } from './util';

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

  for (const a of s.agents) {
    const agentIv = Math.max(10, s.settings.intervals.agent ?? 30) * 1000;
    if (now - a.lastPoll >= agentIv) stepAgent(a.id, now);
  }

  for (const g of s.glances) {
    const gIv = Math.max(15, s.settings.intervals.glances ?? 60) * 1000;
    if (now - g.lastScrape >= gIv) stepGlancesDevice(g.id, now);
  }
}

// ─── Устройства ─────────────────────────────────────────────────────────────

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

async function realProbe(d: Device, timeoutMs: number): Promise<{ ok: boolean; latency: number }> {
  const url = probeUrl(d);
  if (!url) return { ok: false, latency: 0 };
  const ctrl = new AbortController();
  const to = window.setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = performance.now();
  try {
    await fetch(url, { mode: 'no-cors', cache: 'no-store', signal: ctrl.signal, method: d.method ?? 'GET' });
    return { ok: true, latency: Math.max(1, Math.round(performance.now() - t0)) };
  } catch {
    return { ok: false, latency: 0 };
  } finally {
    window.clearTimeout(to);
  }
}

function simulatedProbe(d: Device, now: number): { ok: boolean; latency: number } {
  const slot = Math.floor(now / 1000 / Math.max(5, d.interval));
  const rng = mulberry32(hashStr(d.id) ^ slot);
  if (now < d.spikeUntil) return { ok: true, latency: Math.round(d.profile.base * (6 + rng() * 18)) };
  if (rng() < d.profile.failP) return { ok: false, latency: 0 };
  if (rng() < d.profile.spikeP) store.patchDevice(d.id, { spikeUntil: now + rndInt(40, 140) * 1000 });
  return { ok: true, latency: Math.max(1, Math.round(d.profile.base * (0.72 + rng() * 0.56))) };
}

async function runCheck(d: Device) {
  const s = getState();
  store.patchDevice(d.id, { checking: true });
  const url = probeUrl(d);
  let res: { ok: boolean; latency: number };
  let approx: boolean;
  if (url && (d.type === 'http' || d.type === 'api')) {
    res = await realProbe(d, s.settings.timeoutMs);
    approx = false;
  } else if (!url) {
    res = { ok: false, latency: 0 };
    approx = true;
  } else {
    await new Promise((r) => setTimeout(r, rndInt(120, 500)));
    res = simulatedProbe(d, Date.now());
    approx = true;
  }
  applyResult(d.id, res.ok, res.latency, approx);
}

export async function forceCheck(id: string): Promise<{ ok: boolean; latency: number } | null> {
  const s = getState();
  if (s.apiMode === 'server') {
    const { api, syncAll } = await import('./api');
    const r = await api.checkDevice(id);
    void syncAll();
    return { ok: r.result.ok, latency: r.result.latency ?? 0 };
  }
  const d = s.devices.find((x) => x.id === id);
  if (!d) return null;
  await runCheck(d);
  const fresh = getState().devices.find((x) => x.id === id);
  return fresh ? { ok: fresh.status !== 'down', latency: fresh.latency ?? 0 } : null;
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

  const base = d.baseline ?? d.profile.base;
  const degraded = latency > base * cfg.degradeFactor && latency > cfg.degradeMinMs;
  const status: Device['status'] = degraded ? 'degraded' : 'up';

  if (d.status === 'down') {
    store.pushEvent('ok', 'device', `${d.name} (${d.address}) — связь восстановлена`);
    if (cfg.notifications.on.recover) dispatchNotification('recover', 'PLUTO: восстановление', `${d.name} снова в строю`);
  } else if (degraded && d.status !== 'degraded') {
    store.pushEvent('warn', 'device', `${d.name}: деградация связи — ${latency} мс при базовых ${Math.round(base)} мс`);
    if (cfg.notifications.on.degraded) dispatchNotification('degraded', 'PLUTO: деградация', `${d.name}: задержка ${latency} мс`);
  }

  store.patchDevice(id, {
    status, fails: 0, latency, baseline: Math.round(base * 0.9 + latency * 0.1),
    lastCheck: now, lastChange: status === d.status ? d.lastChange : now, history, checking: false, approx,
  });
}

// ─── Агенты (эмуляция телеметрии AIDA64 / Glances) ──────────────────────────

function stepAgent(id: string, now: number) {
  const s = getState();
  const a = s.agents.find((x) => x.id === id);
  if (!a) return;

  const rng = mulberry32(hashStr(id) ^ Math.floor(now / 1000));
  const online = rng() > 0.015;
  const ms = online ? Math.round(rnd(1, 40)) : null;

  const aidaIv = Math.max(10, s.settings.intervals.aida ?? 10) * 1000;
  const dueAida = a.aidaUrl && now - a.lastAida >= aidaIv;
  const glIv = Math.max(15, s.settings.intervals.glances ?? 60) * 1000;
  const dueGl = a.glancesUrl && now - a.lastGlances >= glIv;

  let latest = a.latest;
  let aida = a.aida;
  if (online && dueAida) {
    const pt: AidaPoint = {
      t: now,
      cpuUsage: Math.round(rnd(2, 85)), cpuTemp: Math.round(rnd(36, 72)), ram: Math.round(rnd(20, 90)),
      ssdTemp: Math.round(rnd(30, 58)), diskC: Math.round(rnd(30, 80)), usedSpaceC: Math.round(rnd(60, 400)),
      tx: Math.round(rnd(0, 3000) * 10) / 10, rx: Math.round(rnd(0, 8000) * 10) / 10,
      uptimeSec: Math.floor((now - a.createdAt) / 1000),
    };
    latest = pt;
    aida = [...aida, pt].slice(-4000);
  }

  let glancesLatest = a.glancesLatest;
  let glances = a.glances;
  if (online && dueGl) {
    const pt: GlancesPoint = {
      t: now,
      cpu: Math.round(rnd(2, 90) * 10) / 10, user: Math.round(rnd(1, 50) * 10) / 10,
      system: Math.round(rnd(1, 25) * 10) / 10, iowait: Math.round(rnd(0, 10) * 10) / 10,
      idle: Math.round(rnd(10, 95) * 10) / 10, irq: 0, nice: 0, steal: 0,
      mem: Math.round(rnd(20, 90) * 10) / 10, memTotal: 16, memUsed: Math.round(rnd(3, 14) * 10) / 10,
      memFree: Math.round(rnd(1, 8) * 10) / 10,
      rx: Math.round(rnd(0, 5000) * 10) / 10, tx: Math.round(rnd(0, 1500) * 10) / 10,
      pkg: Math.round(rnd(35, 78) * 10) / 10,
      diskCount: 3, diskUsed: Math.round(rnd(30, 80) * 10) / 10,
    };
    glancesLatest = pt;
    glances = [...glances, pt].slice(-4000);
  }

  store.patchAgent(id, {
    online, latency: ms,
    onlineSince: online ? (a.onlineSince || now) : 0,
    lastSeen: online ? now : a.lastSeen,
    lastPoll: now,
    lastAida: dueAida && online ? now : a.lastAida,
    lastGlances: dueGl && online ? now : a.lastGlances,
    latest, aida, glancesLatest, glances,
    latHist: [...a.latHist, { t: now, ms }].slice(-480),
    lastError: online ? null : 'агент недоступен (эмуляция)',
  });
}

// ─── Glances-устройства (Bars, эмуляция) ────────────────────────────────────

function stepGlancesDevice(id: string, now: number) {
  const s = getState();
  const g = s.glances.find((x) => x.id === id);
  if (!g) return;
  const online = Math.random() > 0.02;
  if (!online) {
    set({ glances: getState().glances.map((x) => (x.id === id ? { ...x, online: false, lastScrape: now, lastError: 'сервер не ответил (эмуляция)' } : x)) });
    return;
  }
  const pt: GlancesPoint = {
    t: now,
    cpu: Math.round(rnd(2, 90) * 10) / 10, user: Math.round(rnd(1, 50) * 10) / 10,
    system: Math.round(rnd(1, 25) * 10) / 10, iowait: Math.round(rnd(0, 8) * 10) / 10,
    idle: Math.round(rnd(10, 95) * 10) / 10, irq: 0, nice: 0, steal: 0,
    mem: Math.round(rnd(20, 90) * 10) / 10, memTotal: 32, memUsed: Math.round(rnd(4, 28) * 10) / 10,
    memFree: Math.round(rnd(2, 16) * 10) / 10,
    rx: Math.round(rnd(0, 20000) * 10) / 10, tx: Math.round(rnd(0, 5000) * 10) / 10,
    diskCount: 4, diskUsed: Math.round(rnd(25, 85) * 10) / 10,
    pkg: Math.round(rnd(35, 80) * 10) / 10,
  };
  set({
    glances: getState().glances.map((x) =>
      x.id === id
        ? { ...x, online: true, lastScrape: now, lastError: null, latest: pt, history: [...(x.history || []), pt].slice(-4000) }
        : x,
    ),
  });
}

function set(patch: Partial<ReturnType<typeof getState>>) {
  // локальная мутация для эмуляционного режима (вне серверного стора)
  const s = getState();
  store.applyServerState({
    devices: patch.devices ?? s.devices,
    agents: patch.agents ?? s.agents,
    glances: patch.glances ?? s.glances,
    tags: s.tags,
    events: s.events,
    settings: s.settings,
  });
}

// ─── Уведомления ─────────────────────────────────────────────────────────────

type NotifyKind = 'down' | 'degraded' | 'recover' | 'agentOff' | 'agentOn';

function dispatchNotification(kind: NotifyKind, title: string, body: string) {
  const n = getState().settings.notifications;
  if (n.push.enabled && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try { new Notification(title, { body, tag: `${kind}-${Date.now()}` }); } catch { /* без поддержки */ }
  }
  if (n.telegram.enabled && n.telegram.botToken.trim() && n.telegram.chatId.trim()) {
    fetch(`https://api.telegram.org/bot${n.telegram.botToken.trim()}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: n.telegram.chatId.trim(), text: `${title}\n${body}` }),
    }).catch(() => useToasts.push('warn', 'Telegram: уведомление не доставлено'));
  }
}

export function sendTestNotification(kind: 'push' | 'telegram' | 'email'): { ok: boolean; text: string } {
  const n = getState().settings.notifications;
  const body = 'Проверочное уведомление системы мониторинга PLUTO.';
  if (kind === 'push') {
    if (typeof Notification === 'undefined') return { ok: false, text: 'Браузер не поддерживает уведомления' };
    if (Notification.permission !== 'granted') return { ok: false, text: 'Разрешение на уведомления не выдано' };
    try { new Notification('PLUTO: тест', { body }); return { ok: true, text: 'Уведомление показано' }; }
    catch { return { ok: false, text: 'Не удалось показать уведомление' }; }
  }
  if (kind === 'telegram') {
    if (!n.telegram.botToken.trim() || !n.telegram.chatId.trim()) return { ok: false, text: 'Заполните токен бота и chat_id' };
    fetch(`https://api.telegram.org/bot${n.telegram.botToken.trim()}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: n.telegram.chatId.trim(), text: `PLUTO: тест\n${body}` }),
    })
      .then((r) => useToasts.push(r.ok ? 'ok' : 'warn', r.ok ? 'Telegram: тест отправлен' : 'Telegram: ошибка API'))
      .catch(() => useToasts.push('warn', 'Telegram: запрос не прошёл'));
    return { ok: true, text: 'Запрос к Telegram API отправлен' };
  }
  return { ok: true, text: 'Письмо поставлено в очередь (SMTP работает на сервере ядра)' };
}

export function requestPushPermission(): Promise<boolean> {
  if (typeof Notification === 'undefined') return Promise.resolve(false);
  return Notification.requestPermission().then((p) => p === 'granted');
}

export { clamp };
