// ─── PLUTO Integration Notifications: Slack, Teams, Discord ────────────────
import https from 'node:https';
import http from 'node:http';

const logger = {
  error: (msg, context = {}) => {
    console.error(`[pluto][integrations][ERROR] ${msg}`, JSON.stringify(context));
  },
  warn: (msg, context = {}) => {
    console.warn(`[pluto][integrations][WARN] ${msg}`, JSON.stringify(context));
  },
  info: (msg, context = {}) => {
    console.info(`[pluto][integrations][INFO] ${msg}`, JSON.stringify(context));
  },
};

/**
 * Отправка уведомления в Slack через Incoming Webhook
 */
export async function sendSlack(webhookUrl, title, message, severity = 'info') {
  if (!webhookUrl) {
    logger.warn('Slack webhook URL не предоставлен');
    return false;
  }

  const colorMap = {
    ok: 'good',
    info: '#36a64f',
    warn: 'warning',
    crit: 'danger',
    down: 'danger',
    degraded: 'warning',
    recover: 'good',
    agentOff: 'warning',
    agentOn: 'good',
    threshold: 'warning',
  };

  const payload = {
    attachments: [
      {
        color: colorMap[severity] || '#36a64f',
        title: title,
        text: message,
        footer: 'PLUTO Monitoring',
        ts: Math.floor(Date.now() / 1000),
      },
    ],
  };

  return sendWebhookRequest(webhookUrl, payload);
}

/**
 * Отправка уведомления в Microsoft Teams через Incoming Webhook
 */
export async function sendTeams(webhookUrl, title, message, severity = 'info') {
  if (!webhookUrl) {
    logger.warn('Teams webhook URL не предоставлен');
    return false;
  }

  const themeColorMap = {
    ok: '00FF00',
    info: '00FF00',
    warn: 'FFA500',
    crit: 'FF0000',
    down: 'FF0000',
    degraded: 'FFA500',
    recover: '00FF00',
    agentOff: 'FFA500',
    agentOn: '00FF00',
    threshold: 'FFA500',
  };

  const payload = {
    '@type': 'MessageCard',
    '@context': 'http://schema.org/extensions',
    themeColor: themeColorMap[severity] || '00FF00',
    summary: title,
    sections: [
      {
        activityTitle: title,
        activitySubtitle: 'PLUTO Monitoring',
        activityText: message,
        activityImage: 'https://raw.githubusercontent.com/your-org/pluto/main/public/icon.svg',
      },
    ],
  };

  return sendWebhookRequest(webhookUrl, payload);
}

/**
 * Отправка уведомления в Discord через Webhook
 */
export async function sendDiscord(webhookUrl, title, message, severity = 'info') {
  if (!webhookUrl) {
    logger.warn('Discord webhook URL не предоставлен');
    return false;
  }

  const colorMap = {
    ok: 65280,
    info: 65280,
    warn: 16753920,
    crit: 16711680,
    down: 16711680,
    degraded: 16753920,
    recover: 65280,
    agentOff: 16753920,
    agentOn: 65280,
    threshold: 16753920,
  };

  const payload = {
    embeds: [
      {
        title: title,
        description: message,
        color: colorMap[severity] || 65280,
        footer: {
          text: 'PLUTO Monitoring',
        },
        timestamp: new Date().toISOString(),
      },
    ],
  };

  return sendWebhookRequest(webhookUrl, payload);
}

/**
 * Универсальная функция отправки webhook запроса
 */
function sendWebhookRequest(url, payload) {
  return new Promise((resolve) => {
    const data = JSON.stringify(payload);
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === 'https:';
    const lib = isHttps ? https : http;

    const req = lib.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length,
      },
      timeout: 10000,
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          logger.info('Webhook уведомление отправлено', { 
            url: parsedUrl.hostname,
            statusCode: res.statusCode 
          });
          resolve(true);
        } else {
          logger.error(`Webhook вернул ошибку ${res.statusCode}`, {
            url: parsedUrl.hostname,
            statusCode: res.statusCode,
            body: body.slice(0, 200),
          });
          resolve(false);
        }
      });
    });

    req.on('error', (e) => {
      logger.error('Ошибка отправки webhook уведомления', {
        url: parsedUrl.hostname,
        error: e.message,
        code: e.code,
      });
      resolve(false);
    });

    req.on('timeout', () => {
      req.destroy();
      logger.error('Таймаут отправки webhook уведомления', {
        url: parsedUrl.hostname,
      });
      resolve(false);
    });

    req.write(data);
    req.end();
  });
}

/**
 * Главная функция отправки интеграционных уведомлений
 */
export async function sendIntegrationNotification(type, title, message, integrations = {}) {
  const results = {
    slack: false,
    teams: false,
    discord: false,
  };

  if (integrations.slack?.enabled && integrations.slack.webhookUrl) {
    results.slack = await sendSlack(
      integrations.slack.webhookUrl,
      title,
      message,
      type
    );
  }

  if (integrations.teams?.enabled && integrations.teams.webhookUrl) {
    results.teams = await sendTeams(
      integrations.teams.webhookUrl,
      title,
      message,
      type
    );
  }

  if (integrations.discord?.enabled && integrations.discord.webhookUrl) {
    results.discord = await sendDiscord(
      integrations.discord.webhookUrl,
      title,
      message,
      type
    );
  }

  const successCount = Object.values(results).filter(r => r).length;
  const totalCount = Object.values(results).length;

  if (successCount < totalCount && successCount > 0) {
    logger.warn('Не все интеграционные уведомления были доставлены', {
      type,
      title,
      success: successCount,
      total: totalCount,
    });
  }

  return results;
}

export default {
  sendSlack,
  sendTeams,
  sendDiscord,
  sendIntegrationNotification,
};
