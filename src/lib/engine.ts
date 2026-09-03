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
    const seed = mulberry32(hashStr(a.id));
    const disks = ['C:', 'D:'].map((mnt, i) => ({
      mnt, percent: Math.round(rnd(30, 85)), usedGB: Math.round(rnd(100, 700)), sizeGB: 931 - i * 400,
      temp: Math.round(rnd(32, 52) * 10) / 10, readKBs: Math.round(rnd(0, 30000) * 10) / 10, writeKBs: Math.round(rnd(0, 12000) * 10) / 10,
    }));
    const adapters = [
      { name: 'Ethernet', rx: pt.rx, tx: pt.tx, virtual: false },
      { name: 'Wi-Fi', rx: Math.round(rnd(0, 800) * 10) / 10, tx: Math.round(rnd(0, 200) * 10) / 10, virtual: false },
      { name: 'vEthernet (WSL)', rx: Math.round(rnd(0, 100)), tx: Math.round(rnd(0, 40)), virtual: true },
    ];
    const cput = pt.cput ?? 48;
    glancesLatest = {
      t: now, hostname: `PC-${a.name.replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase() || 'EMU'}`,
      os: 'Microsoft Windows 11 Pro 23H2',
      cpu: pt.cpu, cpuCores: Array.from({ length: 8 }, () => Math.round(rnd(5, 90) * 10) / 10),
      gpu: pt.gpu, gpuTemp: Math.round(rnd(38, 62) * 10) / 10, ram: pt.ram,
      ramUsedGB: 12.4, ramTotalGB: 32, swap: 3.2, swapUsedGB: 0.4, swapTotalGB: 12.8,
      load1: Math.round(rnd(0.2, 2.4) * 100) / 100, load5: Math.round(rnd(0.2, 1.8) * 100) / 100, load15: Math.round(rnd(0.2, 1.2) * 100) / 100,
      procCount: Math.round(rnd(180, 320)),
      cput, ssdt: pt.ssdt,
      disks, adapters, mainAdapter: 'Ethernet',
      rx: pt.rx, tx: pt.tx,
      sensors: [
        { label: 'Package id 0', value: cput, unit: '°C', kind: 'temperature_core' },
        { label: 'GPU', value: Math.round(rnd(38, 62) * 10) / 10, unit: '°C', kind: 'temperature_gpu' },
        { label: 'ST2000 SSD', value: pt.ssdt ?? 41, unit: '°C', kind: 'temperature_disk' },
        { label: 'CPU Fan', value: Math.round(rnd(700, 1600)), unit: 'RPM', kind: 'fan_speed' },
        { label: 'Battery', value: Math.round(rnd(60, 100)), unit: '%', kind: 'battery' },
      ],
      uptimeSec: Math.floor((now - a.createdAt) / 1000), via: `emu${seed() > 0.5 ? 4 : 3}`,
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
