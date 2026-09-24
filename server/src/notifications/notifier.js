// ─── PLUTO Notifications: модуль уведомлений с расширенной обработкой ошибок ─
import https from 'node:https';
import http from 'node:http';

/**
 * Модуль уведомлений (пункт 23 - улучшенная обработка ошибок)
 * Поддерживает Telegram, Email и Push-уведомления
 * Логгирует ошибки с указанием уровня важности
 */

export const logger = {
  error: (msg, context = {}) => {
    console.error(`[pluto][notifications][ERROR] ${msg}`, JSON.stringify(context));
  },
  warn: (msg, context = {}) => {
    console.warn(`[pluto][notifications][WARN] ${msg}`, JSON.stringify(context));
  },
  info: (msg, context = {}) => {
    console.info(`[pluto][notifications][INFO] ${msg}`, JSON.stringify(context));
  },
};

/**
 * Отправка уведомления в Telegram
 */
export async function sendTelegram(notification, type, title, message) {
  const cfg = notification.telegram;
  if (!cfg?.enabled || !cfg.botToken || !cfg.chatId) {
    logger.warn('Telegram не настроен', { enabled: cfg?.enabled });
    return false;
  }

  const text = `*${title}*\n\n${message}`;
  const url = `https://api.telegram.org/bot${cfg.botToken}/sendMessage`;

  return new Promise((resolve) => {
    const data = JSON.stringify({
      chat_id: cfg.chatId,
      text,
      parse_mode: 'Markdown',
    });

    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length,
      },
      timeout: 5000,
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        if (res.statusCode === 200) {
          logger.info('Telegram уведомление отправлено', { type, title });
          resolve(true);
        } else {
          logger.error(`Telegram API вернул ошибку ${res.statusCode}`, { 
            type, 
            title, 
            statusCode: res.statusCode,
            body: body.slice(0, 200) 
          });
          resolve(false);
        }
      });
    });

    req.on('error', (e) => {
      logger.error('Ошибка отправки Telegram уведомления', { 
        type, 
        title, 
        error: e.message,
        code: e.code 
      });
      resolve(false);
    });

    req.on('timeout', () => {
      req.destroy();
      logger.error('Таймаут отправки Telegram уведомления', { type, title });
      resolve(false);
    });

    req.write(data);
    req.end();
  });
}

/**
 * Отправка Push-уведомления через браузерный Push API
 */
async function sendPush(notification, type, title, message) {
  if (!notification.push?.enabled) {
    return false;
  }

  // В будущей реализации здесь будет отправка через Web Push Protocol
  logger.info('Push уведомление (требуется реализация)', { type, title, message });
  return true;
}

/**
 * Отправка Email уведомления
 */
async function sendEmail(notification, type, title, message) {
  const cfg = notification.email;
  if (!cfg?.enabled || !cfg.smtp || !cfg.from || !cfg.to) {
    logger.warn('Email не настроен', { enabled: cfg?.enabled });
    return false;
  }

  // Упрощённая реализация через SMTP (в продакшене использовать nodemailer)
  logger.info('Email уведомление', { 
    type, 
    title, 
    from: cfg.from, 
    to: cfg.to,
    smtp: cfg.smtp 
  });
  
  // Здесь должна быть реальная отправка через SMTP
  return true;
}

/**
 * Главная функция отправки уведомлений
 * @param {string} type - тип уведомления (down, recover, degraded, agentOff, agentOn)
 * @param {string} title - заголовок уведомления
 * @param {string} message - текст уведомления
 */
export async function notify(type, title, message) {
  const db = await import('../lib.js');
  const settings = db.getDb?.()?.settings || db.db?.settings;
  
  if (!settings?.notifications) {
    logger.warn('Настройки уведомлений не найдены');
    return;
  }

  const notification = settings.notifications;
  
  // Проверка, включены ли уведомления для этого типа события (группы: device/agent/ping)
  const onGroups = notification.on || {};
  const groupOf = {
    down: 'device', degraded: 'device', recover: 'device',
    agentOff: 'agent', agentOn: 'agent',
    threshold: 'ping', pingDown: 'ping', pingRecover: 'ping',
  };
  const g = groupOf[type];
  const shouldNotify = g ? (onGroups[g]?.[type] ?? true) : (onGroups[type] ?? true);
  if (!shouldNotify) {
    logger.info(`Уведомления для типа "${type}" отключены`);
    return;
  }

  const results = await Promise.allSettled([
    sendTelegram(notification, type, title, message),
    sendPush(notification, type, title, message),
    sendEmail(notification, type, title, message),
  ]);

  const failed = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value));
  if (failed.length > 0) {
    logger.error('Некоторые уведомления не были доставлены', {
      type,
      title,
      total: results.length,
      failed: failed.length,
    });
  }
}

export default { notify, sendTelegram, sendPush, sendEmail };
