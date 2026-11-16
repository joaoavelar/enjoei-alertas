// Service worker: versão mais nova sempre que possível (cópia salva só sem internet) e notificações push.
const VERSION = 'enjoei-v5';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest', 'privacidade.html', 'icons/icon-192.png', 'icons/favicon-32.png'];

self.addEventListener('install', e => {
  // cache: 'reload' ignora o cache HTTP, para não guardar arquivos antigos
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, {cache: 'reload'})))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return;
  e.respondWith(
    fetch(req.mode === 'navigate' ? req.url : req, {cache: 'no-cache'})
      .then(r => {
        if (r.ok) { const c = r.clone(); caches.open(VERSION).then(x => x.put(req, c)); }
        return r;
      })
      .catch(() => caches.match(req, {ignoreSearch: true}).then(hit => hit || caches.match('index.html')))
  );
});

// aviso enviado pelo robô: {title, body, url, tag}
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = {body: e.data && e.data.text()}; }
  e.waitUntil(self.registration.showNotification(d.title || 'Alertas Enjoei', {
    body: d.body || 'Há novidades nos seus alertas.',
    icon: 'icons/icon-192.png',
    badge: 'icons/favicon-32.png',
    tag: d.tag || 'enjoei',
    renotify: true,
    data: {url: d.url || './#inicio'},
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const alvo = new URL(e.notification.data?.url || './#inicio', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({type: 'window', includeUncontrolled: true}).then(cs => {
    for (const c of cs) if (c.url.startsWith(self.registration.scope)) { c.focus(); return c.navigate(alvo); }
    return self.clients.openWindow(alvo);
  }));
});
