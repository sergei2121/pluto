// ─── PLUTO: утилиты ─────────────────────────────────────────────────────────

/** Версия консоли (запекается в сборку). Должна совпадать с VERSION в корне. */
export const CONSOLE_VERSION = '1.6.4';

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Детерминированный ГПСЧ (mulberry32) — только для эмуляционного профиля */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rnd(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export function rndInt(min: number, max: number): number {
  return Math.floor(rnd(min, max + 1));
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

let counter = 0;
export function uid(prefix: string): string {
  counter = (counter + 1) % 1296;
  return `${prefix}-${Date.now().toString(36)}${counter.toString(36).padStart(2, '0')}${Math.floor(
    Math.random() * 1296,
  )
    .toString(36)
    .padStart(2, '0')}`;
}

export function genToken(len = 28): string {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < len; i++) out += abc[Math.floor(Math.random() * abc.length)];
  return out;
}

export function cls(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

// ─── Форматирование ──────────────────────────────────────────────────────────

export function timeAgo(ts: number): string {
  if (!ts) return '—';
  const d = Math.max(0, Date.now() - ts);
  if (d < 5_000) return 'только что';
  if (d < 60_000) return `${Math.floor(d / 1000)} с назад`;
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} мин назад`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)} ч назад`;
  return `${Math.floor(d / 86_400_000)} д назад`;
}

export function fmtClock(ts: number): string {
  return new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${Math.round(n)} Б`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} КБ`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} МБ`;
  if (n < 1024 ** 4) return `${(n / 1024 ** 3).toFixed(2)} ГБ`;
  return `${(n / 1024 ** 4).toFixed(2)} ТБ`;
}

export function fmtGb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(0)} ГБ`;
}

export function fmtMs(n: number | null): string {
  if (n == null) return '—';
  if (n >= 1000) return `${(n / 1000).toFixed(2)} с`;
  return `${Math.round(n)} мс`;
}

export function pct(used: number, total: number): number {
  return total > 0 ? Math.round((used / total) * 100) : 0;
}

// ─── Палитра тегов (10 цветов) ───────────────────────────────────────────────

export const TAG_COLORS = [
  '#9a8cfa', // фиолетовый
  '#7ba4e6', // синий
  '#5fc6d8', // циан
  '#55c795', // мятный
  '#8bc46a', // зелёный
  '#e0b65e', // янтарный
  '#e0945e', // оранжевый
  '#e07a80', // коралловый
  '#d98bb0', // розовый
  '#98a4c8', // стальной
];

export function macFrom(seedStr: string): string {
  const rng = mulberry32(hashStr(seedStr));
  const b = () => Math.floor(rng() * 256).toString(16).padStart(2, '0').toUpperCase();
  return `${b()}:${b()}:${b()}:${b()}:${b()}:${b()}`;
}
