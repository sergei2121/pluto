// ─── Сборщики телеметрии: Netdata API и Pluto Agent ────────────────────────
import telemetryCollectors from '../telemetry/collectors.js';

/** Собирает метрики из Netdata API v2. */
export function collectNetdata(url, fetchText) {
  return telemetryCollectors.collectNetdata(url, fetchText);
}

/** Собирает метрики от Pluto Agent (/api/metrics). */
export function collectFromAgent(url, fetchJson) {
  return telemetryCollectors.collectFromAgent(url, fetchJson);
}

/**
 * Собирает телеметрию из доступного источника агента.
 * Приоритет: Netdata, затем Pluto Agent.
 * @returns {Promise<object>} метрика + поле via ('netdata' | 'pluto_agent').
 */
export async function collectTelemetry(agent, { fetchText, fetchJson }) {
  if (agent.netdataUrl) {
    const g = await collectNetdata(agent.netdataUrl, fetchText);
    return { ...g, via: 'netdata' };
  }
  if (agent.agentUrl) {
    const g = await collectFromAgent(agent.agentUrl, fetchJson);
    return { ...g, via: 'pluto_agent' };
  }
  throw new Error('Нет доступного источника телеметрии (укажите Netdata URL или Pluto Agent URL)');
}

/** Точка истории телеметрии (сокращённый формат, единый для Netdata и Pluto Agent). */
export function telemetryPoint(g, t) {
  return {
    t,
    cpu: g.cpu ?? null,
    gpu: g.gpu ?? g.gpuUtil ?? null,
    ram: g.ram ?? null,
    rx: g.netRx ?? g.rx ?? null,
    tx: g.netTx ?? g.tx ?? null,
    cput: g.cput ?? g.cpuTemp ?? null,
    ssdt: g.ssdt ?? g.ssdTemp ?? null,
    swap: g.swap ?? null,
    diskRead: g.diskRead ?? null,
    diskWrite: g.diskWrite ?? null,
    diskUsed: g.mainFsUsed ?? null,
  };
}

/** Разбирает строку аптайма «H:M:S» в секунды (или null). */
export function parseUptime(s) {
  const m = /(\d+):(\d+):(\d+)/.exec(String(s));
  if (!m) return null;
  return parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseInt(m[3]);
}
