// ─── PLUTO Checks: модуль проверок устройств с батчингом ─────────────────────
import { execFile } from 'node:child_process';

/**
 * Модуль проверок (пункт 13 - батчинг и Promise.all с ограничением параллелизма)
 * Поддерживает различные типы проверок: ping, http, api, rtsp, sip
 */

const checkLogger = {
  error: (msg, ctx) => console.error(`[pluto][checks][ERROR] ${msg}`, JSON.stringify(ctx)),
  warn: (msg, ctx) => console.warn(`[pluto][checks][WARN] ${msg}`, JSON.stringify(ctx)),
  info: (msg, ctx) => console.info(`[pluto][checks][INFO] ${msg}`, JSON.stringify(ctx)),
};

/**
 * Проверка доступности через ping
 */
export function checkPing(address, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const to = setTimeout(() => {
      checkLogger.warn('Таймаут ping', { address, timeoutMs });
      resolve({ ok: false, latency: null });
    }, timeoutMs + 500);
    
    // Wall-time включает спавн процесса ping и доставку завершения (+5…20 мс),
    // поэтому при успехе приоритет — задержке из вывода самой утилиты («time=X ms»).
    const started = Date.now();
    execFile('ping', ['-c', '1', '-W', String(Math.max(1, Math.ceil(timeoutMs / 1000))), address], (err, stdout) => {
      clearTimeout(to);
      if (err) {
        checkLogger.info('Ping неудачен', { address, error: err.message });
        return resolve({ ok: false, latency: null });
      }
      const m = /time[=<]\s*([\d.,]+)\s*ms/i.exec(stdout || '');
      // Сохраняем дробные миллисекунды (округление до сотых): реальные 1.2–1.4 мс
      // не должны превращаться в «1», а 4.6 — в «5» заранее, иначе показания
      // расходятся с выводом «ping» из консоли.
      const latency = m ? Math.round(parseFloat(m[1].replace(',', '.')) * 100) / 100 : Math.max(1, Date.now() - started);
      checkLogger.info('Ping успешен', { address, latency });
      resolve({ ok: true, latency });
    });
  });
}

/**
 * Проверка HTTP/HTTPS endpoint
 */
export async function checkHttp(d, fetchTextFn, timeoutMs) {
  const base = /^https?:\/\//i.test(d.address) ? d.address : `http://${d.address}${d.port ? ':' + d.port : ''}`;
  const url = base + (d.path || '');
  const started = Date.now();
  
  try {
    const html = await fetchTextFn(url, timeoutMs);
    const latency = Date.now() - started;
    checkLogger.info('HTTP проверка успешна', { url, latency });
    return { ok: html != null, latency };
  } catch (e) {
    checkLogger.warn('HTTP проверка неудачна', { url, error: e.message });
    return { ok: false, latency: null };
  }
}

/**
 * Запуск проверки устройства в зависимости от типа
 */
export async function runDeviceCheck(d, fetchTextFn, settings) {
  const timeoutMs = settings?.timeoutMs || 3000;
  let res;
  
  switch (d.type) {
    case 'ping':
      res = await checkPing(d.address, timeoutMs);
      break;
    case 'http':
    case 'api':
      res = await checkHttp(d, fetchTextFn, timeoutMs);
      break;
    case 'rtsp':
      res = await checkHttp({ ...d, path: '' }, fetchTextFn, timeoutMs);
      break;
    case 'sip':
      checkLogger.warn('SIP проверки пока не реализованы', { device: d.name });
      res = { ok: false, latency: null };
      break;
    default:
      checkLogger.warn(`Неизвестный тип проверки: ${d.type}`, { device: d.name });
      res = { ok: false, latency: null };
  }
  
  return res;
}

/**
 * Выполнение проверок с ограничением параллелизма (concurrency limit)
 * Пункт 13: батчинг и Promise.all с ограничением параллелизма
 */
export async function runBatchedChecks(devices, fetchTextFn, settings, concurrencyLimit = 10) {
  const results = [];
  const queue = [...devices];
  const inProgress = new Map();
  
  return new Promise((resolve) => {
    function runNext() {
      while (inProgress.size < concurrencyLimit && queue.length > 0) {
        const device = queue.shift();
        const promise = runDeviceCheck(device, fetchTextFn, settings)
          .then((res) => {
            inProgress.delete(device.id);
            return { device, res };
          })
          .catch((e) => {
            checkLogger.error('Ошибка при проверке устройства', { 
              device: device.name, 
              error: e.message 
            });
            inProgress.delete(device.id);
            return { device, res: { ok: false, latency: null, error: e.message } };
          });
        
        inProgress.set(device.id, promise);
        results.push(promise);
      }
      
      if (inProgress.size === 0 && queue.length === 0) {
        // Все проверки завершены
        Promise.all(results).then(resolve);
      } else {
        // Ждём завершения хотя бы одной проверки для запуска следующей
        Promise.race(inProgress.values()).finally(() => {
          if (queue.length > 0) {
            runNext();
          }
        });
      }
    }
    
    if (devices.length === 0) {
      resolve([]);
    } else {
      runNext();
    }
  });
}

/**
 * Расширенная проверка SSL-сертификата (пункт 9)
 */
export async function checkSSL(host, port = 443, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const tls = require('node:tls');
    const socket = tls.connect(port, host, {
      rejectUnauthorized: false, // Не прерываем соединение при ошибке сертификата
      servername: host,
    });
    
    socket.setTimeout(timeoutMs);
    
    socket.on('secureConnect', () => {
      const cert = socket.getPeerCertificate(true);
      const now = Date.now();
      const validFrom = new Date(cert.valid_from).getTime();
      const validTo = new Date(cert.valid_to).getTime();
      const daysUntilExpiry = Math.floor((validTo - now) / (1000 * 60 * 60 * 24));
      
      const result = {
        ok: !cert.authorizationError && daysUntilExpiry > 0,
        issuer: cert.issuer?.O || 'unknown',
        subject: cert.subject?.CN || host,
        validFrom,
        validTo,
        daysUntilExpiry,
        expired: daysUntilExpiry <= 0,
        expiringSoon: daysUntilExpiry > 0 && daysUntilExpiry <= 30,
      };
      
      socket.destroy();
      resolve(result);
    });
    
    socket.on('error', (e) => {
      checkLogger.error('Ошибка SSL проверки', { host, port, error: e.message });
      resolve({ ok: false, error: e.message });
    });
    
    socket.on('timeout', () => {
      socket.destroy();
      checkLogger.warn('Таймаут SSL проверки', { host, port });
      resolve({ ok: false, error: 'timeout' });
    });
  });
}

/**
 * Проверка TCP-порта (пункт 9)
 */
export async function checkTCPPort(host, port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const net = require('node:net');
    const socket = new net.Socket();
    const started = Date.now();
    
    socket.setTimeout(timeoutMs);
    
    socket.on('connect', () => {
      const latency = Date.now() - started;
      checkLogger.info('TCP порт открыт', { host, port, latency });
      socket.destroy();
      resolve({ ok: true, latency });
    });
    
    socket.on('error', (e) => {
      checkLogger.info('TCP порт закрыт или недоступен', { host, port, error: e.message });
      resolve({ ok: false, error: e.message });
    });
    
    socket.on('timeout', () => {
      socket.destroy();
      checkLogger.warn('Таймаут TCP проверки', { host, port });
      resolve({ ok: false, error: 'timeout' });
    });
    
    socket.connect(port, host);
  });
}

/**
 * DNS проверка (пункт 9)
 */
export async function checkDNS(hostname, recordType = 'A', timeoutMs = 5000) {
  return new Promise((resolve) => {
    const dns = require('node:dns').promises;
    const to = setTimeout(() => {
      checkLogger.warn('Таймаут DNS проверки', { hostname, recordType });
      resolve({ ok: false, error: 'timeout', records: [] });
    }, timeoutMs);
    
    dns.resolve(hostname, recordType)
      .then((records) => {
        clearTimeout(to);
        checkLogger.info('DNS проверка успешна', { hostname, recordType, count: records.length });
        resolve({ ok: true, records, count: records.length });
      })
      .catch((e) => {
        clearTimeout(to);
        checkLogger.warn('DNS проверка неудачна', { hostname, recordType, error: e.message });
        resolve({ ok: false, error: e.message, records: [] });
      });
  });
}

export default {
  checkPing,
  checkHttp,
  runDeviceCheck,
  runBatchedChecks,
  checkSSL,
  checkTCPPort,
  checkDNS,
};
