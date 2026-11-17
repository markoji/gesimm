// Service worker: tiene una copia dell'app sul dispositivo, così si apre anche senza rete.
// NON salva mai i dati né i documenti di Dropbox: solo i file dell'app (pagina, stile, codice, icone).

const CACHE = 'vetrina-v4';

self.addEventListener('install', (e) => {
  // Entrambe le pagine: senza rete l'app del gestore non deve mai aprirsi come vetrina.
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(['./', './gestore.html', './manifest.webmanifest', './manifest-gestore.webmanifest', './icona-192.png'])),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Solo file della stessa origine (l'app). Dropbox non passa mai di qui.
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (e.request.mode === 'navigate') {
    // Pagina: prima la rete (per avere sempre l'ultima versione), poi la copia salvata.
    // Ogni pagina (vetrina o gestore) ha la sua copia; i parametri (?code=…) non contano.
    const chiave = url.origin + url.pathname;
    e.respondWith(
      fetch(e.request)
        .then((r) => {
          if (r.ok) {
            const copia = r.clone();
            caches.open(CACHE).then((c) => c.put(chiave, copia));
          }
          return r;
        })
        .catch(() => caches.match(chiave).then((r) => r || caches.match('./'))),
    );
    return;
  }

  // Altri file: copia salvata subito, aggiornata in background.
  e.respondWith(
    caches.match(e.request).then((salvata) => {
      const rete = fetch(e.request)
        .then((r) => {
          if (r.ok) {
            const copia = r.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copia));
          }
          return r;
        })
        .catch(() => salvata);
      return salvata || rete;
    }),
  );
});
