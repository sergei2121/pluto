// ─── Авто-отчет SLA: CSV по устройствам за последние 30 дней ───────────────
import fs from 'node:fs';
import path from 'node:path';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Считает SLA-метрики устройства по кольцевому буферу history
 * (значения задержки в мс; -1 — неудачная проверка).
 */
export function computeDeviceSla(d, now = Date.now()) {
  const history = d.history || [];
  const totalChecks = history.length;
  const failedChecks = history.filter((h) => h === -1).length;
  const uptimePct = totalChecks > 0 ? ((totalChecks - failedChecks) / totalChecks) * 100 : 100;
  const downCount = history.filter((h, i) => h === -1 && (i === 0 || history[i - 1] !== -1)).length;
  const validLatencies = history.filter((h) => h !== -1 && h != null);
  const avgLatency = validLatencies.length > 0 ? validLatencies.reduce((a, b) => a + b, 0) / validLatencies.length : null;
  return {
    id: d.id,
    name: d.name,
    type: d.type,
    uptimePct: Math.round(uptimePct * 100) / 100,
    downCount,
    avgLatency: avgLatency !== null ? Math.round(avgLatency * 100) / 100 : null,
    periodStart: now - THIRTY_DAYS_MS,
    periodEnd: now,
  };
}

/** Формирует содержимое CSV-отчёта по списку устройств. */
export function buildSlaCsv(devices, now = Date.now()) {
  const rows = devices.map((d) => {
    const s = computeDeviceSla(d, now);
    return `${s.id},"${String(s.name).replace(/"/g, '""')}",${s.type},${s.uptimePct},${s.downCount},${s.avgLatency !== null ? s.avgLatency : ''},${new Date(s.periodStart).toISOString()},${new Date(s.periodEnd).toISOString()}`;
  });
  return ['ID,Name,Type,Uptime %,Down Count,Avg Latency,Period Start,Period End', ...rows].join('\n');
}

/**
 * Генерирует и сохраняет SLA-отчёт в outputPath.
 * @returns {Promise<string>} путь к сохранённому файлу.
 */
export async function generateAndSaveSlaReport(db, outputPath) {
  fs.mkdirSync(outputPath, { recursive: true });
  const now = new Date();
  const filePath = path.join(outputPath, `SLA-${now.toISOString().split('T')[0]}.csv`);
  fs.writeFileSync(filePath, buildSlaCsv(db.devices), 'utf8');
  return filePath;
}

/** Проверяет расписание cfg ({ enabled, schedule, hour, dayOfWeek, dayOfMonth }) на текущий момент. */
export function shouldRunSlaReport(cfg, now = new Date(), lastRunAt = 0) {
  if (!cfg || !cfg.enabled || !cfg.outputPath) return false;
  if (now.getHours() !== cfg.hour || now.getMinutes() !== 0) return false;
  let due = false;
  if (cfg.schedule === 'daily') due = true;
  else if (cfg.schedule === 'weekly') due = now.getDay() === (cfg.dayOfWeek ?? 0);
  else if (cfg.schedule === 'monthly') due = now.getDate() === (cfg.dayOfMonth ?? 1);
  if (!due) return false;
  // не запускать дважды в течение одного часа
  return Date.now() - lastRunAt >= 3600000;
}
