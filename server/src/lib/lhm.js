// ─── PLUTO Hardware: сверка WMI-данных агента с LibreHardwareMonitor ────────
// Источники:
//  1) Pluto Agent (/api/hardware) — прямой снимок LHM, если агент собран с LHM;
//  2) AIDA64-сенсорная страница (settings: agent.aida64Url, по умолчанию http://127.0.0.1:8090/);
//  3) WMI-данные из телеметрии агента (netdataLatest: cpuTemp, disks[].temp и т.п.).
// Результат: agent.hardware = { ts, source, sensors, wmi, checks[] } + алерты при расхождениях.

import { pushEvent } from '../lib.js';

const lhmLogger = {
  warn: (msg, ctx) => console.warn(`[pluto][hardware][WARN] ${msg}`, JSON.stringify(ctx || {})),
  info: (msg, ctx) => console.info(`[pluto][hardware][INFO] ${msg}`, JSON.stringify(ctx || {})),
};

/** Хелпер: GET текста по URL (инжектируется ядром, чтобы не дублировать fetchText). */
async function getJson(url, fetchTextFn, timeoutMs = 7000) {
  const txt = await fetchTextFn(url, timeoutMs);
  return JSON.parse(txt);
}

/** Разбор сенсорной HTML-страницы AIDA64/LHM в плоский набор датчиков { имя: число }. */
export function parseSensorPage(html) {
  const sensors = {};
  const re = /<td[^>]*>([^<]{2,60})<\/td>\s*<td[^>]*>([-\d.,]+)\s*(°C|%|MB\/s|GB|rpm|RPM)?<\/td>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const name = m[1].trim();
    const val = parseFloat(String(m[2]).replace(',', '.'));
    if (!isFinite(val) || !name) continue;
    if (!sensors[name]) sensors[name] = { value: val, unit: (m[3] || '').trim() };
  }
  return sensors;
}

/** Извлечение WMI-показателей из последнего снимка телеметрии агента. */
export function wmiFromTelemetry(latest) {
  if (!latest) return null;
  const out = { cpuTemp: latest.cpuTemp ?? latest.cput ?? null, disks: [], gpuTemp: latest.gpuTemp ?? null };
  for (const d of latest.disks || []) {
    out.disks.push({ label: d.label || d.name || '', temp: d.temp ?? null, smartStatus: d.smartStatus || null });
  }
  return out;
}

function tempClose(a, b, tol = 10) {
  if (a == null || b == null) return null; // нет данных для сравнения
  return Math.abs(a - b) <= tol;
}

/**
 * Основная проверка: запрашивает LHM у агента, сравнивает с WMI-телеметрией,
 * пишет результат в agent.hardware (и в hardwareHistory — последние 200 снимков).
 */
export async function checkAgentHardware(agent, fetchTextFn) {
  const base = String(agent.agentUrl || '').replace(/\/+$/, '');
  if (!base && !agent.aida64Url) return null;

  let hw = null;
  let source = '';

  // 1) Прямой эндпоинт агента /api/hardware (Pluto Agent c LHM)
  if (base) {
    try {
      hw = await getJson(base + '/api/hardware', fetchTextFn, 8000);
      source = 'librehardwaremonitor';
    } catch (e) {
      lhmLogger.warn('агент не отдал /api/hardware', { agent: agent.name, error: e.message });
    }
  }

  // 2) Fallback: сенсорная страница AIDA64/LHM HTTP-сервера
  if (!hw && agent.aida64Url) {
    try {
      const html = await fetchTextFn(String(agent.aida64Url).replace(/\/+$/, '') + '/', 8000);
      const parsed = parseSensorPage(html);
      if (Object.keys(parsed).length) { hw = { sensors: parsed }; source = 'aida64-sensor-page'; }
    } catch (e) {
      lhmLogger.warn('сенсорная страница недоступна', { agent: agent.name, error: e.message });
    }
  }

  const wmi = wmiFromTelemetry(agent.netdataLatest || agent.glancesLatest);
  if (!hw && !wmi) return null;

  // 3) Сверка WMI <-> LHM
  const checks = [];
  const lhmCpuTemp = hw ? (hw.cpuTemp ?? (hw.sensors && pickTemp(hw.sensors, /cpu/i))) : null;
  const ok1 = tempClose(wmi && wmi.cpuTemp, lhmCpuTemp);
  checks.push({ metric: 'cpuTemp', wmi: wmi ? wmi.cpuTemp : null, lhm: lhmCpuTemp, match: ok1 });

  for (const wd of (wmi && wmi.disks) || []) {
    const ld = hw && hw.disks && hw.disks.find((x) => normLbl(x.label) === normLbl(wd.label));
    const okD = ld ? tempClose(wd.temp, ld.temp) : null;
    checks.push({ metric: `disk:${wd.label}:temp`, wmi: wd.temp, lhm: ld ? ld.temp : null, match: okD });
    if (ld && ld.smartStatus && wd.smartStatus && ld.smartStatus !== wd.smartStatus) {
      checks.push({ metric: `disk:${wd.label}:smart`, wmi: wd.smartStatus, lhm: ld.smartStatus, match: false });
    }
  }

  const mismatched = checks.filter((c) => c.match === false);
  const snapshot = {
    ts: Date.now(), source: source || 'wmi-only',
    sensors: hw && hw.sensors ? hw.sensors : undefined,
    temps: hw ? { cpu: lhmCpuTemp, disks: hw.disks || [] } : undefined,
    wmi, checks, status: mismatched.length ? 'mismatch' : (source ? 'ok' : 'no-lhm'),
  };

  agent.hardware = snapshot;
  agent.hardwareHistory = [...(agent.hardwareHistory || []), snapshot].slice(-200);

  if (mismatched.length) {
    await pushEvent('warning', 'hardware',
      `WMI ≠ LibreHardwareMonitor на «${agent.name}»: ${mismatched.map((c) => c.metric).join(', ')}`);
  } else if (source) {
    lhmLogger.info('аппаратная сверка пройдена', { agent: agent.name, source });
  }
  return snapshot;
}

function normLbl(s) {
  return String(s || '').toUpperCase().replace(/[\\/: ]/g, '');
}

function pickTemp(sensors, re) {
  for (const [k, v] of Object.entries(sensors || {})) {
    const unit = typeof v === 'object' ? String(v.unit || '') : '';
    if (re.test(k) && (/temp|temperature/i.test(k) || /°c/i.test(unit))) {
      return typeof v === 'object' ? v.value : v;
    }
  }
  return null;
}

export default { checkAgentHardware, parseSensorPage, wmiFromTelemetry };
