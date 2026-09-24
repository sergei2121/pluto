// ─── Relay-пинги: опрос устройств за NAT/VLAN через pluto-relay ─────────────
import { fetchText } from './http.js';

/**
 * Опрашивает relay-агент по списку IP.
 * @returns {Promise<Array>} результаты [{ ip, alive, latency, offlineSince, offlineDuration30d, lastSuccess }];
 *          пустой массив, если relay недоступен (caller сохраняет предыдущий снимок).
 */
export async function relayPing(agent, targets) {
  if (!agent.relayUrl) return [];
  const base = String(agent.relayUrl).replace(/\/+$/, '');
  const url = base + '/ping?targets=' + encodeURIComponent(targets.join(','));
  const now = Date.now();
  try {
    const txt = await fetchText(url, 15000);
    const arr = JSON.parse(txt);
    if (Array.isArray(arr)) {
      return arr.map((r) => {
        const alive = !!r.alive;
        return {
          ip: r.ip,
          alive,
          latency: r.latencyMs != null ? r.latencyMs : (r.latency != null ? r.latency : null),
          offlineSince: !alive ? now : undefined,
          offlineDuration30d: 0,
          // при успешном пинге фиксируем время последней связи
          lastSuccess: alive ? now : null,
        };
      });
    }
  } catch { /* relay недоступен */ }
  return [];
}
