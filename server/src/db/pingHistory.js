// ─── PLUTO: месячная история пингов (устройства онлайн/офлайн) ──────────────
// Хранит события смены состояния (up/down) для устройств, пингуемых агентами,
// и суточные агрегаты доступности за последние 30 дней.
import { saveDb } from '../lib.js';

const DAY_MS = 24 * 60 * 60 * 1000;
export const HISTORY_DAYS = 30;             // глубина хранения — месяц
const MAX_EVENTS_PER_TARGET = 5000;         // защита от разрастания db.json

/** Ключ цели: агент + диапазон/имя + IP устройства. */
export function pingKey(agentId, range, ip) {
  return `${agentId}|${range || ''}|${ip}`;
}

/** ISO-дата (YYYY-MM-DD) по таймстампу, локальная временная зона сервера. */
function dayOf(ts) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** Инициализация коллекций и очистка записей старше HISTORY_DAYS дней. */
export function initPingHistory(db) {
  if (!Array.isArray(db.pingEvents)) db.pingEvents = [];
  if (!Array.isArray(db.pingDaily)) db.pingDaily = [];
  prunePingHistory(db);
}

/** Удаляет события и суточные агрегаты старше месяца. */
export function prunePingHistory(db) {
  const cutoff = Date.now() - HISTORY_DAYS * DAY_MS;
  const before = db.pingEvents.length;
  db.pingEvents = db.pingEvents.filter((e) => e.ts >= cutoff);
  if (db.pingEvents.length !== before) console.log(`[pluto] история пингов: удалено ${before - db.pingEvents.length} записей старше ${HISTORY_DAYS} дн.`);
  db.pingDaily = db.pingDaily.filter((d) => new Date(d.date + 'T23:59:59').getTime() >= cutoff);
}

/**
 * Регистрация события смены состояния устройства (из pollAgent / seed).
 * state: true — стало онлайн, false — ушло в офлайн.
 * Возвращает true, если событие реально добавлено (защита от дублей).
 * Сохранение в db.json выполняет savePingEvents() (или любой saveDb()).
 */
export function recordPingState(db, agentId, agentName, range, targetName, ip, state, ts = Date.now()) {
  initPingHistory(db);
  const key = pingKey(agentId, range, ip);
  const last = findLastEvent(db, key);
  // дубликаты/мигание: состояние не менялось — событие не нужно
  if (last && last.up === !!state) return false;
  const ev = { id: `${ip}|${ts}`, key, ts, up: !!state, agentId, agentName, range: range || '', target: targetName || range || '', ip };
  db.pingEvents.push(ev);
  // усечение «на лет» — только по данной цели
  const cnt = db.pingEvents.reduce((n, e) => (e.key === key ? n + 1 : n), 0);
  if (cnt > MAX_EVENTS_PER_TARGET) {
    let excess = cnt - MAX_EVENTS_PER_TARGET;
    db.pingEvents = db.pingEvents.filter((e) => (e.key === key && excess-- > 0 ? false : true));
  }
  db._pingDirty = true;
  return true;
}

/** Сохраняет накопленные события истории на диске (если есть изменения). */
export async function savePingEvents(db) {
  if (!db._pingDirty) return;
  db._pingDirty = false;
  await saveDb();
}

/** Последнее событие по ключу (или null). */
function findLastEvent(db, key) {
  let last = null;
  for (const e of db.pingEvents) {
    if (e.key === key && (!last || e.ts >= last.ts)) last = e;
  }
  return last;
}

/**
 * Однократная инициализация истории при старте сервера: для каждого пингуемого
 * устройства создаётся стартовое событие из известного состояния (alive /
 * offlineSince / lastSuccess), иначе журнал был бы пуст до первой смены состояния.
 * Выполняется лениво при первом опросе агента (agent.targets уже заполнены).
 */
export function seedPingHistoryFromAgents(db) {
  if (db._pingSeeded) return false;
  initPingHistory(db);
  const now = Date.now();
  let added = 0;
  for (const a of db.agents || []) {
    for (const t of a.targets || []) {
      const rangeStr = t.range || '';
      const targetName = t.name || t.target || rangeStr;
      for (const r of t.results || []) {
        const ip = r.ip || r.host || r.addr || '';
        if (!ip) continue;
        const key = pingKey(a.id, rangeStr, ip);
        if (findLastEvent(db, key)) continue; // история по этому устройству уже ведётся
        // время перехода в текущее состояние: offlineSince (ушёл в офлайн) или lastSuccess (восстановился)
        const ts = !r.alive ? (r.offlineSince || now) : (r.lastSuccess || now);
        if (recordPingState(db, a.id, a.name, rangeStr, targetName, ip, !!r.alive, Math.min(ts, now))) added++;
      }
    }
  }
  db._pingSeeded = true;
  return db._pingDirty;
}

/**
 * Суточная агрегация: вызываеться периодически из планировщика опросов.
 * Для каждого устройства, замеченного за последние сутки, считает время в онлайне
 * по событиям смены состояния (с учётом текущего состояния на момент расчёта).
 */
export async function rollupPingDaily(db) {
  initPingHistory(db);
  const now = Date.now();
  const today = dayOf(now);
  const dayStart = new Date(today + 'T00:00:00').getTime();
  const yesterday = dayOf(dayStart - 1);
  const yStart = new Date(yesterday + 'T00:00:00').getTime();

  // Актуальные состояния всех пингуемых устройств из результатов агентов
  const current = new Map(); // key -> {up, agentId, agentName, range, target, ip}
  for (const a of db.agents || []) {
    for (const t of a.targets || []) {
      for (const r of t.results || []) {
        const key = pingKey(a.id, t.range || t.target, r.ip);
        current.set(key, {
          up: !!r.alive, agentId: a.id, agentName: a.name,
          range: t.range || '', target: t.name || t.target || '', ip: r.ip,
        });
      }
    }
  }

  // Группировка событий по ключам (последние ~3 суток достаточно)
  const byKey = new Map();
  const scanFrom = yStart - 3 * DAY_MS;
  for (const e of db.pingEvents) {
    if (e.ts < scanFrom) continue;
    if (!byKey.has(e.key)) byKey.set(e.key, []);
    byKey.get(e.key).push(e);
  }
  for (const list of byKey.values()) list.sort((x, y) => x.ts - y.ts);

  /** Время в онлайне (мс) внутри окна [from, to] по отсортированным событиям. */
  const onlineMsIn = (list, from, to, defaultUpAtFrom) => {
    let up = defaultUpAtFrom;
    // состояние на момент `from` = последнее событие до from
    let idx = 0;
    for (; idx < list.length; idx++) {
      if (list[idx].ts >= from) break;
      up = list[idx].up;
    }
    let ms = 0;
    let segStart = null; // начало текущего онлайн-сегмента
    if (up) segStart = from;
    for (let i = idx; i < list.length; i++) {
      const e = list[i];
      if (e.ts >= to) break;
      if (e.up && segStart == null) segStart = e.ts;
      if (!e.up && segStart != null) { ms += e.ts - segStart; segStart = null; }
    }
    if (segStart != null) ms += to - segStart;
    return Math.max(0, Math.min(to - from, ms));
  };

  const upsertDaily = (dateStr, meta, uptimeMs) => {
    const rec = db.pingDaily.find((d) => d.date === dateStr && d.key === meta.key);
    const pct = Math.round((uptimeMs / DAY_MS) * 1000) / 10;
    if (rec) {
      rec.uptimeMs = uptimeMs; rec.uptimePct = pct; rec.downCount = countDown(rec.key, dateStr);
    } else {
      db.pingDaily.push({
        key: meta.key, date: dateStr, agentId: meta.agentId, agentName: meta.agentName,
        target: meta.target, ip: meta.ip, uptimeMs, uptimePct: pct,
        downCount: countDown(meta.key, dateStr),
      });
    }
  };

  const countDown = (key, dateStr) => {
    const s = new Date(dateStr + 'T00:00:00').getTime();
    const e = s + DAY_MS;
    return byKey.get(key)?.filter((ev) => !ev.up && ev.ts >= s && ev.ts < e).length || 0;
  };

  for (const [key, list] of byKey.entries()) {
    const meta = current.get(key) || list[list.length - 1];
    if (!meta) continue;
    // вчера — финальный расчёт (только если за вчера есть события: иначе при
    // пустой истории рисуются ложные нули доступности)
    if (list.some((ev) => ev.ts >= yStart && ev.ts < yStart + DAY_MS)) {
      upsertDaily(yesterday, { key, ...meta }, onlineMsIn(list, yStart, yStart + DAY_MS, false));
    }
    // сегодня — промежуточный (обновляется при каждом роллапе)
    upsertDaily(today, { key, ...meta }, onlineMsIn(list, dayStart, now, meta.up ?? false));
  }

  prunePingHistory(db);
  db._pingDirty = false; // история сохраняется ниже вместе с суточными агрегатами
  await saveDb();
}

/** Запрос истории: фильтры по агенту/диапазону/IP + период (дней). */
export function queryPingHistory(db, { agentId, range, ip, days = HISTORY_DAYS }) {
  initPingHistory(db);
  const cutoff = Date.now() - Math.min(Math.max(Number(days) || HISTORY_DAYS, 1), HISTORY_DAYS) * DAY_MS;
  const events = db.pingEvents
    .filter((e) => e.ts >= cutoff)
    .filter((e) => (!agentId || e.agentId === agentId))
    .filter((e) => (range === undefined || range === null || e.range === range))
    .filter((e) => (!ip || e.ip === ip))
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 2000);
  const daily = db.pingDaily
    .filter((d) => new Date(d.date + 'T23:59:59').getTime() >= cutoff)
    .filter((d) => (!agentId || d.agentId === agentId))
    .filter((d) => (range === undefined || range === null || d.target === range || d.key.includes('|' + (range || '') + '|')))
    .filter((d) => (!ip || d.ip === ip))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  return { events, daily, days: HISTORY_DAYS };
}
