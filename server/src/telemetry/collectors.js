// ─── PLUTO Telemetry: модуль сбора телеметрии ────────
// Поддерживает только Netdata как основной источник телеметрии

/**
 * Модуль телеметрии
 * Источник: Netdata API v2
 */

const telemetryLogger = {
  error: (msg, ctx) => console.error(`[pluto][telemetry][ERROR] ${msg}`, JSON.stringify(ctx)),
  warn: (msg, ctx) => console.warn(`[pluto][telemetry][WARN] ${msg}`, JSON.stringify(ctx)),
  info: (msg, ctx) => console.info(`[pluto][telemetry][INFO] ${msg}`, JSON.stringify(ctx)),
};

/**
 * Сбор метрик из Netdata API v2 (пункт 11)
 */
export async function collectNetdata(baseUrl, fetchTextFn) {
  const base = String(baseUrl).replace(/\/+$/, '');
  
  async function fetchContext(context, after = -60) {
    try {
      const txt = await fetchTextFn(
        `${base}/api/v2/data?context=${encodeURIComponent(context)}&format=json&after=${after}&before=0`, 
        7000
      );
      return JSON.parse(txt);
    } catch (e) {
      telemetryLogger.warn('Netdata context не доступен', { context, error: e.message });
      return null;
    }
  }

  const [cpuData, ramData, netData, swapData, ioData, pressureData, tempsData] = await Promise.all([
    fetchContext('system.cpu'),
    fetchContext('system.ram'),
    fetchContext('system.net'),
    fetchContext('system.swap'),
    fetchContext('system.io'),
    fetchContext('system.pressure'),
    fetchContext('sensors.temperatures'),
  ]);

  const getValue = (data, dimension) => {
    if (!data || !data.result || !data.result.data || data.result.data.length === 0) return null;
    const rows = data.result.data;
    const dims = data.result.dimensions || {};
    let dimIdx = -1;
    let idx = 0;
    for (const [key, val] of Object.entries(dims)) {
      if (key === dimension) { dimIdx = idx; break; }
      idx++;
    }
    if (dimIdx < 0) return null;
    const lastRow = rows[rows.length - 1];
    const val = lastRow[dimIdx + 1];
    return val != null && val !== 'null' ? Number(val) : null;
  };

  const cpuUser = getValue(cpuData, 'user');
  const cpuSystem = getValue(cpuData, 'system');
  const cpuIowait = getValue(cpuData, 'iowait');
  const cpuTotal = cpuUser != null || cpuSystem != null 
    ? (cpuUser || 0) + (cpuSystem || 0) + (cpuIowait || 0)
    : null;

  const ramUsed = getValue(ramData, 'used');
  const ramFree = getValue(ramData, 'free');
  const ramTotal = ramUsed != null && ramFree != null ? ramUsed + ramFree : null;
  const ramPercent = ramTotal != null && ramUsed != null 
    ? Math.round((ramUsed / ramTotal) * 1000) / 10 
    : null;

  const netRx = getValue(netData, 'received');
  const netTx = getValue(netData, 'sent');

  const swapUsed = getValue(swapData, 'used');
  const swapFree = getValue(swapData, 'free');
  const swapTotal = swapUsed != null && swapFree != null ? swapUsed + swapFree : null;
  const swapPercent = swapTotal != null && swapUsed != null 
    ? Math.round((swapUsed / swapTotal) * 1000) / 10 
    : null;

  const diskRead = getValue(ioData, 'reads');
  const diskWrite = getValue(ioData, 'writes');

  const cpuTemp = getValue(tempsData, 'cpu_thermal_zone') || getValue(tempsData, 'coretemp_package');

  telemetryLogger.info('Netdata метрики собраны', { 
    cpu: cpuTotal, 
    ram: ramPercent, 
    swap: swapPercent 
  });

  return {
    cpu: cpuTotal,
    cpuUser,
    cpuSystem,
    cpuIowait,
    ram: ramPercent,
    ramUsed,
    ramTotal,
    swap: swapPercent,
    swapUsed,
    swapTotal,
    netRx,
    netTx,
    diskRead,
    diskWrite,
    cpuTemp,
    source: 'netdata',
  };
}

export default {
  collectNetdata,
};
