// ─── PLUTO: регресс-тесты «Истории активности» (журнал пингов) ──────────────
// Проверяют, что в журнал НЕ попадают записи с пустой датой (ts = 0 / null),
// а корректные метки времени не искажаются при рассинхронизации часов агента.
// Запуск из каталога server/: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { recordPingState, seedPingHistoryFromAgents, queryPingHistory, pingKey } from '../src/db/pingHistory.js';

const mkDb = () => ({ agents: [], pingEvents: [], pingDaily: [] });

test('recordPingState отбрасывает события без корректной даты (пустые ts)', () => {
  const db = mkDb();
  // «пустые даты»: undefined / null / 0 / NaN / строка / отрицательный — все отсекаются
  assert.equal(recordPingState(db, 'a1', 'Hub', '10.0.0.0/24', 'LAN', '10.0.0.5', true, undefined), false);
  assert.equal(recordPingState(db, 'a1', 'Hub', '10.0.0.0/24', 'LAN', '10.0.0.5', true, null), false);
  assert.equal(recordPingState(db, 'a1', 'Hub', '10.0.0.0/24', 'LAN', '10.0.0.5', true, 0), false);
  assert.equal(recordPingState(db, 'a1', 'Hub', '10.0.0.0/24', 'LAN', '10.0.0.5', true, NaN), false);
  assert.equal(recordPingState(db, 'a1', 'Hub', '10.0.0.0/24', 'LAN', '10.0.0.5', true, 'abc'), false);
  assert.equal(recordPingState(db, 'a1', 'Hub', '10.0.0.0/24', 'LAN', '10.0.0.5', true, -5), false);
  assert.equal(db.pingEvents.length, 0, 'ни одно событие с пустой датой не должно быть записано');

  // корректная дата записывается как есть
  const ts = Date.now();
  assert.equal(recordPingState(db, 'a1', 'Hub', '10.0.0.0/24', 'LAN', '10.0.0.5', true, ts), true);
  assert.equal(db.pingEvents.length, 1);
  assert.equal(db.pingEvents[0].ts, ts);
});

test('seed не пишет ts=0 при offlineSince===0 и не даёт ложных событий при future lastSuccess', () => {
  const db = mkDb();
  const now = Date.now();
  const HOUR = 3600 * 1000;
  db.agents = [{
    id: 'a1', name: 'Hub', ip: '192.168.1.100',
    targets: [
      {
        range: '10.0.0.0/24', target: 'LAN',
        results: [
          // офлайн-устройство с обнулённым offlineSince — раньше давало событие с ts=0
          { ip: '10.0.0.1', alive: false, offlineSince: 0, lastSuccess: now - 5 * HOUR },
          // онлайн-устройство: часы агента спешат на 2 часа — событие должно лечь
          // в реальное время now, а не в будущее (иначе дата вне интервала выдачи)
          { ip: '10.0.0.2', alive: true, lastSuccess: now + 2 * HOUR },
        ],
      },
    ],
  }];
  seedPingHistoryFromAgents(db);

  const ev1 = db.pingEvents.find((e) => e.ip === '10.0.0.1');
  assert.ok(ev1, 'событие для 10.0.0.1 должно существовать');
  assert.ok(Number.isFinite(ev1.ts) && ev1.ts >= now, `ts не должен быть пустым/0: ${ev1.ts}`);

  const ev2 = db.pingEvents.find((e) => e.ip === '10.0.0.2');
  assert.ok(ev2, 'событие для 10.0.0.2 должно существовать');
  assert.ok(Math.abs(ev2.ts - now) < 60_000, `метка будущего должна ограничиваться текущим временем: ${ev2.ts} vs ${now}`);

  // ни одного события с пустой датой во всей истории
  for (const e of db.pingEvents) {
    assert.ok(Number.isFinite(e.ts) && e.ts > 0, `событие с пустой датой: ${JSON.stringify(e)}`);
  }
});

test('queryPingHistory отдаёт только события с корректной датой (санация старых записей)', () => {
  const db = mkDb();
  const now = Date.now();
  // имитация уже накопленных в db.json «битых» записей (пустые даты)
  db.pingEvents.push(
    { id: 'x|0', key: pingKey('a1', 'r', '10.0.0.9'), ts: 0, up: false, agentId: 'a1', agentName: 'Hub', range: 'r', target: 'r', ip: '10.0.0.9' },
    { id: 'y|null', key: pingKey('a1', 'r', '10.0.0.8'), ts: null, up: true, agentId: 'a1', agentName: 'Hub', range: 'r', target: 'r', ip: '10.0.0.8' },
    { id: 'z|ok', key: pingKey('a1', 'r', '10.0.0.7'), ts: now - 1000, up: true, agentId: 'a1', agentName: 'Hub', range: 'r', target: 'r', ip: '10.0.0.7' },
  );
  const r = queryPingHistory(db, { days: 30 });
  assert.deepEqual(r.events.map((e) => e.ip), ['10.0.0.7'], 'в выдачу не должны попадать записи без даты');
  // и они физически удалены из хранилища
  assert.equal(db.pingEvents.length, 1);
});

test('recordPingState по умолчанию ставит корректную дату (Date.now)', () => {
  const db = mkDb();
  const before = Date.now();
  assert.equal(recordPingState(db, 'a1', 'Hub', '', '', '10.0.0.5', true), true);
  const ev = db.pingEvents[0];
  assert.ok(Number.isFinite(ev.ts) && ev.ts >= before && ev.ts <= Date.now());
});
