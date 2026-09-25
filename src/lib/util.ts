// ─── PLUTO: утилиты ─────────────────────────────────────────────────────────

/** Версия консоли (запекается в сборку). Должна совпадать с VERSION в корне. */
export const CONSOLE_VERSION = '2.0.0';

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rnd(min: number, max: number): number { return min + Math.random() * (max - min); }
export function rndInt(min: number, max: number): number { return Math.floor(rnd(min, max + 1)); }
export function clamp(v: number, min: number, max: number): number { return Math.min(max, Math.max(min, v)); }

let counter = 0;
export function uid(prefix: string): string {
  counter = (counter + 1) % 1296;
  return `${prefix}-${Date.now().toString(36)}${counter.toString(36).padStart(2, '0')}${Math.floor(Math.random() * 1296).toString(36).padStart(2, '0')}`;
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
  if (!ts || ts <= 0) return '—';
  const d = Math.max(0, Date.now() - ts);
  if (d < 5_000) return 'только что';
  if (d < 60_000) {
    const sec = Math.floor(d / 1000);
    return sec > 0 ? `${sec} с назад` : 'только что';
  }
  if (d < 3_600_000) {
    const min = Math.floor(d / 60_000);
    return min > 0 ? `${min} мин назад` : 'только что';
  }
  if (d < 86_400_000) {
    const hr = Math.floor(d / 3_600_000);
    return hr > 0 ? `${hr} ч назад` : 'только что';
  }
  const days = Math.floor(d / 86_400_000);
  return days > 0 ? `${days} д назад` : 'только что';
}

export function fmtClock(ts: number): string {
  return new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function fmtMs(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n >= 1000) return `${(n / 1000).toFixed(2)} с`;
  // Дробные значения показываем с точностью до десятых (1.4 мс), целые — как есть.
  return Number.isInteger(n) ? `${n} мс` : `${n.toFixed(1)} мс`;
}

export function fmtUp(ms: number): string {
  if (!ms || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d} д ${h} ч`;
  if (h > 0) return `${h} ч ${m} м`;
  if (m > 0) return `${m} м`;
  return `${s} с`;
}

export function fmtNet(kbs: number | null | undefined): string {
  if (kbs == null) return '—';
  if (kbs >= 1024 * 1024) return `${(kbs / 1024 / 1024).toFixed(2)} ГБ/с`;
  if (kbs >= 1024) return `${(kbs / 1024).toFixed(1)} МБ/с`;
  return `${Math.round(kbs)} КБ/с`;
}

export function fmtGb(bytes: number): string { return `${(bytes / 1024 ** 3).toFixed(0)} ГБ`; }

// ─── Валидация ───────────────────────────────────────────────────────────────

export function isIp(s: string): boolean {
  return /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(s) &&
    s.split('.').every((o) => +o >= 0 && +o <= 255);
}

// Подсеть с перечислением нужных хостов через запятую: «10.0.0.0/24:5,77,100»
const SUBNET_HOSTS_RE = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,2}):(\d{1,3}(?:\s*,\s*\d{1,3})*)$/;

// Один элемент списка цели: одиночный IP или диапазон вида x.y.z.a-b
const TARGET_ITEM_IP_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const TARGET_ITEM_RANGE_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}-\d{1,3}$/;

// Список адресов/диапазонов через запятую: «10.0.0.5, 10.0.0.77, 10.0.0.90-95».
// Не путать с записью «подсеть:хосты» (там после двоеточия идут только хосты).
function splitTargetList(t: string): string[] | null {
  if (!t.includes(',') || t.includes('/')) return null;
  const parts = t.split(',').map((p) => p.trim()).filter(Boolean);
  return parts.length > 1 ? parts : null;
}

export function isTarget(s: string): boolean {
  if (isIp(s)) return true;
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}-\d{1,3}$/.test(s)) return true;
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,2}$/.test(s)) return true;
  const list = splitTargetList(String(s ?? '').trim());
  if (list) return list.every((p) => TARGET_ITEM_IP_RE.test(p) || TARGET_ITEM_RANGE_RE.test(p));
  const sh = SUBNET_HOSTS_RE.exec(s.trim());
  if (sh && /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,2}$/.test(sh[1]) && +sh[1].split('/')[1] >= 24) {
    return sh[2].split(',').every((h) => +h.trim() >= 1 && +h.trim() <= 254);
  }
  return false;
}

export function expandTargets(target: string): string[] {
  const t = (typeof target === 'string' ? target : '').trim();
  if (isIp(t)) return [t];
  // Список адресов/диапазонов через запятую: разворачиваем каждый элемент отдельно
  const list = splitTargetList(t);
  if (list) {
    const out: string[] = [];
    for (const p of list) {
      for (const ip of expandTargets(p)) if (!out.includes(ip)) out.push(ip);
      if (out.length >= 256) break;
    }
    return out.slice(0, 256);
  }
  // Подсеть + конкретные хосты через запятую: пингуем только указанные IP,
  // а не всю подсеть (например «10.0.0.0/24:5,77,100» → .5, .77, .100).
  const subnetHosts = SUBNET_HOSTS_RE.exec(t);
  if (subnetHosts && +subnetHosts[1].split('/')[1] >= 24) {
    const base = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.)/.exec(subnetHosts[1])![1];
    const out: string[] = [];
    for (const h of subnetHosts[2].split(',')) {
      const n = +h.trim();
      if (n >= 1 && n <= 254 && !out.includes(base + n)) out.push(base + n);
    }
    return out;
  }
  const range = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.)(\d{1,3})-(\d{1,3})$/.exec(t);
  if (range) {
    const out: string[] = [];
    const a = +range[2], b = +range[3];
    for (let i = Math.min(a, b); i <= Math.max(a, b) && out.length < 256; i++) out.push(range[1] + i);
    return out;
  }
  const cidr = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.)\d{1,3}\/(\d{1,2})$/.exec(t);
  if (cidr && +cidr[2] >= 24) {
    const out: string[] = [];
    for (let i = 1; i < 255; i++) out.push(cidr[1] + i);
    return out;
  }
  return [];
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

/** Цвета линий для многосерийных графиков. */
export const LINE_COLORS = ['#8f7df0', '#7ba4e6', '#5fc6d8', '#55c795', '#e0b65e', '#e07a80', '#d98bb0', '#8bc46a'];

// ─── Агрегации ───────────────────────────────────────────────────────────────

// ─── 2FA (TOTP, RFC 6238) — для встроенного режима ──────────────────────────

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Random(len = 16): string {
  let s = '';
  for (let i = 0; i < len; i++) s += B32_ALPHABET[Math.floor(Math.random() * 32)];
  return s;
}

/** Простой детерминированный TOTP на строке (встроенный режим, без WebCrypto). */
export function totpCode(secret: string, timeStep = 30): string {
  const counter = Math.floor(Date.now() / 1000 / timeStep);
  let h = hashStr(secret + ':' + counter);
  h = (h ^ (h >>> 13)) >>> 0;
  return String(h % 1000000).padStart(6, '0');
}

export function verifyTotp(secret: string, code: string): boolean {
  const now = Math.floor(Date.now() / 1000 / 30);
  for (const drift of [-1, 0, 1]) {
    let h = hashStr(secret + ':' + (now + drift));
    h = (h ^ (h >>> 13)) >>> 0;
    if (String(h % 1000000).padStart(6, '0') === code) return true;
  }
  return false;
}

/** Хэш пароля встроенного режима (не криптостойкий — только локальная демонстрация). */
export function embedHash(pass: string): string {
  return 'e' + hashStr('pluto-salt::' + pass).toString(36);
}

/** Агрегированная ping-статистика агента по всем его целям. */
// Агрегированная статистика хаба по целям: ТОЛЬКО счётчики состояний.
// Задержки (avg/max) из «Хабов» убраны намеренно: relay отдаёт одинаковый RTT
// для всех IP диапазона, и метрика вводила в заблуждение.
export function pingStats(targets: { results?: { alive: boolean }[] }[]): {
  total: number; online: number; offline: number;
} {
  let total = 0, online = 0;
  for (const t of targets) {
    const results = Array.isArray(t.results) ? t.results : [];
    for (const r of results) {
      total++;
      if (r.alive) online++;
    }
  }
  return { total, online, offline: total - online };
}

export function pct(used: number, total: number): number {
  return total > 0 ? Math.round((used / total) * 100) : 0;
}
