// ─── Уведомления: маршрутизация по каналам с учётом групп событий ───────────
// Каналы: Telegram, e-mail (заготовка), Web Push, интеграции (Slack/Teams/Discord).

const notificationLogger = {
  error: (msg, ctx) => console.error(`[pluto][notifications][ERROR] ${msg}`, JSON.stringify(ctx)),
  warn: (msg, ctx) => console.warn(`[pluto][notifications][WARN] ${msg}`, JSON.stringify(ctx)),
  info: (msg, ctx) => console.info(`[pluto][notifications][INFO] ${msg}`, JSON.stringify(ctx)),
};

export { notificationLogger };

/** Включён ли данный тип события в настройках уведомлений. */
export function isKindEnabled(n, kind) {
  const on = n.on || {};
  const dev = on.device || {};
  const ag = on.agent || {};
  const pg = on.ping || {};
  if (kind === 'down' && dev.down === false) return false;
  if (kind === 'degraded' && dev.degraded === false) return false;
  if (kind === 'recover' && dev.recover === false) return false;
  if (kind === 'agentOff' && ag.agentOff === false) return false;
  if (kind === 'agentOn' && ag.agentOn === false) return false;
  if (kind === 'threshold' && pg.threshold === false) return false;
  if (kind === 'pingDown' && pg.pingDown === false) return false;
  if (kind === 'pingRecover' && pg.pingRecover === false) return false;
  return true;
}

/**
 * Создаёт функцию notify(kind, title, body), читающую настройки из getSettings().
 * Отправка — ленивыми импортами модулей каналов; ошибки логируются, но не всплывают.
 */
export function createNotifier(getSettings) {
  return async function notify(kind, title, body) {
    const n = getSettings().notifications;
    if (!n || !isKindEnabled(n, kind)) return;

    // Telegram
    if (n.telegram.enabled && n.telegram.botToken && n.telegram.chatId) {
      try {
        const notifier = await import('../notifications/notifier.js');
        const sent = await notifier.sendTelegram(n, kind, title, body);
        if (sent) notificationLogger.info('Telegram уведомление отправлено', { kind, title });
      } catch (e) {
        notificationLogger.error('Критическая ошибка при отправке Telegram', { kind, title, error: e.message });
      }
    }

    // Email (заготовка для будущей реализации SMTP)
    if (n.email.enabled && n.email.smtp && n.email.from && n.email.to) {
      notificationLogger.info('Email уведомление (требуется реализация SMTP)', {
        kind, title, from: n.email.from, to: n.email.to,
      });
    }

    // Web Push
    if (n.push.enabled) {
      try {
        const webpush = await import('../notifications/webpush.js');
        await webpush.sendWebPush(title, body, { tag: `pluto-${kind}` });
        notificationLogger.info('Web Push уведомление отправлено', { kind, title });
      } catch (e) {
        notificationLogger.error('Ошибка отправки Web Push уведомления', { kind, title, error: e.message });
      }
    }

    // Интеграции (Slack / MS Teams / Discord)
    const integrations = n.integrations || {};
    const hasIntegrations =
      (integrations.slack?.enabled && integrations.slack.webhookUrl) ||
      (integrations.teams?.enabled && integrations.teams.webhookUrl) ||
      (integrations.discord?.enabled && integrations.discord.webhookUrl);
    if (hasIntegrations) {
      try {
        const integrationNotifier = await import('../notifications/integrations.js');
        await integrationNotifier.sendIntegrationNotification(kind, title, body, integrations);
        notificationLogger.info('Интеграционные уведомления отправлены', { kind, title });
      } catch (e) {
        notificationLogger.error('Ошибка отправки интеграционных уведомлений', { kind, title, error: e.message });
      }
    }
  };
}
