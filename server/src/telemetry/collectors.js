// ─── PLUTO Telemetry: модуль сбора телеметрии ────────
// Поддерживает Netdata и Pluto Agent как источники телеметрии

/**
 * Модуль телеметрии
 * Источники: Netdata API v2, Pluto Agent API
 */

const telemetryLogger = {
  error: (msg, ctx) => console.error(`[pluto][telemetry][ERROR] ${msg}`, JSON.stringify(ctx)),
  warn: (msg, ctx) => console.warn(`[pluto][telemetry][WARN] ${msg}`, JSON.stringify(ctx)),
  info: (msg, ctx) => console.info(`[pluto][telemetry][INFO] ${msg}`, JSON.stringify(ctx)),
};

/**
 * Сбор метрик из Netdata API v2 (пункт 11)
 * Поддерживаемые метрики:
 * - CPU: user, system, iowait, softirq, guest
 * - RAM: used, cached, buffers, free
 * - Swap: %, использовано/всего
 * - Сеть: received/sent (КБ/с)
 * - Disk I/O: reads/writes (операции/с)
 * - Температуры: CPU, SSD, GPU
 * - Диски: количество, объем, загрузка
 * - GPU: загрузка видеокарты (если доступна)
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

  // Запрос всех доступных контекстов включая расширенные
  const [cpuData, ramData, netData, swapData, ioData, pressureData, tempsData, disksData, gpuData] = await Promise.all([
    fetchContext('system.cpu'),
    fetchContext('system.ram'),
    fetchContext('system.net'),
    fetchContext('system.swap'),
    fetchContext('system.io'),
    fetchContext('system.pressure'),
    fetchContext('sensors.temperatures'),
    fetchContext('disks.space'),
    fetchContext('nvidia_gpu.gpu_utilization').catch(() => null), // GPU может отсутствовать
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

  const getDimensions = (data) => {
    if (!data || !data.result || !data.result.dimensions) return {};
    return data.result.dimensions;
  };

  // CPU метрики
  const cpuUser = getValue(cpuData, 'user');
  const cpuSystem = getValue(cpuData, 'system');
  const cpuIowait = getValue(cpuData, 'iowait');
  const cpuSoftirq = getValue(cpuData, 'softirq');
  const cpuGuest = getValue(cpuData, 'guest');
  const cpuTotal = cpuUser != null || cpuSystem != null 
    ? (cpuUser || 0) + (cpuSystem || 0) + (cpuIowait || 0) + (cpuSoftirq || 0) + (cpuGuest || 0)
    : null;

  // RAM метрики
  const ramUsed = getValue(ramData, 'used');
  const ramFree = getValue(ramData, 'free');
  const ramCached = getValue(ramData, 'cached');
  const ramBuffers = getValue(ramData, 'buffers');
  const ramTotal = ramUsed != null && ramFree != null ? ramUsed + ramFree : null;
  const ramPercent = ramTotal != null && ramUsed != null 
    ? Math.round((ramUsed / ramTotal) * 1000) / 10 
    : null;

  // Сеть
  const netRx = getValue(netData, 'received');
  const netTx = getValue(netData, 'sent');

  // Swap
  const swapUsed = getValue(swapData, 'used');
  const swapFree = getValue(swapData, 'free');
  const swapTotal = swapUsed != null && swapFree != null ? swapUsed + swapFree : null;
  const swapPercent = swapTotal != null && swapUsed != null 
    ? Math.round((swapUsed / swapTotal) * 1000) / 10 
    : null;

  // Disk I/O
  const diskRead = getValue(ioData, 'reads');
  const diskWrite = getValue(ioData, 'writes');

  // Disk Space - подсчет количества дисков и общего объема
  const diskDims = getDimensions(disksData);
  const diskCount = Object.keys(diskDims).length;
  let diskTotalSpace = null;
  let diskUsedSpace = null;
  
  if (disksData) {
    // Суммируем пространство всех дисков
    let total = 0;
    let used = 0;
    let hasData = false;
    for (const dim of Object.keys(diskDims)) {
      const spaceVal = getValue(disksData, dim);
      if (spaceVal != null) {
        hasData = true;
        if (dim.includes('_avail') || dim.includes('_free')) {
          total += spaceVal;
        } else if (dim.includes('_used')) {
          used += spaceVal;
        }
      }
    }
    if (hasData) {
      diskTotalSpace = total + used;
      diskUsedSpace = used;
    }
  }

  // Температуры - расширенный сбор
  const tempDims = getDimensions(tempsData);
  let cpuTemp = null;
  let ssdTemp = null;
  let gpuTemp = null;
  
  if (tempsData) {
    // Приоритеты для CPU температуры
    cpuTemp = getValue(tempsData, 'cpu_thermal_zone') 
           || getValue(tempsData, 'coretemp_package')
           || getValue(tempsData, 'k10temp_tctl')
           || getValue(tempsData, 'zenpower_tdie');
    
    // Поиск температур SSD
    for (const [key, val] of Object.entries(tempDims)) {
      if (key.toLowerCase().includes('ssd') || key.toLowerCase().includes('nvme') || key.toLowerCase().includes('hdd')) {
        ssdTemp = getValue(tempsData, key);
        break;
      }
    }
    
    // Поиск температур GPU
    for (const [key, val] of Object.entries(tempDims)) {
      if (key.toLowerCase().includes('gpu') || key.toLowerCase().includes('nouveau') || key.toLowerCase().includes('amdgpu')) {
        gpuTemp = getValue(tempsData, key);
        break;
      }
    }
  }

  // GPU метрики (NVIDIA через Netdata плагин)
  let gpuUtil = null;
  let gpuMemUsed = null;
  let gpuMemTotal = null;
  
  if (gpuData) {
    gpuUtil = getValue(gpuData, 'gpu_util') || getValue(gpuData, 'utilization');
    const memDims = getDimensions(gpuData);
    for (const [key, val] of Object.entries(memDims)) {
      if (key.includes('mem_used')) gpuMemUsed = getValue(gpuData, key);
      if (key.includes('mem_total')) gpuMemTotal = getValue(gpuData, key);
    }
  }

  telemetryLogger.info('Netdata метрики собраны', { 
    cpu: cpuTotal, 
    ram: ramPercent, 
    swap: swapPercent,
    disks: diskCount,
    gpu: gpuUtil
  });

  return {
    cpu: cpuTotal,
    cpuUser,
    cpuSystem,
    cpuIowait,
    cpuSoftirq,
    cpuGuest,
    ram: ramPercent,
    ramUsed,
    ramTotal,
    ramCached,
    ramBuffers,
    swap: swapPercent,
    swapUsed,
    swapTotal,
    netRx,
    netTx,
    diskRead,
    diskWrite,
    diskCount,
    diskTotalSpace,
    diskUsedSpace,
    cpuTemp,
    ssdTemp,
    gpuTemp,
    gpuUtil,
    gpuMemUsed,
    gpuMemTotal,
    source: 'netdata',
  };
}

/**
 * Сбор метрик от Pluto Agent (для Windows/Linux без Netdata)
 * Агент отправляет данные в формате JSON через POST запрос
 */
export async function collectFromAgent(agentUrl, fetchJsonFn) {
  try {
    const data = await fetchJsonFn(`${agentUrl}/api/metrics`, 7000);
    
    telemetryLogger.info('Метрики от Pluto Agent получены', {
      cpu: data.cpu?.usage,
      ram: data.memory?.usage_percent,
      disks: data.disks?.length
    });
    
    // Нормализация данных от агента к формату PLUTO
    return {
      cpu: data.cpu?.usage ?? null,
      cpuUser: data.cpu?.user ?? null,
      cpuSystem: data.cpu?.system ?? null,
      cpuIowait: data.cpu?.iowait ?? null,
      ram: data.memory?.usage_percent ?? null,
      ramUsed: data.memory?.used ?? null,
      ramTotal: data.memory?.total ?? null,
      swap: data.swap?.usage_percent ?? null,
      swapUsed: data.swap?.used ?? null,
      swapTotal: data.swap?.total ?? null,
      netRx: data.network?.bytes_recv_per_sec ?? null,
      netTx: data.network?.bytes_sent_per_sec ?? null,
      diskRead: data.disk?.read_per_sec ?? null,
      diskWrite: data.disk?.write_per_sec ?? null,
      diskCount: data.disks?.length ?? null,
      diskTotalSpace: data.disks?.reduce((sum, d) => sum + (d.total ?? 0), 0) ?? null,
      diskUsedSpace: data.disks?.reduce((sum, d) => sum + (d.used ?? 0), 0) ?? null,
      cpuTemp: data.temperatures?.cpu ?? null,
      ssdTemp: data.temperatures?.ssd ?? null,
      gpuTemp: data.temperatures?.gpu ?? null,
      gpuUtil: data.gpu?.usage_percent ?? null,
      gpuMemUsed: data.gpu?.memory_used ?? null,
      gpuMemTotal: data.gpu?.memory_total ?? null,
      source: 'pluto_agent',
    };
  } catch (e) {
    telemetryLogger.error('Ошибка получения метрик от Pluto Agent', { error: e.message });
    throw e;
  }
}

export default {
  collectNetdata,
  collectFromAgent,
};
