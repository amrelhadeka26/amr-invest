// AH HQ phone alerts. Shows each alert the server sends and opens the right HQ page when tapped.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: e.data ? e.data.text() : '' }; }
  const title = d.title || 'AH HQ';
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || '',
    tag: (d.tag || 'hq') + ':' + Date.now(),
    icon: '/assets/ah-hq-icon-192.png',
    badge: '/assets/ah-hq-icon-192.png',
    data: { url: d.url || '/hq/home/' }
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/hq/home/', self.location.origin).href;
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (c.url.startsWith(self.location.origin + '/hq/')) { await c.focus(); try { await c.navigate(url); } catch (err) {} return; }
    }
    await self.clients.openWindow(url);
  })());
});
