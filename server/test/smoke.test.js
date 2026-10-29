// ─── PLUTO Core: смоук-тесты (node --test) ──────────────────────────────────
// Быстрые проверки без сети: health, rate limiter, хранилище.
// Запуск из каталога server/: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createHealthChecks } from '../src/lib/health.js';
import { createRateLimiter } from '../src/middleware/rateLimiter.js';

// ─── Health checks ───────────────────────────────────────────────────────────

test('getHealthStatus возвращает healthy для читаемого webDir', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pluto-web-'));
  const { getHealthStatus } = createHealthChecks({ version: 'test', webDir: dir });
  const h = await getHealthStatus();
  assert.equal(h.version, 'test');
  assert.ok(['healthy', 'degraded'].includes(h.status), `status=${h.status}`);
  assert.equal(h.checks.filesystem.status, 'ok');
  assert.ok(typeof h.timestamp === 'number');
});

test('filesystem-проверка даёт error на несуществующем каталоге', async () => {
  const { getHealthStatus } = createHealthChecks({ version: 'test', webDir: '/nonexistent-pluto-dir' });
  const h = await getHealthStatus();
  assert.equal(h.checks.filesystem.status, 'error');
  assert.equal(h.status, 'unhealthy');
});

// ─── Rate limiter ────────────────────────────────────────────────────────────

function mockReqRes(ip, headers = {}) {
  const req = { socket: { remoteAddress: ip }, headers };
  let code = null;
  let ended = false;
  const res = {
    writeHead: (c) => { code = c; return res; },
    end: () => { ended = true; },
  };
  return { req, res, getCode: () => code, isEnded: () => ended };
}

test('rate limiter пропускает до лимита и отдаёт 429 после', () => {
  const rl = createRateLimiter({ windowMs: 60000, maxRequests: 3 });
  let nextCount = 0;
  const next = () => { nextCount++; };
  const m = mockReqRes('10.0.0.1');
  for (let i = 0; i < 3; i++) rl(m.req, m.res, next);
  assert.equal(nextCount, 3, 'три запроса внутри лимита должны пройти');
  rl(m.req, m.res, next);
  assert.equal(nextCount, 3, 'четвёртый запрос не должен дойти до next');
  assert.equal(m.getCode(), 429);
  assert.ok(m.isEnded());
});

test('rate limiter изолирует клиентов за reverse-proxy при TRUST_PROXY=1', (t) => {
  const prev = process.env.TRUST_PROXY;
  process.env.TRUST_PROXY = '1';
  t.after(() => { if (prev === undefined) delete process.env.TRUST_PROXY; else process.env.TRUST_PROXY = prev; });

  const rl = createRateLimiter({ windowMs: 60000, maxRequests: 2 });
  const next = () => {};
  // оба клиента приходят с одного IP прокси, но с разными X-Forwarded-For
  const a = mockReqRes('172.17.0.1', { 'x-forwarded-for': '192.168.1.10' });
  const b = mockReqRes('172.17.0.1', { 'x-forwarded-for': '192.168.1.11' });
  rl(a.req, a.res, next); rl(a.req, a.res, next);
  assert.equal(a.getCode(), null, 'клиент A ещё в пределах лимита');
  rl(b.req, b.res, next);
  assert.equal(b.getCode(), null, 'лимит клиента A не должен блокировать клиента B');
  rl(a.req, a.res, next);
  assert.equal(a.getCode(), 429, 'клиент A превысил лимит');
});

test('без TRUST_PROXY заголовок X-Forwarded-For игнорируется (нельзя подделать лимит)', () => {
  delete process.env.TRUST_PROXY;
  const rl = createRateLimiter({ windowMs: 60000, maxRequests: 1 });
  const next = () => {};
  const a = mockReqRes('10.0.0.5', { 'x-forwarded-for': '1.1.1.1' });
  const b = mockReqRes('10.0.0.5', { 'x-forwarded-for': '2.2.2.2' });
  rl(a.req, a.res, next);
  rl(b.req, b.res, next);
  assert.equal(b.getCode(), 429, 'подмена XFF без доверенного прокси не должна обходить лимит');
});

// ─── Хранилище (scrypt + сессии) ─────────────────────────────────────────────

test('hashPass/verifyPass: корректный пароль проходит, неверный — нет', async () => {
  const { hashPass, verifyPass } = await import('../src/lib.js');
  const h = hashPass('secret-123');
  assert.ok(h.includes(':'), 'формат salt:key');
  assert.ok(verifyPass('secret-123', h));
  assert.ok(!verifyPass('wrong', h));
  assert.ok(!verifyPass('', h));
});
