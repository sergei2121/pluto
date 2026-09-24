// ─── Вспомогательные HTTP-клиенты и хелперы ────────────────────────────────
import http from 'node:http';
import https from 'node:https';

/** GET по URL с таймаутом; отвечает телом (текст). Разрешает редиректы 301/302/307/308. */
export function fetchText(rawUrl, timeoutMs = 7000) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(rawUrl); } catch { return reject(new Error('некорректный адрес')); }
    const lib = u.protocol === 'https:' ? https : http;
    const r = lib.get(u, { timeout: timeoutMs, headers: { Connection: 'close' } }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return fetchText(new URL(res.headers.location, u).toString(), timeoutMs).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(data));
    });
    r.on('timeout', () => r.destroy(new Error('таймаут запроса')));
    r.on('error', (e) => reject(e));
  });
}

/** JSON-клиент: GET по URL с таймаутом, ответ парсится как JSON. */
export function fetchJson(rawUrl, timeoutMs = 7000) {
  return fetchText(rawUrl, timeoutMs).then((txt) => JSON.parse(txt));
}

/** Ответ JSON-ом с корректным content-type. */
export function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

/** Ответ текстом (или иным content-type). */
export function text(res, code, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type });
  res.end(body);
}

/** Читает и парсит JSON-тело запроса; при ошибке возвращает {}. */
export function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); } });
  });
}

/** Разворачивает строку «IP / диапазон x.y.z.a-b / подсеть /24» в список IP (не более 256). */
export function expandTargets(target) {
  const t = String(target).trim();
  if (/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(t)) return [t];
  const range = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.)(\d{1,3})-(\d{1,3})$/.exec(t);
  if (range) {
    const out = [];
    const a = +range[2], b = +range[3];
    for (let i = Math.min(a, b); i <= Math.max(a, b) && out.length < 256; i++) out.push(range[1] + i);
    return out;
  }
  const cidr = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.)\d{1,3}\/(\d{1,2})$/.exec(t);
  if (cidr && +cidr[2] >= 24) {
    const out = [];
    for (let i = 1; i < 255; i++) out.push(cidr[1] + i);
    return out;
  }
  return [];
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Аккумулирует длительность офлайна за скользящие 30 дней:
 * при переходе «офлайн → онлайн» добавляет время простоя к накопленному значению.
 */
export function accumulateOffline(entity, now) {
  let total = entity.offlineDuration30d || 0;
  if (entity.offlineSince) {
    total = Math.min(THIRTY_DAYS_MS, total + (now - entity.offlineSince));
    entity.offlineSince = null;
  }
  entity.offlineDuration30d = total;
  return total;
}
