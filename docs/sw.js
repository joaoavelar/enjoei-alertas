// Service worker: sempre tenta a versão mais nova; a cópia salva só é usada sem internet.
const VERSION = 'enjoei-v4';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/favicon-32.png'];

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
