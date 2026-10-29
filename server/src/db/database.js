// ─── PLUTO DB: инкапсуляция хранилища с очередью операций ──────────────────
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DEFAULT_SETTINGS } from '../lib.js';

export const DATA_DIR = process.env.DATA_DIR || './data';
const DB_FILE = path.join(DATA_DIR, 'db.json');

/**
 * Класс Database управляет состоянием БД и обеспечивает:
 * - атомарное сохранение через очередь операций
 * - нормализацию данных при загрузке
 * - миграции схемы для совместимости
 */
export class Database {
  constructor() {
    this.db = null;
    this.saveQueue = [];
    this.saveInProgress = false;
    this.saveRetryCount = 0;
    this.MAX_SAVE_RETRIES = 3;
    this.EVENTS_LIMIT = 300;
    this.SESSIONS_LIMIT = 200;
  }

  /**
   * Загружает базу данных из файла или создаёт новую
   */
  load() {
    if (this.db) return this.db;
    
    let data = null;
    try {
      if (fs.existsSync(DB_FILE)) {
        data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      }
    } catch (e) {
      console.error('[pluto] повреждён db.json, создаём новую базу:', e.message);
    }
    
    this.db = this._createDefaultDb();
    if (data) {
      // Сохраняем существующие данные с применением миграций
      this.db = { ...this.db, ...data };
    }
    
    // Применяем настройки по умолчанию
    this.db.settings = this._mergeSettings();
    
    // Нормализуем записи
    this.db.devices = this._normalizeDevices();
    this.db.agents = this._normalizeAgents();
    this.db.users = this._normalizeUsers();

    // Убираем демо-данные карты сети: карты с флагом demo не должны отображаться
    if (Array.isArray(this.db.srvMaps)) {
      this.db.srvMaps = this.db.srvMaps.filter((m) => !m.demo);
    }
    
    // Инициализация первого пользователя
    if (this.db.users.length === 0) {
      this._createInitialAdmin();
    }
    
    // Восстанавливаем флаг checking
    this.db.devices.forEach((d) => (d.checking = false));
    
    return this.db;
  }

  _createDefaultDb() {
    return {
      users: [],
      sessions: [],
      devices: [],
      agents: [],
      tags: [],
      events: [],
      srvMaps: [], // карты VideoSRV (схема размещения видеосерверов по городу)
      settings: { ...DEFAULT_SETTINGS },
    };
  }

  _mergeSettings() {
    const s = this.db.settings || {};
    return {
      ...DEFAULT_SETTINGS,
      ...s,
      intervals: { ...DEFAULT_SETTINGS.intervals, ...(s.intervals || {}) },
      notifications: { ...DEFAULT_SETTINGS.notifications, ...(s.notifications || {}) },
      mirror: { ...DEFAULT_SETTINGS.mirror, ...(s.mirror || {}) },
      showcase: { ...DEFAULT_SETTINGS.showcase, ...(s.showcase || {}) },
    };
  }

  _normalizeDevices() {
    return (this.db.devices || []).map((d) => ({
      ...d,
      tags: Array.isArray(d.tags) ? d.tags : [],
      history: Array.isArray(d.history) ? d.history : [],
      showcase: !!d.showcase,
      checking: false,
    }));
  }

  _normalizeAgents() {
    return (this.db.agents || []).map((a) => ({
      ...a,
      pingTargets: Array.isArray(a.pingTargets) ? a.pingTargets : [],
      targets: Array.isArray(a.targets) ? a.targets : [],
      tags: Array.isArray(a.tags) ? a.tags : [],
      latHist: Array.isArray(a.latHist) ? a.latHist : [],
      netdata: Array.isArray(a.netdata) ? a.netdata : [],
      netdataLatest: a.netdataLatest || null,
      netdataError: a.netdataError || null,
      relayUrl: a.relayUrl || '',
      netdataUrl: a.netdataUrl || '',
      telemetryUrl: a.telemetryUrl || undefined,
      telemetrySource: a.telemetrySource || '',
      lastNetdata: a.lastNetdata || 0,
      favorite: !!a.favorite,
      pingsFavorite: !!a.pingsFavorite,
      pingsShowcase: !!a.pingsShowcase,
      statsView: a.statsView === 'bars' || a.statsView === 'ws' ? a.statsView : (a.stats ? 'ws' : ''),
    }));
  }

  _normalizeUsers() {
    return (this.db.users || []).map((u) => ({
      ...u,
      menuScope: Array.isArray(u.menuScope)
        ? u.menuScope
        : u.role === 'admin'
          ? []
          : Array.isArray(u.scope)
            ? u.scope.filter((s) => s !== 'agent' && s !== 'netdata')
            : [],
      deviceScope: Array.isArray(u.deviceScope)
        ? u.deviceScope
        : Array.isArray(u.scope)
          ? u.scope.filter((s) => ['ping', 'http', 'api', 'rtsp', 'sip', 'snmp', 'ssl'].includes(s))
          : [],
      twoFA: u.twoFA && typeof u.twoFA === 'object'
        ? { enabled: !!u.twoFA.enabled, secret: u.twoFA.secret || null }
        : { enabled: false, secret: null },
      theme: u.theme === 'light' || u.theme === 'dark' ? u.theme : 'dark',
      builtIn: !!u.builtIn,
    }));
  }

  async _createInitialAdmin() {
    const crypto = await import('node:crypto');
    const hashPass = (password) => {
      const salt = crypto.randomBytes(16);
      const key = crypto.scryptSync(password, salt, 32);
      return salt.toString('hex') + ':' + key.toString('hex');
    };
    
    this.db.users.push({
      id: this._uid(),
      login: 'admin',
      name: 'admin',
      role: 'admin',
      menuScope: [],
      deviceScope: [],
      twoFA: { enabled: false, secret: null },
      theme: 'dark',
      passHash: hashPass(process.env.ADMIN_PASSWORD || 'pluto'),
      builtIn: true,
      createdAt: Date.now(),
    });
    
    this.pushEvent('info', 'system', 'Первый запуск ядра: создан администратор admin');
    await this.save();
  }

  /**
   * Асинхронное сохранение с очередью операций для избежания race conditions
   */
  async save() {
    return new Promise((resolve, reject) => {
      this.saveQueue.push({ resolve, reject });
      this._processSaveQueue();
    });
  }

  async _processSaveQueue() {
    if (this.saveInProgress || this.saveQueue.length === 0) {
      return;
    }

    this.saveInProgress = true;
    const currentBatch = [...this.saveQueue];
    this.saveQueue = [];

    try {
      await this._doSave();
      currentBatch.forEach(({ resolve }) => resolve());
      this.saveRetryCount = 0;
    } catch (error) {
      console.error('[pluto] ошибка записи БД:', error.message);
      currentBatch.forEach(({ reject }) => reject(error));
      
      // Повторная попытка при ошибке
      if (this.saveRetryCount < this.MAX_SAVE_RETRIES) {
        this.saveRetryCount++;
        setTimeout(() => {
          this.saveInProgress = false;
          this._processSaveQueue();
        }, 1000 * this.saveRetryCount);
        return;
      }
    }

    this.saveInProgress = false;
    
    // Обработка новых запросов, накопившихся во время сохранения
    if (this.saveQueue.length > 0) {
      setImmediate(() => this._processSaveQueue());
    }
  }

  async _doSave() {
    return new Promise((resolve, reject) => {
      try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        const tmp = DB_FILE + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(this.db));
        fs.renameSync(tmp, DB_FILE);
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  }

  _uid() {
    return crypto.randomBytes(6).toString('hex');
  }

  async pushEvent(sev, source, text) {
    this.db.events.unshift({ id: this._uid(), ts: Date.now(), sev, source, text });
    if (this.db.events.length > this.EVENTS_LIMIT) {
      this.db.events.length = this.EVENTS_LIMIT;
    }
    await this.save();
  }

  async issueSession(userId) {
    const token = crypto.randomBytes(24).toString('hex');
    this.db.sessions.push({ token, userId, createdAt: Date.now() });
    if (this.db.sessions.length > this.SESSIONS_LIMIT) {
      this.db.sessions.splice(0, this.db.sessions.length - this.SESSIONS_LIMIT);
    }
    await this.save();
    return token;
  }

  authUser(req) {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) return null;
    const s = this.db.sessions.find((x) => x.token === token);
    if (!s) return null;
    return this.db.users.find((u) => u.id === s.userId) || null;
  }

  getDb() {
    return this.db;
  }

  /**
   * Экспорт всей базы (устройства, агенты/хабы, настройки, теги, пользователи,
   * карты и полная история пингов) в виде одного JSON-дампа для переноса.
   */
  exportDb() {
    const db = this.load();
    return {
      __plutoExport: 2,
      version: 2,
      exportedAt: new Date().toISOString(),
      coreVersion: process.env.PLUTO_VERSION || '1',
      users: db.users,
      devices: db.devices.map((d) => ({ ...d, checking: false })),
      agents: db.agents,
      tags: db.tags,
      srvMaps: db.srvMaps || [],
      settings: db.settings,
      events: (db.events || []).slice(0, 100),
      pingEvents: (db.pingEvents || []).slice(),
      pingDaily: (db.pingDaily || []).slice(),
    };
  }

  /**
   * Импорт дампа. Режим 'replace' — полная замена базы,
   * 'merge' — дополнение/обновление по id без удаления существующих записей.
   * Сессии никогда не импортируются (безопасность).
   */
  importDb(payload, mode = 'merge') {
    if (!payload || (payload.__plutoExport !== 1 && payload.__plutoExport !== 2)) {
      throw new Error('Файл не является дампом базы PLUTO');
    }
    const db = this.load();
    const pick = (arr) => (Array.isArray(arr) ? arr : []);
    // история пингов: только корректные записи (пустые/битые даты отбрасываются);
    // метки из будущего клампим к Date.now() — иначе событие уходит за окно выдачи («пустая дата»)
    const validPingEvent = (e) => e && Number.isFinite(Number(e.ts)) && Number(e.ts) > 0;
    const clampEvTs = (e) => { const n = Number(e.ts), now = Date.now(); return n > now ? { ...e, ts: now } : e; };
    const validPingDaily = (d) => d && typeof d.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.date);
    const mergeByKey = (existing, incoming, keyOf) => {
      const map = new Map(existing.map((x) => [keyOf(x), x]));
      for (const item of incoming) if (item) map.set(keyOf(item), item);
      return [...map.values()];
    };

    const mergeById = (existing, incoming) => {
      const map = new Map(existing.map((x) => [x.id, x]));
      for (const item of incoming) {
        if (item && item.id && map.has(item.id)) {
          map.set(item.id, { ...map.get(item.id), ...item });
        } else if (item) {
          map.set(item.id || this._uid(), item);
        }
      }
      return [...map.values()];
    };

    if (mode === 'replace') {
      db.users = pick(payload.users);
      db.devices = pick(payload.devices);
      db.agents = pick(payload.agents);
      db.tags = pick(payload.tags);
      db.srvMaps = pick(payload.srvMaps);
      db.settings = payload.settings || db.settings;
      db.events = pick(payload.events);
      db.sessions = [];
      db.pingEvents = pick(payload.pingEvents).filter(validPingEvent).map(clampEvTs);
      db.pingDaily = pick(payload.pingDaily).filter(validPingDaily);
    } else {
      db.users = mergeById(db.users, pick(payload.users));
      db.devices = mergeById(db.devices, pick(payload.devices));
      db.agents = mergeById(db.agents, pick(payload.agents));
      db.tags = [...new Set([...(db.tags || []), ...pick(payload.tags)])];
      db.srvMaps = mergeById(db.srvMaps || [], pick(payload.srvMaps));
      if (payload.settings) {
        db.settings = { ...db.settings, ...payload.settings };
      }
      db.pingEvents = mergeByKey(db.pingEvents || [], pick(payload.pingEvents).filter(validPingEvent).map(clampEvTs), (e) => `${e.key || ''}|${e.ts}`);
      db.pingDaily = mergeByKey(db.pingDaily || [], pick(payload.pingDaily).filter(validPingDaily), (d) => `${d.date}|${d.key || ''}`);
    }
    // импортированная история уже валидна — иначе seed продублирует стартовые события
    db._pingSeeded = (db.pingEvents || []).length > 0;

    // Нормализация после импорта
    db.settings = this._mergeSettings();
    db.devices = this._normalizeDevices();
    db.agents = this._normalizeAgents();
    db.users = this._normalizeUsers();

    const counts = {
      devices: db.devices.length,
      agents: db.agents.length,
      users: db.users.length,
      tags: db.tags.length,
      pingEvents: (db.pingEvents || []).length,
      pingDaily: (db.pingDaily || []).length,
    };
    return counts;
  }
}

// Экспорт для обратной совместимости
export const defaultDb = new Database();
