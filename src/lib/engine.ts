// ─── PLUTO: встроенный движок (браузерная эмуляция без серверного ядра) ──────
import { getState, store, useToasts } from './store';
import type { Agent, Device, GlancesPoint } from './types';
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
    if (now - a.lastPoll >= aiv) void stepAgent(a.id, now);
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

async function fetchGlancesData(agent: Agent): Promise<GlancesPoint | null> {
  if (!agent.glancesUrl) return null;
  
  try {
    // Базовый URL без trailing slash
    const baseUrl = agent.glancesUrl.replace(/\/$/, '');
    
    // Запрашиваем все необходимые плагины параллельно
    const [cpuRes, memRes, fsRes, smartRes, diskioRes] = await Promise.all([
      fetch(`${baseUrl}/api/4/cpu`).then(r => r.ok ? r.json() : null),
      fetch(`${baseUrl}/api/4/mem`).then(r => r.ok ? r.json() : null),
      fetch(`${baseUrl}/api/4/fs`).then(r => r.ok ? r.json() : null),
      fetch(`${baseUrl}/api/4/smart`).then(r => r.ok ? r.json() : null),
      fetch(`${baseUrl}/api/4/diskio`).then(r => r.ok ? r.json() : null),
    ]);
    
    if (!cpuRes || !memRes) return null;
    
    // Парсим CPU
    const cpu = typeof cpuRes.cpu === 'number' ? cpuRes.cpu : 0;
    const percpu = cpuRes.percpu || [];
    const cpuCores = percpu.map((p: any) => ({
      number: p.cpu_number || 0,
      total: p.total || 0,
      user: p.user || 0,
      system: p.system || 0,
      idle: p.idle || 0,
    }));
    
    // Парсим RAM
    const ramTotal = memRes.total || 0;
    const ramUsed = memRes.used || 0;
    const ram = ramTotal > 0 ? Math.round((ramUsed / ramTotal) * 1000) / 10 : 0;
    const ramUsedGB = ramTotal > 0 ? Math.round(ramUsed / 1024 / 1024 / 1024 * 10) / 10 : null;
    const ramTotalGB = ramTotal > 0 ? Math.round(ramTotal / 1024 / 1024 / 1024 * 10) / 10 : null;
    
    // Парсим файловые системы (диски)
    const disks: Array<{ mnt: string; percent: number; usedGB: number; sizeGB: number }> = [];
    if (Array.isArray(fsRes)) {
      for (const fs of fsRes) {
        const sizeGB = fs.size ? Math.round(fs.size / 1024 / 1024 / 1024 * 10) / 10 : 0;
        const usedGB = fs.used ? Math.round(fs.used / 1024 / 1024 / 1024 * 10) / 10 : 0;
        const percent = fs.percent || 0;
        disks.push({
          mnt: fs.mnt_point || fs.device_name || '',
          percent,
          usedGB,
          sizeGB,
        });
      }
    }
    
    // Парсим SMART (температуры SSD)
    let ssdt: number | null = null;
    if (Array.isArray(smartRes) && smartRes.length > 0) {
      const smartDevice = smartRes[0];
      // Ищем температуру в атрибутах SMART
      for (const key of Object.keys(smartDevice)) {
        const attr = smartDevice[key];
        if (attr && typeof attr === 'object' && attr.key === '_temperature') {
          ssdt = attr.value || null;
          break;
        }
      }
      // Альтернативно: ищем по имени
      if (ssdt === null) {
        for (const key of Object.keys(smartDevice)) {
          const attr = smartDevice[key];
          if (attr && typeof attr === 'object' && attr.name && attr.name.toLowerCase().includes('temperature')) {
            ssdt = attr.value || null;
            break;
          }
        }
      }
    }
    
    // Парсим diskio (чтение/запись)
    let diskRead = 0;
    let diskWrite = 0;
    if (Array.isArray(diskioRes) && diskioRes.length > 0) {
      // Суммируем по всем дискам
      for (const disk of diskioRes) {
        diskRead += disk.read_bytes_rate_per_sec || 0;
        diskWrite += disk.write_bytes_rate_per_sec || 0;
      }
      // Конвертируем в КБ/с
      diskRead = Math.round(diskRead / 1024 * 10) / 10;
      diskWrite = Math.round(diskWrite / 1024 * 10) / 10;
    }
    
    // Температура CPU (пытаемся получить из sensors, если доступно)
    let cput: number | null = null;
    // Пока оставляем null, так как sensors может быть пустым
    
    return {
      t: Date.now(),
      cpu,
      gpu: 0, // GPU пока не запрашиваем
      ram,
      rx: 0, // network пока не запрашиваем
      tx: 0,
      cput: cput || 0,
      ssdt: ssdt || 0,
      diskUsed: disks.length > 0 ? disks[0].percent : 0,
      diskRead,
      diskWrite,
    };
  } catch (err) {
    console.error('Error fetching Glances data:', err);
    return null;
  }
}

async function stepAgent(id: string, now: number) {
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
  let glancesError: string | null = null;
  
  if (online && dueGl && a.glancesUrl) {
    // Пытаемся получить реальные данные
    const point = await fetchGlancesData(a);
    
    if (point) {
      // Получаем диски из реальных данных
      const disks: Array<{ mnt: string; percent: number; usedGB: number; sizeGB: number }> = [];
      try {
        const baseUrl = a.glancesUrl.replace(/\/$/, '');
        const fsRes = await fetch(`${baseUrl}/api/4/fs`).then(r => r.ok ? r.json() : null);
        if (Array.isArray(fsRes)) {
          for (const fs of fsRes) {
            const sizeGB = fs.size ? Math.round(fs.size / 1024 / 1024 / 1024 * 10) / 10 : 0;
            const usedGB = fs.used ? Math.round(fs.used / 1024 / 1024 / 1024 * 10) / 10 : 0;
            const percent = fs.percent || 0;
            disks.push({
              mnt: fs.mnt_point || fs.device_name || '',
              percent,
              usedGB,
              sizeGB,
            });
          }
        }
      } catch (e) {
        // Игнорируем ошибки при получении дисков
      }
      
      glancesLatest = {
        t: now,
        cpu: point.cpu,
        cpuCores: [],
        gpu: point.gpu,
        gpuTemp: null,
        ram: point.ram,
        ramUsedGB: null,
        ramTotalGB: null,
        swap: null,
        load1: null,
        load5: null,
        cput: point.cput,
        ssdt: point.ssdt,
        disks,
        adapters: [],
        mainAdapter: null,
        rx: point.rx,
        tx: point.tx,
        sensors: [],
        uptimeSec: Math.floor((now - a.createdAt) / 1000),
        via: 'api',
        diskRead: point.diskRead,
        diskWrite: point.diskWrite,
        fanSpeed: null,
        battery: null,
        batteryTimeLeft: null,
        batteryIsCharging: null,
        wifiSSID: null,
        wifiQuality: null,
        wifiSignal: null,
        wifiBitrate: null,
        processes: [],
        containers: [],
        cloudProvider: null,
        hddTemp: null,
        cpuUser: null,
        cpuSystem: null,
        cpuIowait: null,
        cpuFreq: null,
        gpuMem: null,
        gpuMemPercent: null,
        ramAvailableGB: null,
      };
      
      // Проверка на уменьшение количества дисков
      const prevCount = agentPrevDiskCount.get(id);
      const currCount = disks.length;
      if (prevCount != null && currCount < prevCount) {
        store.pushEvent('crit', 'agent', `${a.name}: уменьшение количества дисков (${prevCount} → ${currCount})`);
      }
      agentPrevDiskCount.set(id, currCount);
      
      glances = [...glances, point].slice(-4000);
      glancesError = null;
    } else {
      glancesError = 'не удалось получить данные от Glances API';
    }
  } else if (!online) {
    // Если агент офлайн, сбрасываем счетчик
    agentPrevDiskCount.delete(id);
    glancesError = 'агент недоступен';
  }

  store.updateAgent(id, {
    online,
    latency: ms,
    onlineSince: online ? (a.onlineSince || now) : 0,
    lastSeen: online ? now : a.lastSeen,
    lastPoll: now,
    lastGlances: dueGl && online ? now : a.lastGlances,
    glancesLatest,
    glances,
    latHist: [...a.latHist, { t: now, ms }].slice(-480),
    glancesError,
  });
}

export function sendTestNotification(): void {
  useToasts.push('ok', 'Тестовое уведомление отправлено (эмуляция)');
}

export function requestPushPermission(): void {
  if (typeof Notification !== 'undefined') void Notification.requestPermission();
}
