// ─── PLUTO: утилиты ─────────────────────────────────────────────────────────

export const CONSOLE_VERSION = '1.12.0';

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

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

export function fmtMs(n: number | null): string {
  if (n == null) return '—';
  if (n >= 1000) return `${(n / 1000).toFixed(2)} с`;
  return `${Math.round(n)} мс`;
}

export function fmtUp(ms: number): string {
  if (ms <= 0) return '—';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}д ${h}ч`;
  if (h > 0) return `${h}ч ${m}м`;
  return `${m}м ${s % 60}с`;
}

export function isIp(s: string): boolean {
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(s.trim());
}

/** IP, диапазон a.b.c.1-10 или подсеть a.b.c.0/24 */
export function isTarget(s: string): boolean {
  const t = s.trim();
  if (isIp(t)) return true;
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\s*-\s*\d{1,3}$/.test(t)) return true;
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,2}$/.test(t)) return true;
  return false;
}

export function expandTargets(target: string): string[] {
  const t = target.trim();
  if (isIp(t)) return [t];
  const range = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.)(\d{1,3})\s*-\s*(\d{1,3})$/.exec(t);
  if (range) {
    const out: string[] = [];
    const a = parseInt(range[2], 10);
    const b = parseInt(range[3], 10);
    for (let i = Math.min(a, b); i <= Math.max(a, b) && out.length < 256; i++) out.push(range[1] + i);
    return out;
  }
  const cidr = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.)\d{1,3}\/(\d{1,2})$/.exec(t);
  if (cidr && parseInt(cidr[2], 10) >= 24) {
    const out: string[] = [];
    for (let i = 1; i < 255; i++) out.push(cidr[1] + i);
    return out;
  }
  return [];
}

export const TAG_COLORS = [
  '#9a8cfa', '#7ba4e6', '#5fc6d8', '#55c795', '#8bc46a',
  '#e0b65e', '#e0945e', '#e07a80', '#d98bb0', '#98a4c8',
];

export const LINE_COLORS = ['#8f7df0', '#7ba4e6', '#5fc6d8', '#55c795', '#e0b65e', '#e07a80', '#d98bb0', '#8bc46a'];
