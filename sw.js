// Service worker de Carnet Libre : fait marcher l'appli sans Internet.
//
// Règles (elles protègent la vie privée autant que le hors-ligne) :
//  - il ne touche QUE aux fichiers de l'appli, servis depuis son propre dossier, en lecture (GET) ;
//  - il ne voit ni ne garde jamais les requêtes vers un service d'IA ou un autre site : elles partent
//    directement du navigateur, sans passer par ici ;
//  - il ne garde aucune donnée de la personne (cours, cartes, clés) : ça, c'est IndexedDB, géré par l'appli.
//
// La liste des fichiers vient de precache.js (généré par « npm run precache »).
importScripts('precache.js');

const P = self.PRECACHE;
const APP_CACHE = `carnet-app-${P.version}`; // l'appli : changée à chaque version
const VENDOR_CACHE = `carnet-vendor-${P.lazyVersion}`; // lecteur de PDF et OCR : changés rarement
const SCOPE = self.registration.scope;
const SHELL = new Set(P.shell);
const LAZY = new Set(P.lazy);

/** Chemin d'un fichier de l'appli (« src/main.js »), ou null si l'adresse est hors du dossier de l'appli. */
function pathOf(url) {
  if (!url.startsWith(SCOPE)) return null;
  return url.slice(SCOPE.length).split('#')[0].split('?')[0];
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(APP_CACHE);
      // « reload » : on prend les fichiers frais sur le réseau, pas une copie périmée du cache HTTP.
      // addAll est « tout ou rien » : si un fichier manque, cette version n'est pas installée et l'ancienne continue.
      await cache.addAll(P.shell.map((p) => new Request(SCOPE + p, { cache: 'reload' })));
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith('carnet-') && key !== APP_CACHE && key !== VENDOR_CACHE) await caches.delete(key);
      }
      await self.clients.claim();
    })()
  );
});

// Une nouvelle version attend que la personne choisisse « Mettre à jour » (pas de rechargement par surprise).
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const path = pathOf(req.url);
  if (path === null) return; // autre site (IA, etc.) : on ne s'en mêle pas

  if (req.mode === 'navigate') {
    // L'appli est une page unique (les écrans sont dans le « # » de l'adresse).
    if (path === '' || path === 'index.html') event.respondWith(fromApp('index.html', req));
    return;
  }
  if (SHELL.has(path)) event.respondWith(fromApp(path, req));
  else if (LAZY.has(path)) event.respondWith(fromVendor(req));
});

async function fromApp(path, req) {
  const hit = await (await caches.open(APP_CACHE)).match(SCOPE + path, { ignoreSearch: true });
  return hit || fetch(req);
}

async function fromVendor(req) {
  const cache = await caches.open(VENDOR_CACHE);
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && res.status === 200) await cache.put(req, res.clone());
  return res;
}
