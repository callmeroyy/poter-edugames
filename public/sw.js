/* ==============================================================
   POTER EDUGAMES — SERVICE WORKER (PWA & PUSH NOTIFICATIONS)
   ============================================================== */
const CACHE_NAME = 'poter-edugames-v1';
const CORE_ASSETS = [
  '/landing-liquid.html',
  '/css/landing-liquid.css',
  '/js/landing-liquid.js',
  '/assets/poter-logo.png',
  '/manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(CORE_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Skip caching API calls and APK binary downloads
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/download')) {
    return;
  }

  // Network-first for HTML pages so updates appear immediately
  if (req.mode === 'navigate' || req.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then(cached => cached || caches.match('/landing-liquid.html')))
    );
    return;
  }

  // Stale-while-revalidate for static CSS/JS/images
  event.respondWith(
    caches.match(req).then(cached => {
      const networkFetch = fetch(req)
        .then(res => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});

// Handle incoming Web Push Notifications (Android / Desktop / iOS PWA)
self.addEventListener('push', event => {
  let data = {
    title: 'Update Baru POTER EDUGAMES',
    body: 'Versi terbaru aplikasi telah tersedia. Ketuk untuk melihat pembaruan.',
    url: '/landing-liquid.html#versi',
    icon: '/assets/poter-logo.png'
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      data = { ...data, ...parsed };
    } catch {
      data.body = event.data.text() || data.body;
    }
  }

  const options = {
    body: data.body,
    icon: data.icon || '/assets/poter-logo.png',
    badge: '/assets/poter-logo.png',
    vibrate: [180, 90, 180],
    tag: 'poter-version-update',
    renotify: true,
    data: { url: data.url || '/landing-liquid.html#versi' },
    actions: [
      { action: 'open_update', title: 'Lihat Versi Terbaru' }
    ]
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/landing-liquid.html#versi';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return undefined;
    })
  );
});
