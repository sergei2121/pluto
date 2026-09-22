// ─── PLUTO: встроенный движок (браузерная эмуляция без серверного ядра) ──────
import { getState, store, useToasts } from './store';
import type { Agent, Device, GlancesPoint, RelayPingResult, RelayTargetResult } from './types';
import { clamp, hashStr, mulberry32, rnd } from './util';

let timer: number | null = null;
let barsPollTimer: number | null = null;

export function startEngine() { 
  if (timer == null) timer = window.setInterval(tick, 1000); 
  if (barsPollTimer == null) barsPollTimer = window.setInterval(pollBarsAgents, 20000);
}
export function stopEngine() { 
  if (timer != null) window.clearInterval(timer); timer = null; 
  if (barsPollTimer != null) window.clearInterval(barsPollTimer); barsPollTimer = null;
}

// Принудительный опрос агентов с тегом "Bars" каждые 20 секунд
async function pollBarsAgents() {
  const s = getState();
  const barsAgents = s.agents.filter(a => a.tags.includes('Bars'));
  for (const a of barsAgents) {
    const now = Date.now();
    // Эмуляция опроса онлайн-статуса
    const rng = mulberry32(hashStr(a.id) ^ Math.floor(now / 1000));
    const online = rng() > 0.03;
    const ms = online ? Math.round(rnd(1, 40)) : null;
    
    store.updateAgent(a.id, {
      online,
      latency: ms,
      onlineSince: online ? (a.onlineSince || now) : 0,
      lastSeen: online ? now : a.lastSeen,
      lastPoll: now,
    });
  }
}

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
      // Устройство ушло в офлайн — фиксируем время начала офлайна
      const offlineSince = d.offlineSince || now;
      store.updateDevice(id, { status: 'down', fails, latency: null, lastCheck: now, lastChange: now, history, checking: false, approx: true, offlineSince });
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

  // Вычисляем время в офлайне за последние 30 дня перед восстановлением
  let offlineDuration30d = d.offlineDuration30d || 0;
  if (d.status === 'down' && d.offlineSince) {
    const offlineTime = now - d.offlineSince;
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    // Добавляем к накопленной длительности, ограничивая 30 днями
    offlineDuration30d = Math.min(thirtyDaysMs, (offlineDuration30d || 0) + offlineTime);
  }

  if (d.status === 'down') store.pushEvent('ok', 'device', `${d.name} — связь восстановлена`);
  else if (degraded && d.status !== 'degraded') store.pushEvent('warn', 'device', `${d.name}: деградация ${latency} мс`);

  store.updateDevice(id, {
    status, fails: 0, latency, baseline, lastCheck: now, lastSuccess: now,
    lastChange: status === d.status ? d.lastChange : now, history, checking: false, approx: true,
    offlineSince: null, offlineDuration30d,
  });
}

export async function forceCheck(id: string): Promise<void> {
  await runCheck(id);
}

// ─── Агенты ──────────────────────────────────────────────────────────────────

// Генератор псевдо-случайных чисел на основе seed для детерминированной эмуляции
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mockGlancesPoint(t: number, agentId: string): GlancesPoint {
  // Используем hash от agentId + времени для детерминированной генерации
  const baseSeed = hashStr(agentId);
  const timeBucket = Math.floor(t / 5000); // каждые 5 секунд новое значение
  
  // Реалистичные диапазоны для разных метрик с индивидуальными seed
  const cpu = Math.round((5 + mulberry32(baseSeed ^ timeBucket ^ 1)() * 45) * 10) / 10;      // 5-50%
  const gpu = Math.round(mulberry32(baseSeed ^ timeBucket ^ 2)() * 35 * 10) / 10;            // 0-35%
  const ram = Math.round((30 + mulberry32(baseSeed ^ timeBucket ^ 3)() * 40) * 10) / 10;     // 30-70%
  const rx = Math.round(mulberry32(baseSeed ^ timeBucket ^ 4)() * 3000 * 10) / 10;           // 0-3000 КБ/с
  const tx = Math.round(mulberry32(baseSeed ^ timeBucket ^ 5)() * 1000 * 10) / 10;           // 0-1000 КБ/с
  const cput = Math.round((40 + mulberry32(baseSeed ^ timeBucket ^ 6)() * 35) * 10) / 10;    // 40-75°C
  const ssdt = Math.round((32 + mulberry32(baseSeed ^ timeBucket ^ 7)() * 20) * 10) / 10;    // 32-52°C
  const diskUsed = Math.round((25 + mulberry32(baseSeed ^ timeBucket ^ 8)() * 50) * 10) / 10; // 25-75%
  const diskRead = Math.round(mulberry32(baseSeed ^ timeBucket ^ 9)() * 500 * 10) / 10;      // 0-500 Rps
  const diskWrite = Math.round(mulberry32(baseSeed ^ timeBucket ^ 10)() * 300 * 10) / 10;    // 0-300 Wps
  
  return {
    t, cpu, gpu, ram, rx, tx, cput, ssdt, diskUsed, diskRead, diskWrite,
    swap: null, load1: null, load5: null, load15: null, fanSpeed: null, battery: null, wifiQuality: null,
  };
}

// Хранение предыдущего количества дисков для каждого агента (для детектирования уменьшения)
const agentPrevDiskCount = new Map<string, number>();

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
    // Генерируем случайные диски для эмуляции (от 1 до 5 дисков, размер от 250 ГБ до 4 ТБ)
    // Используем детерминированный seed на основе agentId и времени
    const diskSeed = hashStr(a.id) ^ Math.floor(now / 60000); // меняем раз в минуту
    const diskRng = mulberry32(diskSeed);
    const diskCount = Math.floor(1 + diskRng() * 5); // 1-5 дисков
    const disks = Array.from({ length: diskCount }, (_, i) => {
      const sizeRng = mulberry32(diskSeed ^ (i + 1));
      return ({
        mnt: i === 0 ? '/' : `/mnt/disk${i}`,
        percent: Math.round((20 + sizeRng() * 65) * 10) / 10, // 20-85%
        usedGB: Math.round((100 + sizeRng() * 700)), // 100-800 ГБ
        sizeGB: Math.round((250 + sizeRng() * 3750)), // 250-4000 ГБ
      });
    });
    
    const pt = mockGlancesPoint(now, a.id);
    glancesLatest = {
      t: now, cpu: pt.cpu, cpuCores: [], gpu: pt.gpu, gpuTemp: null, ram: pt.ram,
      ramUsedGB: null, ramTotalGB: null, swap: pt.swap, load1: pt.load1, load5: pt.load5, load15: pt.load15,
      cput: pt.cput, ssdt: pt.ssdt, disks, adapters: [], mainAdapter: null,
      rx: pt.rx, tx: pt.tx, sensors: [], uptimeSec: Math.floor((now - a.createdAt) / 1000), via: 'emu',
      diskRead: pt.diskRead, diskWrite: pt.diskWrite, fanSpeed: pt.fanSpeed, battery: pt.battery, batteryTimeLeft: null,
      batteryIsCharging: null, wifiSSID: null, wifiQuality: pt.wifiQuality, wifiSignal: null, wifiBitrate: null,
      processes: [], containers: [], cloudProvider: null, hddTemp: null, cpuUser: null, cpuSystem: null,
      cpuIowait: null, cpuFreq: null, gpuMem: null, gpuMemPercent: null, ramAvailableGB: null,
      swapUsedGB: null, swapTotalGB: null,
    };
    
    // Проверка на уменьшение количества дисков
    const prevCount = agentPrevDiskCount.get(id);
    const currCount = disks.length;
    if (prevCount != null && currCount < prevCount) {
      store.pushEvent('crit', 'agent', `${a.name}: уменьшение количества дисков (${prevCount} → ${currCount})`);
    }
    agentPrevDiskCount.set(id, currCount);
    
    glances = [...glances, pt].slice(-4000);
  } else if (!online) {
    // Если агент офлайн, сбрасываем счетчик
    agentPrevDiskCount.delete(id);
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
    targets: emulateRelayPings(a.targets, now, id),
  });
}

// Эмуляция пингов relay-агента для его целей (IP/диапазоны)
function emulateRelayPings(targets: RelayTargetResult[], now: number, agentId: string): RelayTargetResult[] {
  const rng = mulberry32(hashStr(agentId) ^ Math.floor(now / 5000));
  return targets.map((target) => {
    const ips = expandIpRange(target.range || '');
    const results: RelayPingResult[] = ips.map((ip, idx) => {
      const ipRng = mulberry32(hashStr(ip) ^ Math.floor(now / 10000) ^ idx);
      const alive = ipRng() > 0.05; // 5% шанс офлайна
      const latency = alive ? Math.round(1 + ipRng() * 50) : null;
      
      // Находим существующий результат для этого IP, если есть
      const existingResults = Array.isArray(target.results) ? target.results : [];
      const existing = existingResults.find(r => r.ip === ip);
      
      let lastSuccess = (existing?.lastSuccess != null && existing.lastSuccess > 0) ? existing.lastSuccess : null;
      let offlineSince = existing?.offlineSince ?? null;
      let offlineDuration30d = existing?.offlineDuration30d ?? 0;
      
      if (alive) {
        lastSuccess = now;
        // Если был в офлайне, добавляем длительность к накопленной
        if (offlineSince !== null) {
          const offlineTime = now - offlineSince;
          const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
          offlineDuration30d = Math.min(thirtyDaysMs, offlineDuration30d + offlineTime);
          offlineSince = null;
        }
      } else {
        // Ушёл в офлайн
        if (offlineSince === null) {
          offlineSince = now;
        }
      }
      
      return {
        ip,
        alive,
        latency,
        lastSuccess,
        offlineSince,
        offlineDuration30d,
      };
    });
    
    return { ...target, results, lastCheck: now };
  });
}

// Раскрытие диапазона IP в список отдельных IP
function expandIpRange(range: string): string[] {
  if (!range) return [];
  // Проверка на диапазон вида "192.168.1.10-192.168.1.20"
  const rangeMatch = range.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})\.(\d+)-(\d+)$/);
  if (rangeMatch) {
    const base = rangeMatch[1];
    const start = parseInt(rangeMatch[2], 10);
    const end = parseInt(rangeMatch[3], 10);
    const result: string[] = [];
    for (let i = Math.min(start, end); i <= Math.max(start, end); i++) {
      result.push(`${base}.${i}`);
    }
    return result;
  }
  // Одиночный IP или CIDR (упрощённо)
  if (range.includes('/')) {
    // Простая эмуляция для CIDR /24
    const cidrMatch = range.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})\.(\d+)\/(\d+)$/);
    if (cidrMatch && cidrMatch[3] === '24') {
      const base = cidrMatch[1];
      const result: string[] = [];
      for (let i = 1; i <= 254; i++) {
        result.push(`${base}.${i}`);
      }
      return result;
    }
  }
  // Просто IP без диапазона
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(range)) {
    return [range];
  }
  return [];
}

export function sendTestNotification(): void {
  useToasts.push('ok', 'Тестовое уведомление отправлено (эмуляция)');
}

export function requestPushPermission(): void {
  if (typeof Notification !== 'undefined') void Notification.requestPermission();
}
