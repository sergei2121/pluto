// ─── Health Check зависимостей ядра (БД, ФС, ICMP) ─────────────────────────
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { loadDb } from '../lib.js';

/**
 * @param {{ version: string, webDir: string }} cfg — версия ядра и каталог статики.
 * @returns {{ getHealthStatus: () => Promise<object> }}
 */
export function createHealthChecks({ version, webDir }) {
  const healthChecks = {
    database: async () => {
      try {
        const currentDb = loadDb();
        return {
          status: currentDb ? 'ok' : 'error',
          details: { devices: currentDb.devices?.length || 0, agents: currentDb.agents?.length || 0 },
        };
      } catch (e) {
        return { status: 'error', details: { error: e.message } };
      }
    },
    filesystem: async () => {
      try {
        await fs.promises.access(webDir, fs.constants.R_OK);
        return { status: 'ok', details: { webDir } };
      } catch (e) {
        return { status: 'error', details: { error: e.message } };
      }
    },
    ping: () => new Promise((resolve) => {
      execFile('ping', ['-c', '1', '-W', '1', '127.0.0.1'], (err) => {
        resolve({ status: err ? 'degraded' : 'ok', details: { pingAvailable: !err } });
      });
    }),
  };

  async function getHealthStatus() {
    const names = Object.keys(healthChecks);
    const results = await Promise.allSettled(names.map((n) => healthChecks[n]()));
    const checks = {};
    for (let i = 0; i < names.length; i++) {
      checks[names[i]] = results[i].status === 'fulfilled'
        ? results[i].value
        : { status: 'error', details: { error: 'check failed' } };
    }
    const statuses = Object.values(checks).map((c) => c.status);
    const overallStatus = statuses.every((s) => s === 'ok')
      ? 'healthy'
      : statuses.some((s) => s === 'error') ? 'unhealthy' : 'degraded';
    return { status: overallStatus, timestamp: Date.now(), version, checks };
  }

  return { getHealthStatus };
}
