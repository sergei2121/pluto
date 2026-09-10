// ─── PLUTO: встроенный движок (браузерная эмуляция без серверного ядра) ──────
import { getState, store, useToasts } from './store';
import type { Agent, Device, GlancesPoint } from './types';
import { clamp, hashStr, mulberry32, rnd } from './util';

let timer: number | null = null;

export function startEngine() { if (timer == null) timer = window.setInterval(tick, 1000); }
export function stopEngine() { if (timer != null) window.clearInterval(timer); timer = null; }

function tick() {
  const s = getState();
  if (!s.session) return;
  const now = Date.now();

  for (const d of s.devices) {
    if (d.checking) continue;
    const interval = Math.max(5, d.interval) * 1000;
    if (now - d.lastCheck >= interval) void runCheck(d.id);
  }

  for (const a of s.agents) {
    const aiv = Math.max(10, s.settings.intervals.agent || 30) * 1000;
    if (now - a.lastPoll >= aiv) stepAgent(a.id, now);
  }
}

// ─── Устройства ──────────────────────────────────────────────────────────────

async function runCheck(id: string) {
  const s = getState();
  const d = s.devices.find((x) => x.id === id);
  if (!d) return;
  store.updateDevice(id, { checking: true });
  await new Promise((r) => setTimeout(r, 120 + Math.random() * 400));

  const rng = mulberry32(hashStr(id) ^ Math.floor(Date.now() / 1000 / Math.max(5, d.interval)));
  const ok = rng() > 0.06;
  const now = Date.now();
  const cfg = s.settings;

  if (!ok) {
    const fails = d.fails + 1;
    const history = [...d.history, -1].slice(-48);
    if (fails >= cfg.failThreshold && d.status !== 'down') {
      store.updateDevice(id, { status: 'down', fails, latency: null, lastCheck: now, lastChange: now, history, checking: false, approx: true });
      store.pushEvent('crit', 'device', `${d.name} (${d.address}) — потеря связи`);
    } else {
      store.updateDevice(id, { fails, lastCheck: now, history, checking: false, approx: true });
    }
    return;
  }

  const baseline = d.baseline ?? 8 + (hashStr(d.address) % 40);
  const latency = Math.max(1, Math.round(baseline * (0.7 + rng() * 0.6)));
  const degraded = latency > baseline * cfg.degradeFactor && latency > cfg.degradeMinMs;
  const status = degraded ? 'degraded' : 'up';
  const history = [...d.history, latency].slice(-48);

  if (d.status === 'down') store.pushEvent('ok', 'device', `${d.name} — связь восстановлена`);
  else if (degraded && d.status !== 'degraded') store.pushEvent('warn', 'device', `${d.name}: деградация ${latency} мс`);

  store.updateDevice(id, {
    status, fails: 0, latency, baseline, lastCheck: now,
    lastChange: status === d.status ? d.lastChange : now, history, checking: false, approx: true,
  });
}

export async function forceCheck(id: string): Promise<void> {
  await runCheck(id);
}

// ─── Агенты ──────────────────────────────────────────────────────────────────

function mockGlancesPoint(t: number): GlancesPoint {
  return {
    t,
    cpu: Math.round(rnd(2, 90) * 10) / 10, gpu: Math.round(rnd(0, 70) * 10) / 10,
    ram: Math.round(rnd(20, 90) * 10) / 10,
    rx: Math.round(rnd(0, 5000) * 10) / 10, tx: Math.round(rnd(0, 1500) * 10) / 10,
    cput: Math.round(rnd(35, 78) * 10) / 10, ssdt: Math.round(rnd(30, 58) * 10) / 10,
    diskUsed: Math.round(rnd(30, 80) * 10) / 10,
  };
}

function stepAgent(id: string, now: number) {
  const s = getState();
  const a = s.agents.find((x) => x.id === id);
  if (!a) return;

  const rng = mulberry32(hashStr(id) ^ Math.floor(now / 1000));
  const online = rng() > 0.03;
  const ms = online ? Math.round(rnd(1, 40)) : null;

  const gIv = Math.max(10, s.settings.intervals.glances || 20) * 1000;
  const dueGl = !!a.glancesUrl && now - a.lastGlances >= gIv;

  let glancesLatest = a.glancesLatest;
  let glances = a.glances;
  if (online && dueGl) {
    const pt = mockGlancesPoint(now);
    glancesLatest = {
      t: now, cpu: pt.cpu, cpuCores: [], gpu: pt.gpu, gpuTemp: null, ram: pt.ram,
      ramUsedGB: null, ramTotalGB: null, swap: null, load1: null, load5: null,
      cput: pt.cput, ssdt: pt.ssdt, disks: [], adapters: [], mainAdapter: null,
      rx: pt.rx, tx: pt.tx, sensors: [], uptimeSec: Math.floor((now - a.createdAt) / 1000), via: 'emu',
    };
    glances = [...glances, pt].slice(-4000);
  }

  store.updateAgent(id, {
    online, latency: ms,
    onlineSince: online ? (a.onlineSince || now) : 0,
    lastSeen: online ? now : a.lastSeen,
    lastPoll: now,
    lastGlances: dueGl && online ? now : a.lastGlances,
    glancesLatest, glances,
    latHist: [...a.latHist, { t: now, ms }].slice(-480),
    glancesError: online ? null : 'агент недоступен (эмуляция)',
  });
}

export function sendTestNotification(): void {
  useToasts.push('ok', 'Тестовое уведомление отправлено (эмуляция)');
}

export function requestPushPermission(): void {
  if (typeof Notification !== 'undefined') void Notification.requestPermission();
}
