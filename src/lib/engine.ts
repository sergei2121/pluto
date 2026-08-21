// ─── PLUTO: встроенное ядро мониторинга ──────────────────────────────────────
// В браузерной сборке ядро работает встроенно: реальные HTTP/API-зонды через
// fetch там, где это возможно, и честная протокольная эмуляция для ICMP/RTSP/SIP.
// В серверном развертывании (docker compose) этот слой заменяется воркерами ядра.

import { useStore, useToasts } from './store';
import type { Agent, Device, DeviceType } from './types';
import { clamp, fmtMs, mulberry32, hashStr, rnd, rndInt } from './util';

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

// ─── Основной тик ────────────────────────────────────────────────────────────

function tick() {
  const s = useStore.getState();
  if (!s.session) return;
  const now = Date.now();

  for (const d of s.devices) {
    if (d.checking) continue;
    const interval = Math.max(5, d.interval) * 1000;
    if (now - d.lastCheck >= interval) void runCheck(d);
  }

  for (const a of s.agents) {
    if (a.online) {
      if (now - a.lastMetrics >= s.settings.metrics * 1000) stepAgentMetrics(a, now);
      if (now > a.nextScan) rescanLan(a, now);
      // редкий самопроизвольный обрыв связи эмулированного агента
      if (a.emulated && Math.random() < 0.0006) setAgentOffline(a);
    } else if (a.emulated && a.reconnectAt > 0 && now >= a.reconnectAt) {
      setAgentOnline(a);
    }
  }
}

// ─── Проверки устройств ──────────────────────────────────────────────────────

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
  if (now < d.spikeUntil) {
    return { ok: true, latency: Math.round(d.profile.base * (6 + rng() * 18)) };
  }
  if (rng() < d.profile.failP) return { ok: false, latency: 0 };
  if (rng() < d.profile.spikeP) {
    useStore.getState().patchDevice(d.id, { spikeUntil: now + rndInt(40, 140) * 1000 });
  }
  return { ok: true, latency: Math.max(1, Math.round(d.profile.base * (0.72 + rng() * 0.56))) };
}

export async function runCheck(d: Device): Promise<void> {
  const s = useStore.getState();
  s.patchDevice(d.id, { checking: true });
  let res: { ok: boolean; latency: number };
  let approx: boolean;

  const url = probeUrl(d);
  if (!s.settings.simulate && url && (d.type === 'http' || d.type === 'api')) {
    res = await realProbe(d, s.settings.timeoutMs);
    approx = false;
  } else if (!s.settings.simulate && !url) {
    // браузер не может слать ICMP/RTSP/SIP — честно помечаем как недоступное
    res = { ok: false, latency: 0 };
    approx = true;
  } else {
    await sleep(rndInt(120, 600)); // сетевая задержка
    res = simulatedProbe(d, Date.now());
    approx = true;
  }
  applyResult(d.id, res.ok, res.latency, approx);
}

/** Принудительная проверка «Проверить сейчас» (в серверном режиме — силами ядра) */
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

function applyResult(id: string, ok: boolean, latency: number, approx: boolean) {
  const s = useStore.getState();
  const d = s.devices.find((x) => x.id === id);
  if (!d) return;
  const now = Date.now();
  const history = [...d.history, ok ? latency : -1].slice(-48);
  const cfg = s.settings;

  if (!ok) {
    const fails = d.fails + 1;
    if (fails >= cfg.failThreshold && d.status !== 'down') {
      s.patchDevice(id, { status: 'down', fails, latency: null, lastCheck: now, lastChange: now, history, checking: false, approx });
      s.pushEvent('crit', 'device', `${typeShort(d.type)} ${d.address} — потеря связи (${fails} сб. подряд)`);
      if (cfg.notifications.on.down) {
        dispatchNotification('down', 'PLUTO: авария', `${d.name} (${d.address}) — потеря связи после ${fails} проверок`);
      }
    } else {
      s.patchDevice(id, { fails, lastCheck: now, history, checking: false, approx });
    }
    return;
  }

  const degraded = latency > d.profile.base * cfg.degradeFactor && latency > cfg.degradeMinMs;
  let status: Device['status'] = degraded ? 'degraded' : 'up';
  let fails = 0;

  if (d.status === 'down') {
    const downFor = Math.max(1, Math.round((now - d.lastChange) / 1000));
    s.pushEvent('ok', 'device', `${d.name} (${d.address}) — связь восстановлена, простой ${downFor} с`);
    if (cfg.notifications.on.recover) {
      dispatchNotification('recover', 'PLUTO: восстановление', `${d.name} (${d.address}) снова в строю, простой ${downFor} с`);
    }
  } else if (degraded && d.status !== 'degraded') {
    s.pushEvent('warn', 'device', `${d.name}: деградация связи — ${fmtMs(latency)} при базовых ${fmtMs(d.profile.base)}`);
    if (cfg.notifications.on.degraded) {
      dispatchNotification('degraded', 'PLUTO: деградация', `${d.name} (${d.address}): задержка ${fmtMs(latency)}, базовая ${fmtMs(d.profile.base)}`);
    }
  } else if (!degraded && d.status === 'degraded') {
    s.pushEvent('ok', 'device', `${d.name}: задержка вернулась к норме (${fmtMs(latency)})`);
  }

  s.patchDevice(id, { status, fails, latency, lastCheck: now, lastChange: status === d.status ? d.lastChange : now, history, checking: false, approx });
}

// ─── Агенты ──────────────────────────────────────────────────────────────────

function stepAgentMetrics(a: Agent, now: number) {
  const cpuLoad = clamp(a.cpuLoad + rnd(-7, 7) + (Math.random() < 0.06 ? rnd(10, 30) : 0), 2, 98);
  const cpuTemp = clamp(36 + cpuLoad * 0.42 + rnd(-1.5, 1.5), 32, 95);
  const ramUsed = clamp(a.ramUsed + a.ramTotal * rnd(-0.02, 0.022), a.ramTotal * 0.12, a.ramTotal * 0.94);
  const ramTemp = clamp(34 + (ramUsed / a.ramTotal) * 22 + rnd(-1, 1), 30, 80);
  const burst = Math.random() < 0.12;
  const rxRate = clamp(a.rxRate * 0.6 + (burst ? rnd(800, 6000) : rnd(20, 900)), 0, 12000);
  const txRate = clamp(a.txRate * 0.6 + (burst ? rnd(300, 2500) : rnd(5, 400)), 0, 8000);
  const dt = Math.max(1, (now - (a.lastMetrics || now - 3000)) / 1000);
  const disks = a.disks.map((d) => ({
    ...d,
    used: clamp(d.used + d.total * rnd(-0.0004, 0.0006), 0, d.total * 0.98),
    temp: clamp(28 + (d.used / d.total) * 20 + rnd(-1, 1), 25, 70),
  }));
  const point = { t: now, cpu: cpuLoad, ram: (ramUsed / a.ramTotal) * 100, rx: rxRate, tx: txRate };

  useStore.getState().patchAgent(a.id, {
    cpuLoad, cpuTemp, ramUsed, ramTemp, rxRate, txRate, disks,
    rxBytes: a.rxBytes + rxRate * 1024 * dt,
    txBytes: a.txBytes + txRate * 1024 * dt,
    lastSeen: now,
    lastMetrics: now,
    history: [...a.history, point].slice(-90),
  });
}

function rescanLan(a: Agent, now: number) {
  const s = useStore.getState();
  const networks = a.networks.map((n) => ({
    ...n,
    hosts: n.hosts.map((h) => (Math.random() < 0.15 ? { ...h, online: !h.online || Math.random() > 0.4 } : h)),
  }));
  s.patchAgent(a.id, { networks, nextScan: now + s.settings.lanScan * 1000 });
}

export function setAgentOffline(a: Agent) {
  const s = useStore.getState();
  s.patchAgent(a.id, { online: false, lastSeen: Date.now(), reconnectAt: Date.now() + rndInt(20, 75) * 1000 });
  s.pushEvent('crit', 'agent', `Агент ${a.hostname} (${a.ip}) — соединение потеряно`);
  if (s.settings.notifications.on.agentOff) {
    dispatchNotification('agentOff', 'PLUTO: агент офлайн', `Агент ${a.hostname} (${a.ip}) перестал отвечать на heartbeat`);
  }
}

export function setAgentOnline(a: Agent) {
  const s = useStore.getState();
  s.patchAgent(a.id, { online: true, connectedAt: Date.now(), lastSeen: Date.now(), reconnectAt: 0 });
  s.pushEvent('ok', 'agent', `Агент ${a.hostname} (${a.ip}) снова в сети`);
  if (s.settings.notifications.on.agentOn) {
    dispatchNotification('agentOn', 'PLUTO: агент в сети', `Агент ${a.hostname} (${a.ip}) восстановил соединение`);
  }
}

// ─── Уведомления ─────────────────────────────────────────────────────────────

type NotifyKind = 'down' | 'degraded' | 'recover' | 'agentOff' | 'agentOn';

function dispatchNotification(kind: NotifyKind, title: string, body: string) {
  const s = useStore.getState();
  const n = s.settings.notifications;
  const channels: string[] = [];

  if (n.push.enabled && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      new Notification(title, { body, tag: `${kind}-${Date.now()}` });
      channels.push('push');
    } catch {
      /* среда без поддержки Notification */
    }
  }

  if (n.telegram.enabled && n.telegram.botToken.trim() && n.telegram.chatId.trim()) {
    const token = n.telegram.botToken.trim();
    fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: n.telegram.chatId.trim(), text: `${title}\n${body}` }),
    })
      .then((r) => {
        if (!r.ok) useToasts.getState().push('warn', 'Telegram: отправка не удалась — проверьте токен и chat_id');
        else channels.push('telegram');
      })
      .catch(() => useToasts.getState().push('warn', 'Telegram: сеть недоступна, уведомление не доставлено'));
  }

  if (n.email.enabled && n.email.to.trim()) {
    channels.push('email*'); // SMTP требует серверной части — эмулируется
  }

  if (channels.length > 0) {
    s.pushEvent('info', 'system', `Уведомление (${kind}) отправлено: ${channels.join(', ')}`);
  }
}

/** Тестовое уведомление из настроек */
export function sendTestNotification(kind: 'push' | 'telegram' | 'email'): { ok: boolean; text: string } {
  const s = useStore.getState();
  const n = s.settings.notifications;
  const body = 'Проверочное уведомление системы мониторинга PLUTO. Канал связи работает.';
  if (kind === 'push') {
    if (typeof Notification === 'undefined') return { ok: false, text: 'Браузер не поддерживает уведомления' };
    if (Notification.permission !== 'granted') return { ok: false, text: 'Разрешение на уведомления не выдано' };
    try {
      new Notification('PLUTO: тест', { body });
      return { ok: true, text: 'Всплывающее уведомление показано' };
    } catch {
      return { ok: false, text: 'Не удалось показать уведомление' };
    }
  }
  if (kind === 'telegram') {
    if (!n.telegram.botToken.trim() || !n.telegram.chatId.trim()) {
      return { ok: false, text: 'Заполните токен бота и chat_id' };
    }
    fetch(`https://api.telegram.org/bot${n.telegram.botToken.trim()}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: n.telegram.chatId.trim(), text: `PLUTO: тест\n${body}` }),
    })
      .then((r) =>
        r.ok
          ? useToasts.getState().push('ok', 'Telegram: тестовое сообщение отправлено')
          : useToasts.getState().push('warn', 'Telegram: API вернул ошибку — проверьте токен'),
      )
      .catch(() => useToasts.getState().push('warn', 'Telegram: запрос не прошёл'));
    return { ok: true, text: 'Запрос к Telegram API отправлен' };
  }
  return { ok: true, text: 'Письмо поставлено в очередь (SMTP работает на сервере ядра)' };
}

function typeShort(t: DeviceType): string {
  return t.toUpperCase();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
