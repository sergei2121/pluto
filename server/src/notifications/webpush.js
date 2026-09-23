// ─── PLUTO Web Push: модуль браузерных push-уведомлений ─────────────────────
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import webPush from 'web-push';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VAPID_KEYS_FILE = path.join(__dirname, '../../data/vapid-keys.json');

/**
 * Генерация ключей VAPID для Web Push
 * Ключи нужно сгенерировать один раз и сохранить
 */
export function generateVapidKeys() {
  const keys = {
    publicKey: process.env.VAPID_PUBLIC_KEY || '',
    privateKey: process.env.VAPID_PRIVATE_KEY || '',
  };
  
  if (!keys.publicKey || !keys.privateKey) {
    console.warn('[pluto][webpush] VAPID ключи не настроены. Установите переменные окружения VAPID_PUBLIC_KEY и VAPID_PRIVATE_KEY');
    console.warn('[pluto][webpush] Сгенерируйте ключи: npx web-push generate-vapid-keys');
    return null;
  }
  
  // Настраиваем VAPID для библиотеки web-push
  webPush.setVapidDetails(
    'mailto:admin@pluto.local',
    keys.publicKey,
    keys.privateKey
  );
  
  return keys;
}

/**
 * Сохранение подписки пользователя
 */
export async function savePushSubscription(subscription) {
  try {
    const db = await import('../lib.js');
    const database = db.getDb?.() || db.db;
    
    if (!database.pushSubscriptions) {
      database.pushSubscriptions = [];
    }
    
    // Проверка на дубликат
    const exists = database.pushSubscriptions.some(
      sub => sub.endpoint === subscription.endpoint
    );
    
    if (!exists) {
      database.pushSubscriptions.push({
        endpoint: subscription.endpoint,
        keys: subscription.keys,
        createdAt: Date.now(),
      });
      await db.saveDb?.(database);
      return true;
    }
    
    return false;
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
    const db = await import('../lib.js');
    const database = db.getDb?.() || db.db;
    
    if (database.pushSubscriptions) {
      const initialLength = database.pushSubscriptions.length;
      database.pushSubscriptions = database.pushSubscriptions.filter(
        sub => sub.endpoint !== endpoint
      );
      
      if (database.pushSubscriptions.length !== initialLength) {
        await db.saveDb?.(database);
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
 * Получение всех активных подписок
 */
export function getAllPushSubscriptions() {
  try {
    const db = import('../lib.js');
    const database = db.getDb?.() || db.db;
    return database.pushSubscriptions || [];
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
