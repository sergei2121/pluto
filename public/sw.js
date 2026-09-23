/* PLUTO service worker — офлайн-оболочка + установка как приложение + Push уведомления */
const CACHE = 'pluto-shell-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icon.svg', '/icon-maskable.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Обработка push-уведомлений
self.addEventListener('push', (e) => {
  let data = {};
  try {
    data = e.data?.json() || {};
  } catch {
    data = { title: 'PLUTO', body: e.data?.text() || 'Уведомление' };
  }

  const options = {
    body: data.body || 'Новое уведомление',
    icon: data.icon || '/icon.svg',
    badge: data.badge || '/icon-maskable.svg',
    tag: data.tag || 'pluto-notification',
    requireInteraction: data.requireInteraction ?? false,
    data: data.data || {},
    vibrate: data.vibrate || [200, 100, 200],
    actions: [
      { action: 'open', title: 'Открыть' },
      { action: 'dismiss', title: 'Закрыть' },
    ],
  };

  e.waitUntil(
    self.registration.showNotification(data.title || 'PLUTO', options)
  );
});

// Обработка кликов по уведомлениям
self.addEventListener('notificationclick', (e) => {
  e.notification.close();

  if (e.action === 'dismiss') {
    return;
  }

  // Открываем приложение при клике
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url === self.location.origin && 'focus' in client) {
            return client.focus();
          }
        }
        if (clients.openWindow) {
          return clients.openWindow(self.location.origin);
        }
      })
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // внешнее — пропускаем

  // Живые данные и шлюз — только из сети, никогда не кэшируем
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws')) return;

  // Навигация: сеть, при офлайне — кэшированная оболочка
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('/').then((m) => m || caches.match('/index.html'))),
    );
    return;
  }

  // Статика (хэшированные ассеты): кэш, затем сеть
  e.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        }),
    ),
  );
});
