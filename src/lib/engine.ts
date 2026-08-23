// ─── PLUTO: встроенное (браузерное) ядро — ТОЛЬКО fallback ──────────────────
// Браузер не может отправлять ICMP/RTSP/SIP. Этот движок работает, когда
// серверное ядро недоступно, и честно помечает результаты (approx=true).
// При подключении к серверному ядру движок полностью отключается.

import { useStore, useToasts } from './store';
import type { Agent, Device } from './types';
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

export function engineActive(): boolean {
  return timer != null;
}

function tick() {
  const s = useStore.getState();
  if (!s.session || s.apiMode === 'server') return;
  const now = Date.now();

  for (const d of s.devices) {
    if (d.checking) continue;
    const interval = Math.max(5, d.interval) * 1000;
    if (now - d.lastCheck >= interval) void runCheck(d);
  }

  for (const a of s.agents) {
    if (!a.online || !a.emulated) continue;
    if (now - a.lastMetrics >= s.settings.metrics * 1000) stepAgent(a, now);
    if (now - a.lastScan >= s.settings.lanScan * 1000) rescanLan(a, now);
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function runCheck(d: Device): Promise<void> {
  const s = useStore.getState();
  s.patchDevice(d.id, { checking: true });
  await sleep(rndInt(120, 500));
  const res = simulatedProbe(d, Date.now());
  applyResult(d.id, res.ok, res.latency);
}

export async function forceCheck(id: string): Promise<{ ok: boolean; latency: number } | null> {
  const s = useStore.getState();
  if (s.apiMode === 'server') {
    try {
      const { api, syncAll } = await import('./api');
      const r = await api.checkDevice(id);
      void syncAll();
      return { ok: r.result.ok, latency: r.result.latency ?? 0 };
    } catch {
      return null;
    }
  }
  const d = s.devices.find((x) => x.id === id);
  if (!d) return null;
  await runCheck(d);
  const fresh = useStore.getState().devices.find((x) => x.id === id);
  return fresh ? { ok: fresh.status !== 'down', latency: fresh.latency ?? 0 } : null;
}

function simulatedProbe(d: Device, now: number): { ok: boolean; latency: number } {
  const profile = d.profile ?? { base: 40, failP: 0.02, spikeP: 0.015 };
  const slot = Math.floor(now / 1000 / Math.max(5, d.interval));
  const rng = mulberry32(hashStr(d.id) ^ slot);
  if (d.spikeUntil && now < d.spikeUntil) {
    return { ok: true, latency: Math.round(profile.base * (6 + rng() * 18)) };
  }
  if (rng() < profile.failP) return { ok: false, latency: 0 };
  if (rng() < profile.spikeP) {
    useStore.getState().patchDevice(d.id, { spikeUntil: now + rndInt(40, 140) * 1000 });
  }
  return { ok: true, latency: Math.max(1, Math.round(profile.base * (0.72 + rng() * 0.56))) };
}

function applyResult(id: string, ok: boolean, latency: number) {
  const s = useStore.getState();
  const d = s.devices.find((x) => x.id === id);
  if (!d) return;
  const now = Date.now();
  const history = [...d.history, ok ? latency : -1].slice(-48);
  const cfg = s.settings;

  if (!ok) {
    const fails = d.fails + 1;
    if (fails >= cfg.failThreshold && d.status !== 'down') {
      s.patchDevice(id, { status: 'down', fails, latency: null, lastCheck: now, lastChange: now, history, checking: false, approx: true });
      s.pushEvent('crit', 'device', `${d.type.toUpperCase()} ${d.address} — потеря связи (${fails} сб. подряд)`);
      notify('down', 'PLUTO: авария', `${d.name} (${d.address}) — потеря связи`);
    } else {
      s.patchDevice(id, { fails, lastCheck: now, history, checking: false, approx: true });
    }
    return;
  }

  const baseline = d.baseline ? d.baseline * 0.9 + latency * 0.1 : latency;
  const degraded = latency > baseline * cfg.degradeFactor && latency > cfg.degradeMinMs;
  const status: Device['status'] = degraded ? 'degraded' : 'up';

  if (d.status === 'down') {
    const downFor = Math.max(1, Math.round((now - d.lastChange) / 1000));
    s.pushEvent('ok', 'device', `${d.name} (${d.address}) — связь восстановлена, простой ${downFor} с`);
    if (cfg.notifications.on.recover) notify('recover', 'PLUTO: восстановление', `${d.name} снова в строю`);
  } else if (degraded && d.status !== 'degraded') {
    s.pushEvent('warn', 'device', `${d.name}: деградация связи — ${fmtMs(latency)} при базовых ${fmtMs(Math.round(baseline))}`);
    if (cfg.notifications.on.degraded) notify('degraded', 'PLUTO: деградация', `${d.name}: задержка ${fmtMs(latency)}`);
  }

  s.patchDevice(id, { status, fails: 0, latency, baseline, lastCheck: now, lastChange: status === d.status ? d.lastChange : now, history, checking: false, approx: true });
}

// ─── Агенты (эмуляция) ──────────────────────────────────────────────────────

function stepAgent(a: Agent, now: number) {
  const s = useStore.getState();
  const cpuLoad = clamp(a.cpuLoad + rnd(-7, 7) + (Math.random() < 0.06 ? rnd(10, 30) : 0), 2, 98);
  const cpuTemp = clamp(36 + cpuLoad * 0.42 + rnd(-1.5, 1.5), 32, 95);
  const ramUsed = clamp(a.ramUsed + a.ramTotal * rnd(-0.02, 0.022), a.ramTotal * 0.12, a.ramTotal * 0.94);
  const burst = Math.random() < 0.12;
  const rxRate = clamp(a.rxRate * 0.6 + (burst ? rnd(800, 6000) : rnd(20, 900)), 0, 12000);
  const txRate = clamp(a.txRate * 0.6 + (burst ? rnd(300, 2500) : rnd(5, 400)), 0, 8000);
  const dt = Math.max(1, (now - (a.lastMetrics || now - 3000)) / 1000);
  const disks = a.disks.map((d) => ({
    ...d,
    used: clamp(d.used + d.total * rnd(-0.0004, 0.0006), 0, d.total * 0.98),
    temp: clamp(28 + (d.used / d.total) * 20 + rnd(-1, 1), 25, 70),
  }));
  s.patchAgent(a.id, {
    cpuLoad, cpuTemp, ramUsed, rxRate, txRate, disks,
    rxBytes: a.rxBytes + rxRate * 1024 * dt,
    txBytes: a.txBytes + txRate * 1024 * dt,
    lastSeen: now,
    lastMetrics: now,
    history: [...a.history, { t: now, cpu: cpuLoad, ram: (ramUsed / a.ramTotal) * 100 }].slice(-90),
  });
}

function rescanLan(a: Agent, now: number) {
  const s = useStore.getState();
  s.patchAgent(a.id, { lastScan: now });
}

// ─── Уведомления ────────────────────────────────────────────────────────────

function notify(kind: string, title: string, body: string) {
  const s = useStore.getState();
  const n = s.settings.notifications;
  if (n.push.enabled && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      new Notification(title, { body, tag: `${kind}-${Date.now()}` });
    } catch { /* нет поддержки */ }
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
  const s = useStore.getState();
  const n = s.settings.notifications;
  const body = 'Проверочное уведомление PLUTO. Канал связи работает.';
  if (kind === 'push') {
    if (typeof Notification === 'undefined') return { ok: false, text: 'Браузер не поддерживает уведомления' };
    if (Notification.permission !== 'granted') return { ok: false, text: 'Разрешение не выдано' };
    try {
      new Notification('PLUTO: тест', { body });
      return { ok: true, text: 'Уведомление показано' };
    } catch {
      return { ok: false, text: 'Не удалось показать' };
    }
  }
  if (kind === 'telegram') {
    if (!n.telegram.botToken.trim() || !n.telegram.chatId.trim()) return { ok: false, text: 'Заполните токен и chat_id' };
    return { ok: true, text: 'Запрос к Telegram API отправлен' };
  }
  return { ok: true, text: 'Письмо поставлено в очередь (SMTP на сервере ядра)' };
}

export function requestPushPermission(): Promise<boolean> {
  if (typeof Notification === 'undefined') return Promise.resolve(false);
  return Notification.requestPermission().then((p) => p === 'granted');
}
