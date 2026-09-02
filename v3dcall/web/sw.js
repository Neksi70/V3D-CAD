/* V3D Anrufannahme — Service Worker fuer Push-Benachrichtigungen */
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let d = {title: 'Neuer Anruf', body: 'Es liegt eine Nachricht vor.'};
  try { if (event.data) d = {...d, ...event.data.json()}; } catch (_) {}
  event.waitUntil(self.registration.showNotification(d.title, {
    body: d.body,
    icon: 'icon.svg',
    badge: 'icon.svg',
    tag: d.id || 'v3dcall',
    renotify: true,
    data: {id: d.id}
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const ziel = new URL('./', self.registration.scope).href;
  event.waitUntil(self.clients.matchAll({type: 'window', includeUncontrolled: true})
    .then(fenster => {
      for (const f of fenster) if (f.url.startsWith(ziel) && 'focus' in f) return f.focus();
      return self.clients.openWindow(ziel);
    }));
});
