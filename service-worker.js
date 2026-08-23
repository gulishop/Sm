// Bump this version string every time you deploy changes -- it forces old
// caches to be dropped so the app never gets stuck showing old code.
const CACHE_VERSION = "v3";
const CACHE_NAME = "sm-app-cache-" + CACHE_VERSION;
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./js/db.js",
  "./js/firebase-sync.js",
  "./js/thermal-printer.js",
  "./js/app.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// NETWORK-FIRST for everything: when online, you always get the latest
// deployed code straight away -- no more "keeps showing the old version".
// Falls back to the cached copy only when there's no internet, so offline
// mode still works exactly as before.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
        return res;
      })
      .catch(() =>
        caches.match(req).then((cached) => cached || (req.mode === "navigate" ? caches.match("./index.html") : undefined))
      )
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
