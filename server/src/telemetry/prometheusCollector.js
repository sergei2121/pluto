// ─── PLUTO Telemetry: Prometheus Collector (пункт 11) ───────────────────────
/**
 * Сборщик метрик из Prometheus-compatible endpoints
 * Поддерживает форматы: Prometheus text, JSON
 */

/**
 * Парсит Prometheus text format
 * @param {string} text - сырые данные в формате Prometheus
 * @returns {Object} - объект с метриками
 */
export function parsePrometheusText(text) {
  const metrics = {};
  const lines = text.split('\n');
  
  for (const line of lines) {
    // Пропускаем комментарии и пустые строки
    if (!line.trim() || line.startsWith('#')) continue;
    
    const match = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)\s+([^\s#]+)/);
    if (!match) continue;
    
    const [, name, value] = match;
    const numValue = parseFloat(value);
    
    if (!isNaN(numValue)) {
      // Извлекаем лейблы из имени метрики
      const labelMatch = name.match(/^([a-zA-Z_:]+)\{(.+)\}$/);
      if (labelMatch) {
        const metricName = labelMatch[1];
        const labelsStr = labelMatch[2];
        const labels = {};
        
        // Парсим лейблы: key="value"
        const labelPairs = labelsStr.match(/([a-zA-Z_][a-zA-Z0-9_]*)="([^"]*)"/g) || [];
        for (const pair of labelPairs) {
          const [, k, v] = pair.match(/([a-zA-Z_][a-zA-Z0-9_]*)="([^"]*)"/);
          labels[k] = v;
        }
        
        if (!metrics[metricName]) {
          metrics[metricName] = [];
        }
        metrics[metricName].push({ value: numValue, labels });
      } else {
        metrics[name] = [{ value: numValue, labels: {} }];
      }
    }
  }
  
  return metrics;
}

/**
 * Собирает метрики из Prometheus endpoint
 * @param {Function} fetchFn - функция для HTTP запросов
 * @param {string} url - URL Prometheus endpoint
 * @param {number} timeoutMs - таймаут в мс
 * @returns {Promise<Object>} - распарсенные метрики
 */
export async function collectPrometheus(fetchFn, url, timeoutMs = 7000) {
  try {
    const text = await fetchFn(url, timeoutMs);
    return parsePrometheusText(text);
  } catch (e) {
    console.error(`[Prometheus] Ошибка сбора метрик из ${url}: ${e.message}`);
    return null;
  }
}

/**
 * Преобразует Prometheus метрики в формат PLUTO
 * @param {Object} promMetrics - метрики из Prometheus
 * @returns {Object} - метрики в формате PLUTO
 */
export function prometheusToPluto(promMetrics) {
  if (!promMetrics) return null;
  
  const result = {
    cpu: null,
    ram: null,
    disk: [],
    network: { rx: null, tx: null },
    temperature: [],
    custom: []
  };
  
  // CPU usage
  if (promMetrics.node_cpu_seconds_total) {
    const idle = promMetrics.node_cpu_seconds_total
      .filter(m => m.labels.mode === 'idle')
      .reduce((sum, m) => sum + m.value, 0);
    const total = promMetrics.node_cpu_seconds_total
      .reduce((sum, m) => sum + m.value, 0);
    
    if (total > 0) {
      result.cpu = Math.round(((total - idle) / total) * 100 * 10) / 10;
    }
  }
  
  // Memory
  if (promMetrics.node_memory_MemTotal_bytes && promMetrics.node_memory_MemAvailable_bytes) {
    const total = promMetrics.node_memory_MemTotal_bytes[0]?.value || 0;
    const available = promMetrics.node_memory_MemAvailable_bytes[0]?.value || 0;
    if (total > 0) {
      result.ram = Math.round(((total - available) / total) * 100 * 10) / 10;
    }
  }
  
  // Disk usage
  if (promMetrics.node_filesystem_avail_bytes && promMetrics.node_filesystem_size_bytes) {
    const avail = promMetrics.node_filesystem_avail_bytes;
    const size = promMetrics.node_filesystem_size_bytes;
    
    for (const a of avail) {
      const correspondingSize = size.find(s => 
        s.labels.mountpoint === a.labels.mountpoint &&
        s.labels.device === a.labels.device
      );
      
      if (correspondingSize && a.value > 0 && correspondingSize.value > 0) {
        const usedPercent = Math.round(((correspondingSize.value - a.value) / correspondingSize.value) * 100 * 10) / 10;
        result.disk.push({
          mountpoint: a.labels.mountpoint,
          device: a.labels.device,
          usedPercent: usedPercent,
          usedGB: Math.round((correspondingSize.value - a.value) / 1024 ** 3 * 10) / 10,
          totalGB: Math.round(correspondingSize.value / 1024 ** 3 * 10) / 10
        });
      }
    }
  }
  
  // Network
  if (promMetrics.node_network_receive_bytes_total && promMetrics.node_network_transmit_bytes_total) {
    const rx = promMetrics.node_network_receive_bytes_total
      .filter(m => !m.labels.device?.startsWith('lo'))
      .reduce((sum, m) => sum + m.value, 0);
    const tx = promMetrics.node_network_transmit_bytes_total
      .filter(m => !m.labels.device?.startsWith('lo'))
      .reduce((sum, m) => sum + m.value, 0);
    
    result.network.rx = Math.round(rx / 1024 * 10) / 10; // KB
    result.network.tx = Math.round(tx / 1024 * 10) / 10; // KB
  }
  
  // Temperature
  if (promMetrics.node_hwmon_temp_celsius) {
    result.temperature = promMetrics.node_hwmon_temp_celsius.map(m => ({
      sensor: m.labels.chip || m.labels.sensor || 'unknown',
      value: Math.round(m.value * 10) / 10
    }));
  }
  
  // Custom metrics (все остальные)
  const knownMetrics = new Set([
    'node_cpu_seconds_total', 'node_memory_MemTotal_bytes', 
    'node_memory_MemAvailable_bytes', 'node_filesystem_avail_bytes',
    'node_filesystem_size_bytes', 'node_network_receive_bytes_total',
    'node_network_transmit_bytes_total', 'node_hwmon_temp_celsius'
  ]);
  
  for (const [name, values] of Object.entries(promMetrics)) {
    if (!knownMetrics.has(name)) {
      result.custom.push({ name, values });
    }
  }
  
  return result;
}

export default {
  parsePrometheusText,
  collectPrometheus,
  prometheusToPluto
};
