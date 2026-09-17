// ─── PLUTO Middleware: Rate Limiting для защиты от brute-force ──────────────

/**
 * Rate limiter для защиты API endpoints (пункт 1)
 * Ограничивает количество запросов с одного IP за временное окно
 */
export function createRateLimiter({ windowMs = 60000, maxRequests = 10 } = {}) {
  const store = new Map(); // IP -> { count, resetTime }

  // Очистка старых записей каждые 5 минут
  setInterval(() => {
    const now = Date.now();
    for (const [ip, data] of store.entries()) {
      if (now > data.resetTime) {
        store.delete(ip);
      }
    }
  }, 300000);

  return function rateLimit(req, res, next) {
    const ip = req.socket?.remoteAddress || req.connection?.remoteAddress || 'unknown';
    const now = Date.now();

    let record = store.get(ip);

    if (!record || now > record.resetTime) {
      // Новое окно
      record = { count: 1, resetTime: now + windowMs };
      store.set(ip, record);
      return next();
    }

    if (record.count >= maxRequests) {
      // Лимит превышен
      res.writeHead(429, { 
        'Content-Type': 'application/json; charset=utf-8',
        'Retry-After': Math.ceil((record.resetTime - now) / 1000),
        'X-RateLimit-Limit': maxRequests,
        'X-RateLimit-Remaining': 0,
        'X-RateLimit-Reset': record.resetTime,
      });
      res.end(JSON.stringify({ 
        error: 'Слишком много запросов', 
        retryAfter: Math.ceil((record.resetTime - now) / 1000),
        message: `Превышен лимит ${maxRequests} запросов за ${windowMs / 1000} секунд`
      }));
      return;
    }

    record.count++;
    store.set(ip, record);
    next();
  };
}

/**
 * Специальный rate limiter для login endpoint (более строгий)
 */
export const loginRateLimiter = createRateLimiter({
  windowMs: 60000, // 1 минута
  maxRequests: 5,  // 5 попыток входа в минуту
});

/**
 * Общий rate limiter для API
 */
export const apiRateLimiter = createRateLimiter({
  windowMs: 60000, // 1 минута
  maxRequests: 100, // 100 запросов в минуту
});
