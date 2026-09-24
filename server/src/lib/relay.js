// ─── Relay-пинги: опрос устройств внутри VLAN/NAT через pluto-relay ─────────
// Архитектура измерений (v2.2): relay пингует цели СВОЕЙ локальной сети серией
// ICMP-пакетов и возвращает честную статистику (min/avg/max/median/jitter/loss).
// RTT устройства = ТОЛЬКО медиана серии на агенте: путь ядро↔хаб измеряется
// отдельно (hubRttMs) и к целям НЕ прибавляется — иначе все IP диапазона
// получали бы одинаковую надбавку и замеры выглядели «нарисованными».
// Также по serverNowMs из ответа relay оценивается смещение часов агента,
// чтобы метки lastSuccess/offlineSince были корректны при рассинхронизации.
import { fetchText } from './http.js';
import { checkPing } from '../checks/deviceChecks.js';

/**
 * Опрашивает relay-агент по списку IP.
 * @param {object} agent   агент с relayUrl и ip
 * @param {string[]} targets список IP для пинга
 * @param {(address:string)=>Promise<{ok:boolean,latency:number|null}>} [pingFn]
 *        функция измерения пути ядро→relay (по умолчанию checkPing; инъектируется в тестах)
 * @returns {Promise<Array>} результаты [{ ip, alive, latency, minMs, maxMs, jitterMs, lossPct,
 *          sent, received, pathMs, hubRttMs, offlineSince, offlineDuration30d, lastSuccess }];
 *          пустой массив, если relay недоступен (caller сохраняет предыдущий снимок).
 */
export async function relayPing(agent, targets, pingFn = checkPing) {
  if (!agent.relayUrl) return [];
  const base = String(agent.relayUrl).replace(/\/+$/, '');
  const url = base + '/ping?targets=' + encodeURIComponent(targets.join(','));

  // 1) Путь ядро → ПК агента (ICMP), параллельно с HTTP-запросом. Нужен как
  //    индикатор доступности хаба и отдельная метрика hubRttMs.
  const pathPromise = Promise.resolve().then(() => pingFn(agent.ip, 2000)).catch(() => ({ ok: false, latency: null }));

  // 2) Момент получения ответа от relay (fetchText резолвится сразу после
  // приёма тела — localDone ≈ момент формирования ответа на агенте).
  let payload;
  try {
    const txt = await fetchText(url, 25000);
    payload = JSON.parse(txt);
  } catch { /* relay недоступен */ }
  const localDone = Date.now();

  // 3) Смещение часов ядро↔агент (NTP-подобная оценка): relay отдаёт serverNowMs
  // — часы агента на момент ответа. offset = часы_агента − часы_ядра.
  // Сетевой задержкой в одну сторону пренебрегаем (она ≪ типичной рассинхронизации).
  const offsetMs = Number.isFinite(payload?.serverNowMs) ? payload.serverNowMs - localDone : null;

  // 4) Путь ядро → ПК агента (ICMP). Используется ТОЛЬКО как индикатор доступности
  // хаба — он НЕ прибавляется к RTT устройств: ICMP-замер agent.ip выполняется
  // параллельно HTTP-запросу и сам по себе содержит очередь/прогрев, а сложение
  // двух независимых RTT давало бы одинаковую «надбавку» всем целям диапазона —
  // именно из-за этого пинги выглядели эмулированными и одинаковыми.
  const path = await pathPromise;
  const hubRttMs = path.ok ? path.latency : null;

  // Обратная совместимость: старые версии relay отвечали голым массивом.
  const arr = Array.isArray(payload) ? payload : (Array.isArray(payload?.results) ? payload.results : null);
  if (!arr) return [];

  return arr.map((r) => {
    const alive = !!r.alive;
    // Честный RTT устройства = только медиана серии ICMP, измеренная НА агенте.
    const latency = r.latencyMs != null ? r.latencyMs : (r.latency != null ? r.latency : null);
    // Время фиксации ответа, пересчитанное на часы агента (сопоставимо между
    // циклами опроса даже при рассинхронизации часов).
    const tsAgent = offsetMs != null ? localDone + offsetMs : localDone;
    return {
      ip: r.ip,
      alive,
      latency,
      minMs: r.minMs ?? null,
      avgMs: r.avgMs ?? null,
      maxMs: r.maxMs ?? null,
      jitterMs: r.jitterMs ?? null,
      lossPct: r.lossPct ?? null,
      sent: r.sent ?? null,
      received: r.received ?? null,
      // RTT от ядра = замер агента без искусственных надбавок; путь до хаба — отдельно
      pathMs: alive && latency != null ? Math.round(latency * 100) / 100 : null,
      hubRttMs,
      offlineSince: !alive ? tsAgent : undefined,
      offlineDuration30d: 0,
      // при успешном пинге фиксируем время последней связи (часы агента)
      lastSuccess: alive ? tsAgent : null,
    };
  });
}

export default { relayPing };
