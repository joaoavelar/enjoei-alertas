// Service worker: app abre offline; dados sempre tentam a rede primeiro.
const VERSION = 'enjoei-v2';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/favicon-32.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;
  if (url.origin !== location.origin) return;           // GitHub API, fotos: sem interferência
  if (url.pathname.includes('/api/')) return;
  const dados = url.pathname.includes('/data/');
  e.respondWith(
    dados
      ? fetch(req).then(r => { const c = r.clone(); caches.open(VERSION).then(x => x.put(req, c)); return r; })
          .catch(() => caches.match(req))               // rede primeiro; offline = última cópia
      : caches.match(req).then(hit => {                 // app: cache primeiro, atualiza em segundo plano
          const rede = fetch(req).then(r => { const c = r.clone(); caches.open(VERSION).then(x => x.put(req, c)); return r; });
          return hit || rede;
        }).catch(() => caches.match('index.html'))
  );
});
