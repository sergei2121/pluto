// ─── PLUTO: встроенное ядро (fallback, когда серверного ядра нет) ───────────
// Браузер не может слать ICMP/RTSP/SIP, поэтому задержки здесь синтетические и
// помечены approx:true. Как только доступно серверное ядро, консоль
// переключается на реальные данные и этот движок не запускается.

import { getState, store, useToasts } from './store';
import { api } from './api';
import type { Device } from './types';
import { clamp, fmtMs, hashStr, mulberry32, rnd, rndInt } from './util';

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
    const interval = Math.max(5, d.interval) * 1000;
    if (now - d.lastCheck >= interval) void runCheck(d);
  }

  for (const a of s.agents) {
    if (a.online) {
      if (now - a.lastMetrics >= s.settings.metrics * 1000) stepAgentMetrics(a.id, now);
      if (now > a.lastScan + s.settings.lanScan * 1000) rescanLan(a.id, now);
      if (Math.random() < 0.0004) setAgentOffline(a.id);
    }
  }
}

function simulatedProbe(d: Device, now: number): { ok: boolean; latency: number } {
  const slot = Math.floor(now / 1000 / Math.max(5, d.interval));
  const rng = mulberry32(hashStr(d.id) ^ slot);
  if (rng() < 0.02) return { ok: false, latency: 0 };
  const base = d.baseline ?? 20;
  if (rng() < 0.04) return { ok: true, latency: Math.round(base * (6 + rng() * 15)) };
  return { ok: true, latency: Math.max(1, Math.round(base * (0.72 + rng() * 0.56))) };
}

async function runCheck(d: Device): Promise<void> {
  const s = getState();
  store.patchDevice(d.id, { checking: true });
  await sleep(rndInt(120, 500));
  const res = simulatedProbe(d, Date.now());
  applyResult(d.id, res.ok, res.latency);
}

/** «Проверить сейчас»: в серверном режиме — силами ядра, иначе эмуляция. */
export async function forceCheck(id: string): Promise<{ ok: boolean; latency: number } | null> {
  const s = getState();
  if (s.apiMode === 'server') {
    try {
      const r = await api.checkDevice(id);
      await import('./store').then((m) => m.syncAll());
      return { ok: r.result.ok, latency: r.result.latency ?? 0 };
    } catch {
      return null;
    }
  }
  const d = s.devices.find((x) => x.id === id);
  if (!d) return null;
  await runCheck(d);
  const fresh = getState().devices.find((x) => x.id === id);
  return fresh ? { ok: fresh.status !== 'down', latency: fresh.latency ?? 0 } : null;
}

function applyResult(id: string, ok: boolean, latency: number) {
  const s = getState();
  const d = s.devices.find((x) => x.id === id);
  if (!d) return;
  const now = Date.now();
  const cfg = s.settings;
  const history = [...d.history, ok ? latency : -1].slice(-48);

  if (!ok) {
    const fails = d.fails + 1;
    if (fails >= cfg.failThreshold && d.status !== 'down') {
      store.patchDevice(id, { status: 'down', fails, latency: null, lastCheck: now, lastChange: now, history, checking: false, approx: true });
      store.pushEvent('crit', 'device', `${d.name} (${d.address}) — потеря связи (${fails} сб. подряд)`);
      notify('down', `${d.name} (${d.address}) — потеря связи`);
    } else {
      store.patchDevice(id, { fails, lastCheck: now, history, checking: false, approx: true });
    }
    return;
  }

  const degraded = latency > (d.baseline ?? 20) * cfg.degradeFactor && latency > cfg.degradeMinMs;
  const status: Device['status'] = degraded ? 'degraded' : 'up';
  const baseline = d.baseline ? Math.round(d.baseline * 0.8 + latency * 0.2) : latency;

  if (d.status === 'down') {
    const downFor = Math.max(1, Math.round((now - d.lastChange) / 1000));
    store.pushEvent('ok', 'device', `${d.name} (${d.address}) — связь восстановлена, простой ${downFor} с`);
    if (cfg.notifications.on.recover) notify('recover', `${d.name} снова в строю, простой ${downFor} с`);
  } else if (degraded && d.status !== 'degraded') {
    store.pushEvent('warn', 'device', `${d.name}: деградация — ${fmtMs(latency)} при базовых ${fmtMs(d.baseline)}`);
    if (cfg.notifications.on.degraded) notify('degraded', `${d.name}: задержка ${fmtMs(latency)}`);
  }

  store.patchDevice(id, { status, fails: 0, latency, baseline, lastCheck: now, lastChange: status === d.status ? d.lastChange : now, history, checking: false, approx: true });
}

// ─── Агенты (эмуляция телеметрии) ───────────────────────────────────────────

function stepAgentMetrics(id: string, now: number) {
  const a = getState().agents.find((x) => x.id === id);
  if (!a) return;
  const cpuLoad = clamp(a.cpuLoad + rnd(-7, 7), 2, 98);
  const ramUsed = clamp(a.ramUsed + (a.ramTotal || 8e9) * rnd(-0.02, 0.022), 1e9, (a.ramTotal || 8e9) * 0.94);
  const rxRate = clamp(a.rxRate * 0.6 + rnd(20, 900), 0, 12000);
  const txRate = clamp(a.txRate * 0.6 + rnd(5, 400), 0, 8000);
  store.patchAgent(id, {
    cpuLoad,
    cpuTemp: clamp(36 + cpuLoad * 0.42 + rnd(-1.5, 1.5), 32, 95),
    ramUsed,
    ramTemp: clamp(34 + rnd(-1, 1), 30, 80),
    rxRate,
    txRate,
    lastSeen: now,
    lastMetrics: now,
    history: [...a.history, { t: now, cpu: cpuLoad, ram: (ramUsed / (a.ramTotal || 1)) * 100 }].slice(-90),
  });
}

function rescanLan(id: string, now: number) {
  const a = getState().agents.find((x) => x.id === id);
  if (!a) return;
  const networks = a.networks.map((n) => ({
    ...n,
    hosts: n.hosts.map((h) => (Math.random() < 0.15 ? { ...h, online: Math.random() > 0.4 } : h)),
  }));
  store.patchAgent(id, { networks, lastScan: now });
}

export function setAgentOffline(id: string) {
  const a = getState().agents.find((x) => x.id === id);
  if (!a) return;
  store.patchAgent(id, { online: false, lastSeen: Date.now() });
  store.pushEvent('crit', 'agent', `Агент ${a.name} — соединение потеряно`);
  if (getState().settings.notifications.on.agentOff) notify('agentOff', `Агент ${a.name} перестал отвечать`);
}

export function setAgentOnline(id: string) {
  const a = getState().agents.find((x) => x.id === id);
  if (!a) return;
  store.patchAgent(id, { online: true, lastSeen: Date.now(), lastMetrics: Date.now() });
  store.pushEvent('ok', 'agent', `Агент ${a.name} снова в сети`);
}

// ─── Уведомления ─────────────────────────────────────────────────────────────

function notify(kind: string, body: string) {
  const s = getState();
  const n = s.settings.notifications;
  if (n.push.enabled && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      new Notification('PLUTO', { body, tag: kind + '-' + Date.now() });
    } catch {
      /* среда без Notification */
    }
  }
  if (n.telegram.enabled && n.telegram.botToken.trim() && n.telegram.chatId.trim()) {
    fetch(`https://api.telegram.org/bot${n.telegram.botToken.trim()}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: n.telegram.chatId.trim(), text: `PLUTO: ${body}` }),
    }).catch(() => useToasts.push('warn', 'Telegram: уведомление не доставлено'));
  }
}

export function requestPushPermission(): void {
  if (typeof Notification === 'undefined') {
    useToasts.push('warn', 'Браузер не поддерживает уведомления');
    return;
  }
  void Notification.requestPermission().then((p) => {
    if (p === 'granted') useToasts.push('ok', 'Разрешение на уведомления получено');
    else useToasts.push('warn', 'Разрешение не выдано');
  });
}

export function sendTestNotification(kind: 'push' | 'telegram' | 'email'): { ok: boolean; text: string } {
  const s = getState();
  const n = s.settings.notifications;
  const body = 'Проверочное уведомление PLUTO. Канал связи работает.';
  if (kind === 'push') {
    if (typeof Notification === 'undefined') return { ok: false, text: 'Браузер не поддерживает уведомления' };
    if (Notification.permission !== 'granted') return { ok: false, text: 'Разрешение не выдано' };
    try {
      new Notification('PLUTO: тест', { body });
      return { ok: true, text: 'Уведомление показано' };
    } catch {
      return { ok: false, text: 'Не удалось показать уведомление' };
    }
  }
  if (kind === 'telegram') {
    if (!n.telegram.botToken.trim() || !n.telegram.chatId.trim()) return { ok: false, text: 'Заполните токен бота и chat_id' };
    fetch(`https://api.telegram.org/bot${n.telegram.botToken.trim()}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: n.telegram.chatId.trim(), text: `PLUTO: тест\n${body}` }),
    })
      .then((r) => (r.ok ? useToasts.push('ok', 'Telegram: тест отправлен') : useToasts.push('warn', 'Telegram: ошибка API')))
      .catch(() => useToasts.push('warn', 'Telegram: запрос не прошёл'));
    return { ok: true, text: 'Запрос к Telegram отправлен' };
  }
  return { ok: true, text: 'Письмо поставлено в очередь (SMTP на сервере ядра)' };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
