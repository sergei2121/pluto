// ─── PLUTO Web Push: модуль браузерных push-уведомлений ─────────────────────
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VAPID_KEYS_FILE = path.join(__dirname, '../../data/vapid-keys.json');

/**
 * Генерация ключей VAPID для Web Push
 * Ключи нужно сгенерировать один раз и сохранить
 */
export function generateVapidKeys() {
  // В продакшене использовать библиотеку web-push для генерации ключей
  // Это упрощённая реализация
  const keys = {
    publicKey: process.env.VAPID_PUBLIC_KEY || '',
    privateKey: process.env.VAPID_PRIVATE_KEY || '',
  };
  
  if (!keys.publicKey || !keys.privateKey) {
    console.warn('[pluto][webpush] VAPID ключи не настроены. Установите переменные окружения VAPID_PUBLIC_KEY и VAPID_PRIVATE_KEY');
    return null;
  }
  
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
 * Использует нативный https модуль для отправки через сервисы браузера
 */
export async function sendWebPush(title, message, options = {}) {
  const subscriptions = getAllPushSubscriptions();
  
  if (subscriptions.length === 0) {
    console.info('[pluto][webpush] Нет активных подписок');
    return { sent: 0, failed: 0 };
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
      await sendPushToEndpoint(subscription, payload);
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
 * Отправка уведомления на конкретный endpoint
 */
async function sendPushToEndpoint(subscription, payload) {
  const https = await import('node:https');
  
  const url = new URL(subscription.endpoint);
  
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': Buffer.byteLength(payload),
        'Content-Encoding': 'aesgcm',
        // В полной реализации здесь должно быть TTL и URGENT заголовки
        'TTL': '86400', // 24 часа
      },
      timeout: 10000,
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ statusCode: res.statusCode });
        } else {
          const error = new Error(`Push service returned ${res.statusCode}`);
          error.statusCode = res.statusCode;
          reject(error);
        }
      });
    });
    
    req.on('error', (e) => {
      reject(e);
    });
    
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Push request timeout'));
    });
    
    // В полной реализации здесь должно быть шифрование payload
    req.write(payload);
    req.end();
  });
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
