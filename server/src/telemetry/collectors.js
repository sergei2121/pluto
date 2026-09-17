// ─── PLUTO Telemetry: модуль сбора телеметрии из различных источников ────────

/**
 * Модуль телеметрии (пункт 11 - поддержка других источников телеметрии)
 * Поддерживает Glances, Netdata, Prometheus, Telegraf
 */

const telemetryLogger = {
  error: (msg, ctx) => console.error(`[pluto][telemetry][ERROR] ${msg}`, JSON.stringify(ctx)),
  warn: (msg, ctx) => console.warn(`[pluto][telemetry][WARN] ${msg}`, JSON.stringify(ctx)),
  info: (msg, ctx) => console.info(`[pluto][telemetry][INFO] ${msg}`, JSON.stringify(ctx)),
};

/**
 * Сбор метрик из Glances API
 */
export function parseGlancesData(data) {
  const cpu = data.cpu || {};
  const mem = data.mem || {};
  const gpuList = data.gpu || [];
  const gpu = gpuList.length ? gpuList[0] : null;
  const sensors = (data.sensors || []).filter((s) => s && s.value != null);
  const battery = data.battery || {};
  const wifi = data.wifi || {};
  const containersArr = data.containers || [];
  const cloud = data.cloud || {};

  const toGB = (b) => (b != null ? Math.round((b / 1024 ** 3) * 10) / 10 : null);

  const mainAdapterSel = (data.network || [])
    .filter((n) => n && !/lo|veth|docker|br-|virbr|vmnet|virtual/i.test(n.interface_name || n.key || ''))
    .sort((a, b) => ((b.rx || 0) + (b.tx || 0)) - ((a.rx || 0) + (a.tx || 0)))[0] 
    || (data.network || [])[0] 
    || null;

  const temp = (re) => {
    const s = sensors.find((x) => re.test(x.label || ''));
    return s ? Math.round(s.value * 10) / 10 : null;
  };

  const fanSensor = sensors.find((s) => /fan/i.test(s.label || ''));
  const hddTempSensor = sensors.find((s) => /hdd|disk/i.test(s.label || '') && !/ssd|nvme/i.test(s.label || ''));

  const fsArr = Array.isArray(data.fs) ? data.fs : [];
  const mainFs = fsArr.find((f) => f.mnt_point === '/' || /^[A-Za-z]:\\?$/.test(f.mnt_point || '')) || fsArr[0] || null;

  // DISK I/O
  let diskRead = 0;
  let diskWrite = 0;
  if (Array.isArray(data.diskio) && data.diskio.length > 0) {
    for (const d of data.diskio) {
      const r = d.read_count ?? d.Rps ?? d['R/s'] ?? 0;
      const w = d.write_count ?? d.Wps ?? d['W/s'] ?? 0;
      diskRead += r;
      diskWrite += w;
    }
  }

  // Топ процессов по CPU
  const procList = (data.processlist || []).slice(0, 10).map((p) => ({
    pid: p.pid,
    name: p.name || p.cmdline || 'unknown',
    cpu: p.cpu_percent != null ? Math.round(p.cpu_percent * 10) / 10 : null,
    mem: p.memory_percent != null ? Math.round(p.memory_percent * 10) / 10 : null,
    status: p.status || '?',
    username: p.username || undefined,
  }));

  // Контейнеры
  const contList = (containersArr || []).map((c) => ({
    name: c.name || 'unknown',
    status: c.status || 'unknown',
    cpu: c.cpu_percent != null ? Math.round(c.cpu_percent * 10) / 10 : null,
    mem: c.memory_usage != null ? Math.round((c.memory_usage / 1024 / 1024) * 10) / 10 : null,
  }));

  return {
    cpu: cpu.total != null ? Math.round(cpu.total * 10) / 10 : null,
    cpuCores: (data.percpu || []).map((c) => Math.round((c.total || 0) * 10) / 10),
    cpuUser: cpu.user != null ? Math.round(cpu.user * 10) / 10 : null,
    cpuSystem: cpu.system != null ? Math.round(cpu.system * 10) / 10 : null,
    cpuIowait: cpu.iowait != null ? Math.round(cpu.iowait * 10) / 10 : null,
    cpuFreq: cpu.freq_current != null ? Math.round(cpu.freq_current) : null,
    gpu: gpu && gpu.gpu != null ? Math.round(gpu.gpu * 10) / 10 : null,
    gpuTemp: temp(/gpu/i),
    gpuMem: gpu && gpu.mem != null ? Math.round((gpu.mem / 1024 / 1024) * 10) / 10 : null,
    gpuMemPercent: gpu && gpu.mem_percent != null ? Math.round(gpu.mem_percent * 10) / 10 : null,
    ram: mem.percent != null ? Math.round(mem.percent * 10) / 10 : null,
    ramUsedGB: toGB(mem.used), 
    ramTotalGB: toGB(mem.total), 
    ramAvailableGB: toGB(mem.available),
    swap: data.memswap && data.memswap.percent != null ? Math.round(data.memswap.percent * 10) / 10 : null,
    swapUsedGB: data.memswap ? toGB(data.memswap.used) : null,
    swapTotalGB: data.memswap ? toGB(data.memswap.total) : null,
    load1: data.load && data.load.min1 != null ? data.load.min1 : null,
    load5: data.load && data.load.min5 != null ? data.load.min5 : null,
    load15: data.load && data.load.min15 != null ? data.load.min15 : null,
    cput: temp(/package|cpu/i),
    ssdt: temp(/ssd|nvme/i),
    hddTemp: hddTempSensor ? Math.round(hddTempSensor.value * 10) / 10 : null,
    disks: fsArr.map((f) => ({ 
      mnt: f.mnt_point, 
      percent: f.percent != null ? Math.round(f.percent * 10) / 10 : null, 
      usedGB: toGB(f.used), 
      sizeGB: toGB(f.size) 
    })),
    adapters: (data.network || []).map((n) => ({ 
      name: n.interface_name || n.key, 
      rx: n.rx != null ? Math.round((n.rx / 1024) * 10) / 10 : null, 
      tx: n.tx != null ? Math.round((n.tx / 1024) * 10) / 10 : null, 
      speed: n.speed != null ? Math.round((n.speed / 1000000) * 10) / 10 : null, 
      isUp: n.is_up != null ? !!n.is_up : undefined 
    })),
    mainAdapter: mainAdapterSel ? (mainAdapterSel.interface_name || mainAdapterSel.key) : null,
    rx: mainAdapterSel && mainAdapterSel.rx != null ? Math.round((mainAdapterSel.rx / 1024) * 10) / 10 : null,
    tx: mainAdapterSel && mainAdapterSel.tx != null ? Math.round((mainAdapterSel.tx / 1024) * 10) / 10 : null,
    sensors: sensors.map((s) => ({ 
      label: s.label, 
      value: Math.round(s.value * 10) / 10, 
      unit: s.unit || '', 
      kind: s.type || '' 
    })),
    uptimeSec: data.uptime ? parseUptime(data.uptime) : null,
    mainFsUsed: mainFs && mainFs.percent != null ? Math.round(mainFs.percent * 10) / 10 : null,
    diskRead: diskRead > 0 ? Math.round(diskRead * 10) / 10 : null,
    diskWrite: diskWrite > 0 ? Math.round(diskWrite * 10) / 10 : null,
    fanSpeed: fanSensor ? Math.round(fanSensor.value) : null,
    battery: battery.percent != null ? Math.round(battery.percent * 10) / 10 : null,
    batteryTimeLeft: battery.timeleft != null ? Math.round(battery.timeleft * 60) : null,
    batteryIsCharging: battery.ischarging != null ? !!battery.ischarging : null,
    wifiSSID: wifi.ssid || null,
    wifiQuality: wifi.quality != null ? Math.round(wifi.quality * 10) / 10 : null,
    wifiSignal: wifi.signal != null ? Math.round(wifi.signal) : null,
    wifiBitrate: wifi.bitrate != null ? Math.round(wifi.bitrate) : null,
    processes: procList,
    containers: contList,
    cloudProvider: cloud.provider || null,
  };
}

function parseUptime(uptimeStr) {
  // Парсинг uptime строки вида "2 days, 03:45:12"
  const match = uptimeStr.match(/(\d+)\s*days?/i);
  const days = match ? parseInt(match[1], 10) : 0;
  const timeMatch = uptimeStr.match(/(\d{2}):(\d{2}):(\d{2})/);
  const seconds = timeMatch 
    ? parseInt(timeMatch[1], 10) * 3600 + parseInt(timeMatch[2], 10) * 60 + parseInt(timeMatch[3], 10)
    : 0;
  return days * 86400 + seconds;
}

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

/**
 * Сбор метрик из Prometheus API (пункт 11)
 */
export async function collectPrometheus(baseUrl, fetchTextFn) {
  const base = String(baseUrl).replace(/\/+$/, '');
  
  try {
    // Запрос основных метрик через PromQL
    const queries = {
      cpu: '100 - (avg by(instance) (irate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)',
      ram: '(1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100',
      disk: '(1 - (node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"})) * 100',
    };

    const results = {};
    for (const [name, query] of Object.entries(queries)) {
      try {
        const url = `${base}/api/v1/query?query=${encodeURIComponent(query)}`;
        const txt = await fetchTextFn(url, 5000);
        const data = JSON.parse(txt);
        if (data.status === 'success' && data.data.result?.[0]?.value) {
          results[name] = parseFloat(data.data.result[0].value[1]);
        }
      } catch (e) {
        telemetryLogger.warn(`Prometheus метрика недоступна: ${name}`, { error: e.message });
      }
    }

    telemetryLogger.info('Prometheus метрики собраны', results);
    
    return {
      cpu: results.cpu ?? null,
      ram: results.ram ?? null,
      disk: results.disk ?? null,
      source: 'prometheus',
    };
  } catch (e) {
    telemetryLogger.error('Ошибка сбора Prometheus метрик', { error: e.message });
    return null;
  }
}

/**
 * Обработка метрик из Telegraf (пункт 11)
 * Telegraf обычно отправляет данные в формате InfluxDB Line Protocol
 */
export function parseTelegrafLineProtocol(line) {
  // Формат: measurement,tag_set field_set timestamp
  // Пример: cpu,cpu=cpu0 usage_idle=98.5 1234567890
  try {
    const parts = line.split(' ');
    if (parts.length < 2) return null;

    const [measurementTags, ...fieldParts] = parts;
    const [measurement, ...tags] = measurementTags.split(',');
    
    const tagObj = {};
    tags.forEach((t) => {
      const [k, v] = t.split('=');
      tagObj[k] = v;
    });

    const fields = {};
    fieldParts.forEach((f) => {
      const [k, v] = f.split('=');
      fields[k] = parseFloat(v) || v;
    });

    return { measurement, tags: tagObj, fields, timestamp: parts[parts.length - 1] };
  } catch (e) {
    telemetryLogger.warn('Ошибка парсинга Telegraf строки', { line: line.slice(0, 100), error: e.message });
    return null;
  }
}

export default {
  parseGlancesData,
  collectNetdata,
  collectPrometheus,
  parseTelegrafLineProtocol,
};
