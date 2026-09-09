/* V3D Mail — Service Worker fuer Benachrichtigungen.

   Laeuft auch ohne offenes Fenster: der Dienst schickt per Web Push, dieser
   Faden zeigt die Meldung und setzt das Zeichen am App-Symbol. Bewusst OHNE
   fetch-Handler — die App soll nicht aus einem Zwischenspeicher kommen. */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let d = { titel: 'V3D Mail', text: 'Neue Nachricht' };
  try { if (event.data) d = Object.assign(d, event.data.json()); } catch (_) { /* Standard */ }
  const ziel = (d.acc && d.uid) ? ('?mail=' + encodeURIComponent(d.acc) + ':' + d.uid) : '';
  event.waitUntil((async () => {
    await self.registration.showNotification(d.titel, {
      body: d.text,
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      // Eigener Merkname je Nachricht, sonst ueberschreiben sich mehrere.
      tag: d.art === 'test' ? 'v3dmail-probe' : ('v3dmail-' + (d.acc || '') + '-' + (d.uid || '')),
      renotify: true,
      data: { ziel },
    });
    if (typeof d.offen === 'number' && self.navigator && navigator.setAppBadge) {
      try {
        if (d.offen > 0) await navigator.setAppBadge(d.offen);
        else await navigator.clearAppBadge();
      } catch (_) { /* Zeichen am Symbol kann dieser Browser nicht */ }
    }
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const basis = new URL('./', self.registration.scope).href;
  const ziel = basis + ((event.notification.data && event.notification.data.ziel) || '');
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then((fenster) => {
      for (const f of fenster) {
        if (f.url.startsWith(basis) && 'focus' in f) {
          // Schon offen: dorthin springen, statt ein zweites Fenster zu oeffnen.
          if (ziel !== basis && 'navigate' in f) return f.navigate(ziel).then((w) => w && w.focus());
          return f.focus();
        }
      }
      return self.clients.openWindow(ziel);
    }));
});
