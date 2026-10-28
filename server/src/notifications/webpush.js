// ─── PLUTO Web Push: модуль браузерных push-уведомлений ─────────────────────
// ИСПРАВЛЕНО: раньше модуль обращался к несуществующим db.getDb()/db.db,
// делал const db = import(...) без await (всегда падал) и не генерировал VAPID.
// Теперь: живая база из lib.js (loadDb), автогенерация/сохранение VAPID-ключей.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import webPush from 'web-push';
import { loadDb, saveDb } from '../lib.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
const VAPID_KEYS_FILE = path.join(DATA_DIR, 'vapid-keys.json');

let cachedKeys = null;

/**
 * Получение (или автогенерация) VAPID-ключей.
 * Приоритет: переменные окружения → файл data/vapid-keys.json → генерация anew.
 */
export function generateVapidKeys() {
  if (cachedKeys) return cachedKeys;
  let keys = {
    publicKey: process.env.VAPID_PUBLIC_KEY || '',
    privateKey: process.env.VAPID_PRIVATE_KEY || '',
  };

  // 1) файл ключей (создаётся автоматически при первом запуске)
  if (!keys.publicKey || !keys.privateKey) {
    try {
      if (fs.existsSync(VAPID_KEYS_FILE)) {
        const f = JSON.parse(fs.readFileSync(VAPID_KEYS_FILE, 'utf8'));
        if (f.publicKey && f.privateKey) keys = { publicKey: f.publicKey, privateKey: f.privateKey };
      }
    } catch (e) {
      console.warn('[pluto][webpush] Не удалось прочитать vapid-keys.json:', e.message);
    }
  }

  // 2) генерация новой пары и сохранение (раньше без env-переменных пуш был мёртв)
  if (!keys.publicKey || !keys.privateKey) {
    const generated = webPush.generateVAPIDKeys();
    keys = { publicKey: generated.publicKey, privateKey: generated.privateKey };
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(VAPID_KEYS_FILE, JSON.stringify(keys, null, 2), { mode: 0o600 });
      console.info('[pluto][webpush] Сгенерированы VAPID-ключи, сохранены в', VAPID_KEYS_FILE);
    } catch (e) {
      console.warn('[pluto][webpush] Не удалось сохранить vapid-keys.json:', e.message);
    }
  }

  try {
    webPush.setVapidDetails('mailto:admin@pluto.local', keys.publicKey, keys.privateKey);
  } catch (e) {
    console.error('[pluto][webpush] Ошибка настройки VAPID:', e.message);
    return null;
  }
  cachedKeys = keys;
  return keys;
}

export function getVapidPublicKey() {
  const k = generateVapidKeys();
  return k ? k.publicKey : null;
}

/**
 * Сохранение подписки пользователя (живая база через loadDb)
 */
export async function savePushSubscription(subscription) {
  try {
    if (!subscription || typeof subscription.endpoint !== 'string' || !subscription.keys?.p256dh || !subscription.keys?.auth) {
      console.warn('[pluto][webpush] Некорректная push-подписка (нет endpoint/keys)');
      return false;
    }
    const database = loadDb();
    if (!Array.isArray(database.pushSubscriptions)) database.pushSubscriptions = [];

    // проверка на дубликат + обновление ключей существующей подписки
    const existing = database.pushSubscriptions.find((sub) => sub.endpoint === subscription.endpoint);
    if (existing) {
      existing.keys = subscription.keys;
      await saveDb();
      return false;
    }
    database.pushSubscriptions.push({
      endpoint: subscription.endpoint,
      keys: subscription.keys,
      createdAt: Date.now(),
    });
    await saveDb();
    return true;
  } catch (error) {
    console.error('[pluto][webpush] Ошибка сохранения подписки:', error.message);
    return false;
  }
}

/**
 * Удаление подписки пользователя
 */
export async function removePushSubscription(endpoint) {
  try {
    const database = loadDb();
    if (Array.isArray(database.pushSubscriptions)) {
      const initialLength = database.pushSubscriptions.length;
      database.pushSubscriptions = database.pushSubscriptions.filter((sub) => sub.endpoint !== endpoint);
      if (database.pushSubscriptions.length !== initialLength) {
        await saveDb();
        return true;
      }
    }
    return false;
  } catch (error) {
    console.error('[pluto][webpush] Ошибка удаления подписки:', error.message);
    return false;
  }
}

/**
 * Получение всех активных подписок (синхронно — живая база)
 */
export function getAllPushSubscriptions() {
  try {
    const database = loadDb();
    return Array.isArray(database.pushSubscriptions) ? database.pushSubscriptions : [];
  } catch (error) {
    console.error('[pluto][webpush] Ошибка получения подписок:', error.message);
    return [];
  }
}

/**
 * Отправка Web Push уведомления
 * Использует библиотеку web-push для корректной отправки через сервисы браузера
 */
export async function sendWebPush(title, message, options = {}) {
  const subscriptions = getAllPushSubscriptions();
  
  if (subscriptions.length === 0) {
    console.info('[pluto][webpush] Нет активных подписок');
    return { sent: 0, failed: 0 };
  }
  
  const keys = generateVapidKeys();
  if (!keys) {
    console.error('[pluto][webpush] VAPID ключи не настроены, отправка невозможна');
    return { sent: 0, failed: subscriptions.length };
  }
  
  const payload = JSON.stringify({
    title,
    body: message,
    icon: options.icon || '/icon.svg',
    badge: options.badge || '/icon-maskable.svg',
    tag: options.tag || 'pluto-notification',
    requireInteraction: options.requireInteraction ?? false,
    data: options.data || {},
  });
  
  let sent = 0;
  let failed = 0;
  
  for (const subscription of subscriptions) {
    try {
      await webPush.sendNotification(subscription, payload);
      sent++;
    } catch (error) {
      console.error('[pluto][webpush] Ошибка отправки пуша:', {
        endpoint: subscription.endpoint,
        error: error.message,
      });
      failed++;
      
      // Если ошибка 410 (Gone) или 404 (Not Found), удаляем подписку
      if (error.statusCode === 410 || error.statusCode === 404) {
        await removePushSubscription(subscription.endpoint);
      }
    }
  }
  
  return { sent, failed };
}

/**
 * Инициализация Web Push
 */
export async function initWebPush() {
  const keys = generateVapidKeys();
  if (keys) {
    console.info('[pluto][webpush] Web Push инициализирован');
    return keys;
  }
  return null;
}

export default {
  initWebPush,
  generateVapidKeys,
  savePushSubscription,
  removePushSubscription,
  getAllPushSubscriptions,
  sendWebPush,
};
