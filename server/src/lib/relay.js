// ─── Relay-пинги: опрос устройств внутри VLAN/NAT через pluto-relay ─────────
// Архитектура измерений (v2.1): relay пингует цели СВОЕЙ локальной сети серией
// ICMP-пакетов и возвращает честную статистику (min/avg/max/median/jitter/loss).
// Ядро при этом само измеряет сетевой путь до relay (оборачивая HTTP-запрос
// замером checkPing(agent.ip)) и вычитает его из RTT, которыеrelay получил бы
// «снаружи» — так из показателей не исчезает вклад канала сервер↔агент.
import { fetchText } from './http.js';
import { checkPing } from '../checks/deviceChecks.js';

/**
 * Опрашивает relay-агент по списку IP.
 * @param {object} agent   агент с relayUrl и ip
 * @param {string[]} targets список IP для пинга
 * @param {(address:string)=>Promise<{ok:boolean,latency:number|null}>} [pingFn]
 *        функция измерения пути ядро→relay (по умолчанию checkPing; инъектируется в тестах)
 * @returns {Promise<Array>} результаты [{ ip, alive, latency, minMs, maxMs, jitterMs, lossPct,
 *          sent, received, pathMs, offlineSince, offlineDuration30d, lastSuccess }];
 *          пустой массив, если relay недоступен (caller сохраняет предыдущий снимок).
 */
export async function relayPing(agent, targets, pingFn = checkPing) {
  if (!agent.relayUrl) return [];
  const base = String(agent.relayUrl).replace(/\/+$/, '');
  const url = base + '/ping?targets=' + encodeURIComponent(targets.join(','));

  // 1) Реальный сетевой путь ядро → relay (ICMP к ПК агента), параллельно с запросом.
  const pathPromise = Promise.resolve().then(() => pingFn(agent.ip, 2000)).catch(() => ({ ok: false, latency: null }));

  let payload;
  try {
    const txt = await fetchText(url, 25000);
    payload = JSON.parse(txt);
  } catch { /* relay недоступен */ }

  // 2) Путь до relay — фактическое время доставки до агента (для отображения и вычитания).
  const path = await pathPromise;
  const pathMs = path.ok ? path.latency : null;

  // Обратная совместимость: старые версии relay отвечали голым массивом.
  const arr = Array.isArray(payload) ? payload : (Array.isArray(payload?.results) ? payload.results : null);
  if (!arr) return [];

  return arr.map((r) => {
    const alive = !!r.alive;
    const latency = r.latencyMs != null ? r.latencyMs : (r.latency != null ? r.latency : null);
    return {
      ip: r.ip,
      alive,
      // медиана серии пакетов, измеренная НА агенте (его локальная сеть)
      latency,
      minMs: r.minMs ?? null,
      avgMs: r.avgMs ?? null,
      maxMs: r.maxMs ?? null,
      jitterMs: r.jitterMs ?? null,
      lossPct: r.lossPct ?? null,
      sent: r.sent ?? null,
      received: r.received ?? null,
      // RTT этого устройства, видимый со стороны ядра: локальный RTT + путь до агента
      pathMs: alive && latency != null && pathMs != null ? Math.round((latency + pathMs) * 100) / 100 : null,
      offlineSince: !alive ? Date.now() : undefined,
      offlineDuration30d: 0,
      // при успешном пинге фиксируем время последней связи
      lastSuccess: alive ? Date.now() : null,
    };
  });
}

export default { relayPing };
